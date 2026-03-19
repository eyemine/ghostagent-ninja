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

  const sldFallback: SldKey = VALID_SLDS.includes(sldParam as SldKey) ? (sldParam as SldKey) : 'agent';

  // Resolve current SLD and agentId from KV — single worker call
  let sld: SldKey = sldFallback;
  let agentId: number | null = null;
  try {
    // resolveAddress returns tld, originNft, safe, onChainOwner AND erc8004AgentId in one call
    const kvRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolveAddress', name: `${agentName}_` }),
    });
    if (kvRes.ok) {
      const kvData = await kvRes.json() as Record<string, unknown>;
      // Prefer live TLD from KV (e.g. "molt.gno" → "molt")
      const kvTld = kvData?.tld as string | undefined;
      if (kvTld) {
        const kvSld = kvTld.split('.')[0] as SldKey;
        if (VALID_SLDS.includes(kvSld)) sld = kvSld;
      }
      // erc8004AgentId is included directly in resolveAddress response
      const kvAgentId = kvData?.erc8004AgentId;
      if (typeof kvAgentId === 'number' && kvAgentId > 0) agentId = kvAgentId;
    }
  } catch {
    // Non-fatal — serve file with fallback sld, no agentId
  }

  // Build base registration file
  let regFile: Erc8004RegistrationFile = buildErc8004RegistrationFile({ agentName, sld });
  if (agentId != null) regFile = patchRegistrationWithAgentId(regFile, agentId);

  // Merge per-agent KV profile overrides (description, webUrl, socialLinks)
  try {
    const profileRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAgentProfile', agentName }),
    });
    if (profileRes.ok) {
      const { profile } = await profileRes.json() as { profile: Record<string, unknown> };
      if (profile.description && typeof profile.description === 'string') {
        regFile = { ...regFile, description: profile.description };
      }
      if (profile.webUrl && typeof profile.webUrl === 'string') {
        regFile = {
          ...regFile,
          services: regFile.services.map(s =>
            s.name === 'web' ? { ...s, endpoint: profile.webUrl as string } : s,
          ),
        };
      }
      if (profile.socialLinks && typeof profile.socialLinks === 'object') {
        const socials = profile.socialLinks as Record<string, string>;
        const extraServices = Object.entries(socials)
          .filter(([, url]) => url)
          .map(([name, endpoint]) => ({ name, endpoint }));
        if (extraServices.length > 0) {
          const existingNames = new Set(regFile.services.map(s => s.name));
          const newServices = extraServices.filter(s => !existingNames.has(s.name));
          const updatedServices = regFile.services.map(s => {
            const override = extraServices.find(e => e.name === s.name);
            return override ? { ...s, endpoint: override.endpoint } : s;
          });
          regFile = { ...regFile, services: [...updatedServices, ...newServices] };
        }
      }
    }
  } catch {
    // Non-fatal — serve base file without profile overrides
  }

  // Content negotiation: browsers get a human-readable agent profile page;
  // API clients / A2A agents get the raw JSON.
  const accept = req.headers.get('accept') ?? '';
  if (accept.includes('text/html') && !accept.includes('application/json')) {
    return NextResponse.redirect(
      `https://ghostagent.ninja/agent/${agentName}`,
      { status: 302 },
    );
  }

  return new NextResponse(JSON.stringify(regFile, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=30',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
