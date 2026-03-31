import { NextRequest, NextResponse } from 'next/server';
import { prismSignal, prismRisk, prismCryptoPrice, type PrismSignal, type PrismRiskMetrics } from '@/app/services/prism-api';
import { createConsensusRound, applyVote, type ConsensusRound, type MemberVote } from '@/app/services/swarm-coordination';
import type { SwarmConfig, SwarmMember } from '@/app/services/vault-swarm-config';

/**
 * POST /api/swarm/prism-consensus
 * 
 * Orchestrates a Ghost Tunnel consensus round for PRISM trading signals.
 * 
 * Body: {
 *   vaultName: string,
 *   symbol: string,        // e.g. "BTC"
 *   agents: Array<{name: string, agentId: string, budgetXdai: number}>,
 *   xmtpEnabled?: boolean  // default false (email coordination)
 * }
 * 
 * Flow:
 * 1. Fetch PRISM signal + risk + price for symbol
 * 2. Create Ghost Tunnel consensus round with signal as payload
 * 3. Each agent votes (simulated or via XMTP/email in real impl)
 * 4. If 2-of-3 majority: return approved trade intent with agent assignment
 * 5. Log all votes + result to Glass Box (beacon CID)
 */

interface PrismConsensusRequest {
  vaultName: string;
  symbol: string;
  agents: Array<{
    name: string;
    agentId: string;
    budgetXdai: number;
  }>;
  xmtpEnabled?: boolean;
}

interface AgentVoteResult {
  agentName: string;
  vote: 'yes' | 'no' | 'abstain';
  reason: string;
  confidence: number;
  riskScore: number;
}

async function simulateAgentVote(
  agent: { name: string; budgetXdai: number },
  signal: PrismSignal,
  risk: PrismRiskMetrics
): Promise<AgentVoteResult> {
  // Agent voting logic based on signal confidence + risk
  const riskAdjustedConfidence = signal.confidence * (1 - risk.volatility);
  
  let vote: 'yes' | 'no' | 'abstain';
  let reason: string;
  
  if (signal.signal === 'buy' && riskAdjustedConfidence > 0.5) {
    vote = 'yes';
    reason = `Strong buy signal (${Math.round(signal.confidence * 100)}% confidence), acceptable risk (${Math.round(risk.volatility * 100)}% vol)`;
  } else if (signal.signal === 'sell' && riskAdjustedConfidence > 0.5) {
    vote = 'yes';
    reason = `Strong sell signal (${Math.round(signal.confidence * 100)}% confidence), taking profit/loss`;
  } else if (risk.volatility > 0.7) {
    vote = 'no';
    reason = `Risk too high (${Math.round(risk.volatility * 100)}% volatility), skip this trade`;
  } else {
    vote = 'abstain';
    reason = `Signal unclear (${signal.signal}, ${Math.round(signal.confidence * 100)}% confidence), wait for better setup`;
  }

  return {
    agentName: agent.name,
    vote,
    reason,
    confidence: signal.confidence,
    riskScore: risk.volatility,
  };
}

export async function POST(req: NextRequest) {
  let body: PrismConsensusRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { vaultName, symbol, agents, xmtpEnabled = false } = body;
  
  if (!vaultName || !symbol || !Array.isArray(agents) || agents.length < 2) {
    return NextResponse.json({ 
      error: 'Missing required fields: vaultName, symbol, agents (min 2)' 
    }, { status: 400 });
  }

  // Step 1: Fetch PRISM data
  const [signal, risk, price] = await Promise.all([
    prismSignal(symbol),
    prismRisk(symbol),
    prismCryptoPrice(symbol),
  ]);

  if (!signal || !risk || !price) {
    return NextResponse.json({ 
      error: 'Failed to fetch PRISM data for symbol',
      symbol 
    }, { status: 502 });
  }

  // Step 2: Create Ghost Tunnel consensus round
  const payload = JSON.stringify({
    symbol,
    signal,
    risk,
    price,
    timestamp: new Date().toISOString(),
  });

  const consensusHash = Buffer.from(payload).toString('base64').slice(0, 32);
  
  const mockConfig: SwarmConfig = {
    vaultName,
    safeAddress: agents[0]?.name === 'ghostagent' ? '0xb7e493e3d226f8fE722CC9916fF164B793af13F4' : '0x316aC7032d1a2b00faAB8A72185f5Ef8b4c75E70',
    strategy: 'consensus',
    architecture: 'Swarm',
    members: agents.map((a, i) => ({
      agentName: a.name,
      tld: 'picoclaw.gno',
      safeModuleAddress: `0x${i.toString().repeat(40).slice(0, 40)}`,
      role: 'trader',
      joinedAt: Date.now(),
    })),
    maxMembers: 8,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  let round = createConsensusRound({
    vaultName,
    topic: `PRISM Signal: ${symbol} ${signal.signal.toUpperCase()}`,
    payload,
    config: mockConfig,
    xmtpEnabled,
    consensusHash,
  });

  // Step 3: Each agent votes based on their analysis
  const agentResults: AgentVoteResult[] = [];
  for (const agent of agents) {
    const voteResult = await simulateAgentVote(agent, signal, risk);
    agentResults.push(voteResult);
    
    round = applyVote(round, {
      agentName: agent.name,
      vote: voteResult.vote,
      reason: voteResult.reason,
    });
  }

  // Step 4: Determine winning agent (highest confidence among yes votes)
  const yesVoters = agentResults.filter(r => r.vote === 'yes');
  let assignedAgent: typeof agents[0] | null = null;
  let winningVote: AgentVoteResult | null = null;

  if (yesVoters.length > 0 && round.result === 'approved') {
    // Pick agent with highest risk-adjusted confidence
    const best = yesVoters.reduce((a, b) => 
      (a.confidence * (1 - a.riskScore)) > (b.confidence * (1 - b.riskScore)) ? a : b
    );
    assignedAgent = agents.find(a => a.name === best.agentName) || null;
    winningVote = best;
  }

  // Step 5: Build trade intent if approved
  let tradeIntent = null;
  if (round.result === 'approved' && assignedAgent && price) {
    const maxPosition = assignedAgent.budgetXdai * 0.995;
    tradeIntent = {
      agentName: assignedAgent.name,
      agentId: assignedAgent.agentId,
      symbol: symbol.toUpperCase(),
      direction: signal.signal === 'buy' ? 'buy' : 'sell',
      amount: maxPosition / price.price,
      signal,
      riskScore: risk.volatility,
      timestamp: new Date().toISOString(),
      consensusRoundId: round.id,
    };
  }

  return NextResponse.json({
    round: {
      id: round.id,
      vaultName: round.vaultName,
      topic: round.topic,
      method: round.method,
      result: round.result,
      quorum: round.quorum,
      votes: round.votes,
      consensusHash: round.consensusHash,
      createdAt: round.createdAt,
      resolvedAt: round.resolvedAt,
    },
    prismData: { signal, risk, price },
    agentVotes: agentResults,
    tradeIntent,
    glassBoxEntry: {
      roundId: round.id,
      vaultName,
      topic: round.topic,
      result: round.result,
      method: round.method,
      memberCount: agents.length,
      votedCount: agentResults.length,
      consensusHash,
      timestamp: Date.now(),
      note: `PRISM Swarm Consensus: ${signal.signal.toUpperCase()} ${symbol} — ${yesVoters.length}/${agents.length} agents approved`,
    },
  });
}

/**
 * GET /api/swarm/prism-consensus?vault=test&symbol=BTC&agents=ghostagent,eyemine,victor
 * Quick demo endpoint
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const vaultName = searchParams.get('vault') || 'demo-vault';
  const symbol = searchParams.get('symbol') || 'BTC';
  const agentNames = (searchParams.get('agents') || 'ghostagent,eyemine,victor').split(',');
  const xmtpEnabled = searchParams.get('xmtp') === 'true';

  const agents = agentNames.map((name, i) => ({
    name: name.trim(),
    agentId: String(3199 + i), // ghostagent=3199, eyemine=3205, victor=3206
    budgetXdai: 10 + i * 5, // varying budgets
  }));

  // Reuse POST logic
  const mockReq = new NextRequest('http://localhost', {
    method: 'POST',
    body: JSON.stringify({ vaultName, symbol, agents, xmtpEnabled }),
  });
  
  return POST(mockReq);
}
