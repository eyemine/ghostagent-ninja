/// API Route: Backfill BYO NFT agents with Safe, ERC-8004, Story IP, and image metadata
/// POST /api/admin/backfill-agent
///
/// Retroactively provisions all missing infrastructure for BYO NFT agents:
///   1. Gnosis Safe creation (if safe is null in KV)
///   2. ERC-8004 on-chain identity registration (if not registered)
///   3. On-chain NFT image fetch + store in byo-origin-image KV
///   4. Story Protocol creation.ip mint via gasless-ip-mint
///   5. acct-tier KV update with safe + story_ip
///
/// Body: { secret, entries: [{ agentName, ownerWallet, nftType, tokenId, tbaAddress? }] }
/// All steps are non-fatal — partial success is reported per step.

import { NextRequest, NextResponse } from 'next/server';
import { createSafeForByoMolt } from '../../../services/create-safe';
import { fetchNftImageOnChain } from '../../../utils/nft-image';

const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET ?? process.env.WEBHOOK_SECRET;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';
const NFTMAIL_WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

const NFT_CONTRACTS: Record<string, { contract: string; chain: 'base' | 'mainnet' }> = {
  chonk:   { contract: '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9', chain: 'base' },
  pownft:  { contract: '0x9abb7bddc43fa67c76a62d8c016513827f59be1b', chain: 'mainnet' },
  normie:  { contract: '0x9eb6e2025b64f340691e424b7fe7022ffde12438', chain: 'mainnet' },
  mooncat: { contract: '0xc3f733ca98e0dad0386979eb96fb1722a1a05e69', chain: 'mainnet' },
  ens:     { contract: '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85', chain: 'mainnet' },
};

interface BackfillEntry {
  agentName: string;
  ownerWallet: string;
  nftType: string;
  tokenId: string;
  nftContract?: string;  // override contract address (defaults to NFT_CONTRACTS[nftType])
}

interface StepResult {
  ok: boolean;
  skipped?: boolean;
  detail?: string;
  error?: string;
}

interface EntryResult {
  agentName: string;
  safe:      StepResult & { address?: string };
  erc8004:   StepResult & { agentId?: number };
  image:     StepResult & { imageUrl?: string };
  storyIp:   StepResult & { fullDomain?: string; txHash?: string };
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    secret?: string;
    entries?: BackfillEntry[];
    dryRun?: boolean;
  };

  if (!body.secret || body.secret !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!body.entries || body.entries.length === 0) {
    return NextResponse.json({ error: 'entries array required' }, { status: 400 });
  }

  const treasuryKey = process.env.TREASURY_PRIVATE_KEY;
  const dryRun = body.dryRun ?? false;
  const results: EntryResult[] = [];

  for (const entry of body.entries) {
    const { agentName, ownerWallet, nftType, tokenId, nftContract: nftContractOverride } = entry;
    const result: EntryResult = {
      agentName,
      safe:    { ok: false },
      erc8004: { ok: false },
      image:   { ok: false },
      storyIp: { ok: false },
    };

    // ── Check current state from KV ──
    let currentSafe: string | null = null;
    let currentErc8004: number | null = null;
    let currentStoryIp: string | null = null;
    try {
      const kvRes = await fetch(NFTMAIL_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'kvGet', key: `acct-tier:${agentName}` }),
      });
      if (kvRes.ok) {
        const kv = await kvRes.json() as { value?: string | null };
        if (kv.value) {
          const parsed = JSON.parse(kv.value) as { safe?: string | null; story_ip?: string | null };
          currentSafe = parsed.safe ?? null;
          currentStoryIp = parsed.story_ip ?? null;
        }
      }
    } catch { /* non-fatal */ }

    try {
      const erc8004Res = await fetch(`${APP_URL}/api/erc8004/register?agent=${agentName}`);
      if (erc8004Res.ok) {
        const d = await erc8004Res.json() as { erc8004AgentId?: number | null };
        currentErc8004 = d.erc8004AgentId ?? null;
      }
    } catch { /* non-fatal */ }

    // ── Step 1: Create Safe (if missing) ──
    let safeAddress = currentSafe;
    if (safeAddress) {
      result.safe = { ok: true, skipped: true, address: safeAddress, detail: 'already exists' };
    } else if (dryRun) {
      result.safe = { ok: true, skipped: true, detail: 'dry-run' };
    } else if (!treasuryKey) {
      result.safe = { ok: false, error: 'TREASURY_PRIVATE_KEY not set' };
    } else {
      try {
        const prefix = nftType === 'pownft' ? 'atom' : nftType;
        const humanLocalPart = `${prefix}.${tokenId}`;
        const safeResult = await createSafeForByoMolt(humanLocalPart, ownerWallet, treasuryKey);
        if (safeResult.safeAddress) {
          safeAddress = safeResult.safeAddress;
          result.safe = { ok: true, address: safeAddress, ...(safeResult.alreadyExisted ? { detail: 'already existed — address recovered' } : {}) };
          // Update acct-tier KV with safe address
          await fetch(NFTMAIL_WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'upgradeTier',
              secret: WEBHOOK_SECRET,
              name: agentName,
              tier: 'lite',
              safe: safeAddress,
              storyIp: currentStoryIp ?? null,
              retention: '8-day',
            }),
          });
        } else {
          result.safe = { ok: false, error: safeResult.error ?? 'Safe creation failed' };
        }
      } catch (err: unknown) {
        result.safe = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // ── Step 2: Register ERC-8004 (if missing) ──
    if (currentErc8004 !== null) {
      result.erc8004 = { ok: true, skipped: true, agentId: currentErc8004, detail: 'already registered' };
    } else if (dryRun) {
      result.erc8004 = { ok: true, skipped: true, detail: 'dry-run' };
    } else {
      try {
        const erc8004Res = await fetch(`${APP_URL}/api/erc8004/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentName,
            sld: 'agent',
            ownerWallet,
            safeAddress: safeAddress ?? undefined,
          }),
        });
        if (erc8004Res.ok) {
          const d = await erc8004Res.json() as { agentId?: number };
          result.erc8004 = { ok: true, agentId: d.agentId };
          currentErc8004 = d.agentId ?? null;
        } else {
          const err = await erc8004Res.json().catch(() => ({})) as { error?: string };
          result.erc8004 = { ok: false, error: err.error ?? `HTTP ${erc8004Res.status}` };
        }
      } catch (err: unknown) {
        result.erc8004 = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // ── Step 3: Fetch on-chain image + store in KV ──
    // Check if already stored
    let imageAlreadyStored = false;
    try {
      const imgKv = await fetch(NFTMAIL_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'kvGet', key: `byo-origin-image:${agentName}` }),
      });
      if (imgKv.ok) {
        const d = await imgKv.json() as { value?: string | null };
        imageAlreadyStored = !!d.value;
      }
    } catch { /* non-fatal */ }

    if (imageAlreadyStored) {
      result.image = { ok: true, skipped: true, detail: 'already stored' };
    } else if (dryRun) {
      result.image = { ok: true, skipped: true, detail: 'dry-run' };
    } else {
      try {
        let originImageUrl: string | null = null;
        if (nftType === 'ens') {
          const metaRes = await fetch(`https://metadata.ens.domains/mainnet/0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85/${tokenId}`);
          if (metaRes.ok) {
            const meta = await metaRes.json() as { image?: string; image_url?: string };
            originImageUrl = meta.image ?? meta.image_url ?? null;
          }
        } else {
          const nftConfig = NFT_CONTRACTS[nftType];
          if (nftConfig) {
            const { imageUrl } = await fetchNftImageOnChain(nftConfig.contract, tokenId, nftConfig.chain);
            originImageUrl = imageUrl;
          }
        }
        if (originImageUrl) {
          await fetch(NFTMAIL_WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'kvPut',
              key: `byo-origin-image:${agentName}`,
              value: JSON.stringify({ imageUrl: originImageUrl, nftType, storedAt: Date.now() }),
              ownerAddress: ownerWallet.toLowerCase(),
              webhookSecret: WEBHOOK_SECRET,
            }),
          });
          result.image = { ok: true, imageUrl: originImageUrl };
        } else {
          result.image = { ok: false, error: 'Could not fetch image from on-chain tokenURI' };
        }
      } catch (err: unknown) {
        result.image = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // ── Step 4: Story IP — deploy Safe to Story L1, then registerIP with BYO NFT ──
    // BYO agents have no ERC-6551 TBA. The path is:
    //   a) deploy Safe to Story L1 via cross-chain-safe (deploy)
    //   b) register BYO NFT as IP asset via cross-chain-safe (registerIP)
    const nftContractAddress = nftContractOverride ?? NFT_CONTRACTS[nftType]?.contract;
    if (currentStoryIp) {
      result.storyIp = { ok: true, skipped: true, fullDomain: `${agentName}.creation.ip`, detail: 'already minted' };
    } else if (!safeAddress) {
      result.storyIp = { ok: false, skipped: true, detail: 'Safe not yet created — Story IP requires Safe on Story L1 first' };
    } else if (!nftContractAddress) {
      result.storyIp = { ok: false, error: `Unknown nftType: ${nftType}` };
    } else if (dryRun) {
      result.storyIp = { ok: true, skipped: true, detail: 'dry-run' };
    } else {
      try {
        // Step 4a: Deploy Safe to Story L1
        const deployRes = await fetch(`${APP_URL}/api/cross-chain-safe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'deploy', safeAddress }),
        });
        const deployData = await deployRes.json() as { storyDeployedAddress?: string; alreadyDeployed?: boolean; error?: string };
        if (!deployRes.ok && !deployData.alreadyDeployed) {
          result.storyIp = { ok: false, error: `Safe deploy to Story failed: ${deployData.error ?? deployRes.status}` };
        } else {
          // Step 4b: Register BYO NFT as IP asset
          const regRes = await fetch(`${APP_URL}/api/cross-chain-safe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'registerIP',
              safeAddress,
              tokenContract: nftContractAddress,
              tokenId,
            }),
          });
          const regData = await regRes.json() as { ipId?: string; txHash?: string; error?: string };
          if (!regRes.ok || regData.error) {
            result.storyIp = { ok: false, error: regData.error ?? `registerIP HTTP ${regRes.status}` };
          } else {
            result.storyIp = { ok: true, fullDomain: `${agentName}.creation.ip`, txHash: regData.txHash };
            // Update acct-tier KV with story_ip
            await fetch(NFTMAIL_WORKER_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'upgradeTier',
                secret: WEBHOOK_SECRET,
                name: agentName,
                tier: 'lite',
                safe: safeAddress,
                storyIp: agentName,
                retention: '8-day',
              }),
            });
          }
        }
      } catch (err: unknown) {
        result.storyIp = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    results.push(result);
  }

  return NextResponse.json({ ok: true, dryRun, results });
}
