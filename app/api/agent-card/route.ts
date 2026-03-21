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
  type Erc8004RegistrationFile,
  type Erc8004Registration,
  ERC8004_ADDRESSES,
} from '../../services/erc8004-registration';
import { type SldKey } from '../../services/genome-metadata';
import { WORKER_URL } from '../../utils/config';

const CHAIN_IDS: Record<string, number> = {
  gnosis:      100,
  base:        8453,
  baseSepolia: 84532,
};


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
  let allRegistrations: Erc8004Registration[] = [];
  try {
    // resolveAddress — get TLD
    const kvRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolveAddress', name: `${agentName}_` }),
    });
    if (kvRes.ok) {
      const kvData = await kvRes.json() as Record<string, unknown>;
      const kvTld = kvData?.tld as string | undefined;
      if (kvTld) {
        const kvSld = kvTld.split('.')[0] as SldKey;
        if (VALID_SLDS.includes(kvSld)) sld = kvSld;
      }
    }
  } catch { /* Non-fatal */ }

  try {
    // getAgentIdentity — get all-chain registrations
    const idRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAgentIdentity', agentName }),
    });
    if (idRes.ok) {
      const idData = await idRes.json() as Record<string, unknown>;
      const erc8004 = idData?.erc8004 as Record<string, { agentId?: number; chainId?: number }> | undefined;
      if (erc8004) {
        const registryMain = ERC8004_ADDRESSES.mainnet.identityRegistry;
        const registryTest = ERC8004_ADDRESSES.testnet.identityRegistry;
        for (const [chainKey, info] of Object.entries(erc8004)) {
          const aid = info?.agentId;
          if (!aid || aid <= 0) continue;
          const cid = info?.chainId ?? CHAIN_IDS[chainKey];
          if (!cid) continue;
          const registryAddr = cid === 84532 ? registryTest : registryMain;
          allRegistrations.push({ agentId: aid, agentRegistry: `eip155:${cid}:${registryAddr}` });
        }
      }
    }
  } catch { /* Non-fatal — serve with empty registrations */ }

  // Build base registration file
  let regFile: Erc8004RegistrationFile = buildErc8004RegistrationFile({ agentName, sld });
  if (allRegistrations.length > 0) {
    regFile = { ...regFile, registrations: allRegistrations };
  }

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
      if (profile.staticCardCid && typeof profile.staticCardCid === 'string') {
        const ext = regFile as unknown as Record<string, unknown>;
        ext.staticCardCid = profile.staticCardCid;
        ext.staticCardUrl = `https://gateway.lighthouse.storage/ipfs/${profile.staticCardCid}`;
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
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
