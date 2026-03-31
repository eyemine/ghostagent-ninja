import { NextRequest, NextResponse } from 'next/server';
import { prismTradeDecision, prismRecordTradeIntent, type PrismTradeIntent } from '@/app/services/prism-api';

/**
 * POST /api/agent/prism-trade
 * 
 * Body: {
 *   agentName: string,
 *   agentId: string,
 *   symbol: string,      // e.g. "BTC"
 *   budgetXdai: number   // max xDAI to allocate
 * }
 * 
 * Returns: {
 *   intent: PrismTradeIntent | null,
 *   beaconCid: string | null,
 *   error?: string
 * }
 */
export async function POST(req: NextRequest) {
  let body: { agentName?: string; agentId?: string; symbol?: string; budgetXdai?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { agentName, agentId, symbol, budgetXdai } = body;
  if (!agentName || !agentId || !symbol || typeof budgetXdai !== 'number') {
    return NextResponse.json({ error: 'Missing required fields: agentName, agentId, symbol, budgetXdai' }, { status: 400 });
  }

  // Get PRISM trading decision
  const intent = await prismTradeDecision(agentName, agentId, symbol, budgetXdai);
  if (!intent) {
    return NextResponse.json({ intent: null, beaconCid: null, error: 'No trade signal or risk too high' }, { status: 200 });
  }

  // Record to beacon (audit trail)
  const beaconCid = await prismRecordTradeIntent(intent);

  return NextResponse.json({ intent, beaconCid });
}

/**
 * GET /api/agent/prism-trade?agent=ghostagent&symbol=BTC&budget=10
 * Quick check endpoint for testing
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentName = searchParams.get('agent') || 'ghostagent';
  const agentId = searchParams.get('agentId') || '3199';
  const symbol = searchParams.get('symbol') || 'BTC';
  const budget = parseFloat(searchParams.get('budget') || '10');

  const intent = await prismTradeDecision(agentName, agentId, symbol, budget);
  if (!intent) {
    return NextResponse.json({ intent: null, error: 'No trade signal or risk too high' });
  }

  return NextResponse.json({ intent });
}
