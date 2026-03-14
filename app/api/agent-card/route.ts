/// GET /.well-known/agent-card.json?agent={name}&sld={sld}
/// Also: GET /api/agent-card?agent={name}&sld={sld}
///
/// Serves the ERC-8004 #registration-v1 JSON for a GhostAgent.
/// Used for:
///   1. Endpoint domain verification (ERC-8004 spec §4.2)
///   2. A2A agent discovery
///   3. On-chain agentURI reference target
///
/// If the agent has an on-chain agentId stored in KV, it is patched in.

import { NextRequest, NextResponse } from 'next/server';
import {
  buildErc8004RegistrationFile,
  patchRegistrationWithAgentId,
  type Erc8004RegistrationFile,
} from '../../services/erc8004-registration';
import { type SldKey } from '../../services/genome-metadata';
import { WORKER_URL } from '../../utils/config';


const VALID_SLDS: SldKey[] = ['agent', 'molt', 'vault', 'nftmail', 'picoclaw', 'openclaw'];

export async function GET(req: NextRequest) {
  const agentName = req.nextUrl.searchParams.get('agent') ?? '';
  const sldParam  = req.nextUrl.searchParams.get('sld')   ?? 'nftmail';

  if (!agentName || !/^[a-z0-9][a-z0-9.-]{0,}[a-z0-9]$/.test(agentName)) {
    return NextResponse.json(
      { error: 'Missing or invalid agent name' },
      { status: 400 },
    );
  }

  const sld = VALID_SLDS.includes(sldParam as SldKey) ? (sldParam as SldKey) : 'nftmail';

  // Build base registration file (no agentId yet)
  let regFile: Erc8004RegistrationFile = buildErc8004RegistrationFile({
    agentName,
    sld,
  });

  // Try to look up stored agentId from KV via worker
  try {
    const kvRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAgentStatus', agentName }),
    });
    if (kvRes.ok) {
      const kvData = await kvRes.json() as Record<string, unknown>;
      const agentId = kvData?.erc8004AgentId;
      if (typeof agentId === 'number' && agentId > 0) {
        regFile = patchRegistrationWithAgentId(regFile, agentId);
      }
    }
  } catch {
    // Non-fatal — serve file without agentId
  }

  return new NextResponse(JSON.stringify(regFile, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
