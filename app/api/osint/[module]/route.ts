import { NextRequest, NextResponse } from 'next/server';

const GNOSIS_RPC = process.env.NEXT_PUBLIC_GNOSIS_RPC || 'https://rpc.gnosischain.com';
const GNOSISSCAN_API = 'https://api.gnosisscan.io/api';
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

interface AgentFootprint {
  agent: string;
  onChain: {
    safeAddress: string | null;
    tbaAddress: string | null;
    totalTransactions: number;
    firstSeen: number | null;
    lastSeen: number | null;
    balances: { token: string; amount: string }[];
  };
  offChain: {
    tld: string;
    tier: string;
    totalXdaiBurned: number;
    surgeScore: number;
    mcpServers: string[];
    genomeUrl: string | null;
  };
  exposure: {
    hasPublicEndpoints: boolean;
    hasMCPServers: boolean;
    hasGenomeMetadata: boolean;
    riskLevel: 'low' | 'medium' | 'high';
  };
}

interface AgentRelations {
  agent: string;
  handshakes: Array<{
    peer: string;
    status: string;
    timestamp: number;
  }>;
  sharedSafes: string[];
  networkSize: number;
  centrality: number;
}

interface ExposureReport {
  agent: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  exposures: Array<{
    type: string;
    severity: string;
    description: string;
  }>;
  score: number;
}

async function analyzeFootprint(agent: string): Promise<AgentFootprint> {
  // Fetch agent identity from worker
  const identityRes = await fetch(`${WORKER_URL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'getAgentIdentity', agentName: agent }),
  });
  
  if (!identityRes.ok) {
    throw new Error('Agent not found');
  }
  
  const identity = await identityRes.json();
  
  // Fetch on-chain data if Safe address exists
  let onChainData = {
    safeAddress: identity.safeAddress || null,
    tbaAddress: identity.tbaAddress || null,
    totalTransactions: 0,
    firstSeen: null,
    lastSeen: null,
    balances: [],
  };
  
  if (identity.safeAddress) {
    try {
      // Fetch Safe balance
      const balanceRes = await fetch(GNOSIS_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getBalance',
          params: [identity.safeAddress, 'latest'],
        }),
      });
      
      const balanceData = await balanceRes.json();
      if (balanceData.result) {
        const xdaiBalance = (BigInt(balanceData.result) / BigInt(10 ** 18)).toString();
        onChainData.balances.push({ token: 'xDAI', amount: xdaiBalance });
      }
      
      // Fetch transaction count from Gnosisscan
      const txCountRes = await fetch(
        `${GNOSISSCAN_API}?module=account&action=txlist&address=${identity.safeAddress}&startblock=0&endblock=99999999&sort=asc&apikey=YourApiKeyToken`
      );
      
      if (txCountRes.ok) {
        const txData = await txCountRes.json();
        if (txData.status === '1' && Array.isArray(txData.result)) {
          onChainData.totalTransactions = txData.result.length;
          if (txData.result.length > 0) {
            onChainData.firstSeen = parseInt(txData.result[0].timeStamp);
            onChainData.lastSeen = parseInt(txData.result[txData.result.length - 1].timeStamp);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching on-chain data:', error);
    }
  }
  
  // Assess exposure
  const hasPublicEndpoints = identity.mcpServers && identity.mcpServers.length > 0;
  const hasGenomeMetadata = !!identity.genomeUrl;
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  
  if (!identity.safeAddress) riskLevel = 'high';
  else if (onChainData.balances.length === 0 || parseFloat(onChainData.balances[0]?.amount || '0') < 1) riskLevel = 'medium';
  
  return {
    agent,
    onChain: onChainData,
    offChain: {
      tld: identity.tld || 'unknown',
      tier: identity.accountTier || identity.tier || 'basic',
      totalXdaiBurned: identity.totalXdaiBurned || 0,
      surgeScore: identity.surgeReputationScore || 0,
      mcpServers: identity.mcpServers || [],
      genomeUrl: identity.genomeUrl || null,
    },
    exposure: {
      hasPublicEndpoints,
      hasMCPServers: hasPublicEndpoints,
      hasGenomeMetadata,
      riskLevel,
    },
  };
}

async function mapRelations(agent: string): Promise<AgentRelations> {
  // Fetch handshakes from worker
  const handshakesRes = await fetch(`${WORKER_URL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'listHandshakes', agentName: agent }),
  });
  
  let handshakes: any[] = [];
  if (handshakesRes.ok) {
    const data = await handshakesRes.json();
    handshakes = data.handshakes || [];
  }
  
  // Fetch agent identity to get Safe address
  const identityRes = await fetch(`${WORKER_URL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'getAgentIdentity', agentName: agent }),
  });
  
  let sharedSafes: string[] = [];
  if (identityRes.ok) {
    const identity = await identityRes.json();
    if (identity.safeAddress) {
      sharedSafes.push(identity.safeAddress);
    }
  }
  
  // Calculate network metrics
  const networkSize = handshakes.length;
  const centrality = Math.min(networkSize / 10, 1); // Simple centrality: 10+ connections = max
  
  return {
    agent,
    handshakes: handshakes.map((h: any) => ({
      peer: h.peerAgent || h.peer || 'unknown',
      status: h.status || 'unknown',
      timestamp: h.timestamp || Date.now(),
    })),
    sharedSafes,
    networkSize,
    centrality,
  };
}

async function checkExposure(agent: string): Promise<ExposureReport> {
  // Fetch agent identity
  const identityRes = await fetch(`${WORKER_URL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'getAgentIdentity', agentName: agent }),
  });
  
  if (!identityRes.ok) {
    throw new Error('Agent not found');
  }
  
  const identity = await identityRes.json();
  
  const exposures: Array<{ type: string; severity: string; description: string }> = [];
  let score = 100; // Start at 100, deduct for issues
  
  // Check for missing Safe
  if (!identity.safeAddress) {
    exposures.push({
      type: 'no-safe',
      severity: 'high',
      description: 'Agent has no Gnosis Safe address registered',
    });
    score -= 30;
  }
  
  // Check for low balance
  if (identity.safeAddress) {
    try {
      const balanceRes = await fetch(GNOSIS_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getBalance',
          params: [identity.safeAddress, 'latest'],
        }),
      });
      
      const balanceData = await balanceRes.json();
      if (balanceData.result) {
        const xdaiBalance = Number(BigInt(balanceData.result) / BigInt(10 ** 18));
        if (xdaiBalance < 1) {
          exposures.push({
            type: 'low-balance',
            severity: 'medium',
            description: `Safe balance is low (${xdaiBalance.toFixed(2)} xDAI)`,
          });
          score -= 15;
        }
      }
    } catch (error) {
      console.error('Error checking balance:', error);
    }
  }
  
  // Check for missing genome metadata
  if (!identity.genomeUrl) {
    exposures.push({
      type: 'no-genome',
      severity: 'low',
      description: 'Agent has no genome metadata URL',
    });
    score -= 10;
  }
  
  // Check for public MCP endpoints (potential exposure)
  if (identity.mcpServers && identity.mcpServers.length > 0) {
    exposures.push({
      type: 'public-endpoints',
      severity: 'low',
      description: `Agent has ${identity.mcpServers.length} public MCP endpoints`,
    });
    score -= 5;
  }
  
  // Determine overall risk level
  let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (score < 40) riskLevel = 'critical';
  else if (score < 60) riskLevel = 'high';
  else if (score < 80) riskLevel = 'medium';
  
  return {
    agent,
    riskLevel,
    exposures,
    score: Math.max(0, score),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { module: string } }
) {
  const { module } = params;
  const { searchParams } = new URL(request.url);
  const agent = searchParams.get('agent');
  
  if (!agent) {
    return NextResponse.json({ error: 'Missing agent parameter' }, { status: 400 });
  }
  
  try {
    let result;
    
    switch (module) {
      case 'footprint':
        result = await analyzeFootprint(agent);
        break;
      case 'relations':
        result = await mapRelations(agent);
        break;
      case 'exposure':
        result = await checkExposure(agent);
        break;
      default:
        return NextResponse.json({ error: 'Invalid module' }, { status: 400 });
    }
    
    return NextResponse.json(result);
  } catch (error: any) {
    console.error(`OSINT ${module} error:`, error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
