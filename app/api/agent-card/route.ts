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

const WORKER_SECRET = process.env.WORKER_SECRET || process.env.WEBHOOK_SECRET || '';

const CHAIN_IDS: Record<string, number> = {
  gnosis:      100,
  base:        8453,
  baseSepolia: 84532,
};


const VALID_SLDS: SldKey[] = ['agent', 'molt', 'vault', 'nftmail', 'picoclaw', 'openclaw'];

export async function GET(req: NextRequest) {
  let agentName = req.nextUrl.searchParams.get('agent') ?? '';
  const sldParam  = req.nextUrl.searchParams.get('sld')   ?? 'nftmail';

  // Normalize: strip TLD suffixes (.agent.gno, .molt.gno, etc.)
  agentName = agentName.replace(/\.(agent|molt|nftmail|openclaw|picoclaw|vault)\.gno$/i, '');
  if (!agentName || !/^[a-z0-9][a-z0-9.-]{0,}[a-z0-9]$/.test(agentName)) {
    return NextResponse.json(
      { error: 'Missing or invalid agent name' },
      { status: 400 },
    );
  }

  const sldFallback: SldKey = VALID_SLDS.includes(sldParam as SldKey) ? (sldParam as SldKey) : 'agent';

  // beaconName = hyphen variant (for GNS subname / legacy KV keys)
  const beaconName = agentName.replace(/\./g, '-');

  // Fetch resolveAddress + BYO image for dot name in parallel
  const [kvRes, byoRes] = await Promise.allSettled([
    fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
      body: JSON.stringify({ action: 'resolveAddress', name: `${agentName}_` }),
      signal: AbortSignal.timeout(5000),
    }),
    fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
      body: JSON.stringify({ action: 'kvGet', key: `byo-origin-image:${agentName}` }),
      signal: AbortSignal.timeout(5000),
    }),
  ]);

  // Tolerant identity/profile lookup: D1/KV may store under dot OR hyphen.
  // Try dot (canonical) first, hyphen fallback — pick the one that returns data.
  async function fetchIdentity(name: string) {
    return fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
      body: JSON.stringify({ action: 'getAgentIdentity', agentName: name }),
      signal: AbortSignal.timeout(5000),
    });
  }
  async function fetchProfile(name: string) {
    return fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
      body: JSON.stringify({ action: 'getAgentProfile', agentName: name }),
      signal: AbortSignal.timeout(5000),
    });
  }

  const [idDot, idHyphen] = await Promise.all([fetchIdentity(agentName), fetchIdentity(beaconName)]);
  const idDotText = await idDot.text().catch(() => '');
  const idHyphenText = await idHyphen.text().catch(() => '');
  const idResText = idDotText || idHyphenText;

  const [profileDot, profileHyphen] = await Promise.all([fetchProfile(agentName), fetchProfile(beaconName)]);
  const profileDotText = await profileDot.text().catch(() => '');
  const profileHyphenText = await profileHyphen.text().catch(() => '');
  const profileResText = profileDotText || profileHyphenText;

  // Process: TLD / SLD
  let sld: SldKey = sldFallback;
  if (kvRes.status === 'fulfilled' && kvRes.value.ok) {
    try {
      const kvData = await kvRes.value.json() as Record<string, unknown>;
      const kvTld = kvData?.tld as string | undefined;
      if (kvTld) {
        const kvSld = kvTld.split('.')[0] as SldKey;
        if (VALID_SLDS.includes(kvSld)) sld = kvSld;
      }
    } catch { /* Non-fatal */ }
  }

  // Process: ERC-8004 registrations
  let allRegistrations: Erc8004Registration[] = [];
  if (idResText) {
    try {
      const idData = JSON.parse(idResText) as Record<string, unknown>;
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
    } catch { /* Non-fatal — serve with empty registrations */ }
  }

  // Build base registration file
  let regFile: Erc8004RegistrationFile = buildErc8004RegistrationFile({ agentName, sld });
  if (allRegistrations.length > 0) {
    regFile = { ...regFile, registrations: allRegistrations };
  }

  // Process: agent profile overrides
  if (profileResText) {
    try {
      const { profile } = JSON.parse(profileResText) as { profile: Record<string, unknown> };
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
    } catch { /* Non-fatal — serve base file without profile overrides */ }
  }

  // Process: BYO origin image (already fetched in parallel above)
  let originImageUrl: string | null = null;
  let byoNftType: string | null = null;
  if (byoRes.status === 'fulfilled' && byoRes.value.ok) {
    try {
      const { value } = await byoRes.value.json() as { value?: string | null };
      if (value) {
        const parsed = JSON.parse(value) as { imageUrl?: string; nftType?: string };
        if (parsed.imageUrl) originImageUrl = parsed.imageUrl;
        if (parsed.nftType) byoNftType = parsed.nftType;
      }
    } catch { /* Non-fatal */ }
  }

  // ENS fallback: if nftType is 'ens' but no imageUrl stored, use ENS avatar API (no tokenId needed)
  if (!originImageUrl && byoNftType === 'ens') {
    originImageUrl = `https://metadata.ens.domains/mainnet/avatar/${agentName}.eth`;
  }

  // Hyphen-format fallback for BYO image (only if dot-format returned nothing)
  if (!originImageUrl && beaconName !== agentName) {
    try {
      const imgKv2 = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
        body: JSON.stringify({ action: 'kvGet', key: `byo-origin-image:${beaconName}` }),
        signal: AbortSignal.timeout(5000),
      });
      if (imgKv2.ok) {
        const { value: value2 } = await imgKv2.json() as { value?: string | null };
        if (value2) {
          const parsed2 = JSON.parse(value2) as { imageUrl?: string };
          if (parsed2.imageUrl) originImageUrl = parsed2.imageUrl;
        }
      }
    } catch { /* Non-fatal */ }
  }

  if (originImageUrl) {
    regFile = { ...regFile, image: originImageUrl };
  }

  // If no BYO image in KV, try to detect POW NFT pattern and fetch poster directly
  // Pattern: atom-158 or atom.158 ONLY — do NOT match chonk-N, normie-N, mooncat-N etc.
  if (!originImageUrl) {
    const powMatch = agentName.match(/^atom[.-](\d+)$/);
    if (powMatch) {
      const tokenId = powMatch[1];
      try {
        const powRes = await fetch(`https://www.pownftmetadata.com/t/${tokenId}`, { signal: AbortSignal.timeout(5000) });
        if (powRes.ok) {
          const powMeta = await powRes.json() as { poster?: string; image?: string };
          // Use poster if available, otherwise use image
          const posterUrl = powMeta.poster || powMeta.image;
          if (posterUrl) {
            regFile = { ...regFile, image: posterUrl };
            // Store in KV for future requests (best-effort)
            try {
              await fetch(WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
                body: JSON.stringify({
                  action: 'kvPut',
                  key: `byo-origin-image:${agentName}`,
                  value: JSON.stringify({ imageUrl: posterUrl, nftType: 'pownft', tokenId, storedAt: Date.now() }),
                  ownerAddress: '0x0000000000000000000000000000000000000000',
                  webhookSecret: process.env.WEBHOOK_SECRET || '',
                }),
              });
            } catch {
              // Non-fatal
            }
          }
        }
      } catch {
        // Non-fatal
      }
    }
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
