/**
 * POST /api/gasless-mint
 *
 * Treasury-sponsored server-side mint for zero-cost agent namespaces:
 *   - picoclaw.gno  → free for everyone (basic tier entry point)
 *   - agent.gno     → free for verified ENS holders (name.eth owner gets name.agent.gno)
 *
 * The treasury wallet signs and pays gas. User pays nothing.
 * Rate-limited to GASLESS_DAILY_LIMIT mints/day (default 50).
 * ENS holder path: name.eth owner → treasury mints name.agent.gno to their wallet.
 *
 * After mint: calls /api/provision-agent server-side to register ERC-8004 identity.
 *
 * Body: {
 *   label:     string            — bare name (e.g. "postmaster")
 *   owner:     `0x${string}`    — wallet that receives the NFT
 *   namespace: "picoclaw"|"agent" — defaults to "picoclaw"
 *   ensProof?: { name: string } — for ENS-holder path (name.eth must be owned by `owner`)
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  encodePacked,
  namehash,
  decodeEventLog,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis, mainnet } from 'viem/chains';
import { GNO_REGISTRARS } from '../../utils/chains';
import NamespaceRegistrarABI from '../../abi/NamespaceRegistrar.json';

const GNS_REGISTRY_PRIMARY   = '0xA505e447474bd1774977510e7a7C9459DA79c4b9' as const;
const GNS_REGISTRY_SECONDARY = '0x00cEBf9E1E81D3CC17fbA0a49306fA77e3dBe823' as const;
const GNS_REGISTRY = GNS_REGISTRY_PRIMARY; // alias kept below
const ENS_BASE_REGISTRAR = '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85' as const;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';

const GNS_REGISTRY_ABI = [{
  name: 'owner',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'node', type: 'bytes32' }],
  outputs: [{ name: '', type: 'address' }],
}] as const;

const ENS_ABI = [{
  name: 'ownerOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const;

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';
const WORKER_SECRET = process.env.WORKER_SECRET || process.env.WEBHOOK_SECRET || '';

// Namespaces eligible for gasless treasury-sponsored minting (coupon extends this to all)
const GASLESS_NAMESPACES = ['picoclaw', 'agent', 'nftmail', 'molt', 'openclaw', 'vault'] as const;
type GaslessNamespace = typeof GASLESS_NAMESPACES[number];

// Daily rate-limit (resets at midnight UTC, in-memory — resets on cold start)
const DAILY_LIMIT = parseInt(process.env.GASLESS_DAILY_LIMIT || '50', 10);
let mintCountToday = 0;
let lastResetDate = new Date().toISOString().slice(0, 10);

// In-flight mutex: prevents double-mint race conditions
const inFlightLabels = new Set<string>();

function checkAndIncrementRateLimit(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastResetDate) { mintCountToday = 0; lastResetDate = today; }
  if (mintCountToday >= DAILY_LIMIT) return false;
  mintCountToday++;
  return true;
}

export async function POST(req: NextRequest) {
  const treasuryKey = process.env.TREASURY_PRIVATE_KEY;
  if (!treasuryKey) {
    return NextResponse.json(
      { error: 'Gasless minting not configured (missing TREASURY_PRIVATE_KEY)' },
      { status: 503 },
    );
  }

  if (process.env.GASLESS_PAUSED === 'true') {
    return NextResponse.json({ error: 'Gasless minting is temporarily paused' }, { status: 503 });
  }

  let body: { label?: string; owner?: string; namespace?: string; ensProof?: { name: string }; couponCode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { label, owner, namespace: rawNs = 'picoclaw', ensProof, couponCode } = body;
  const namespace = (GASLESS_NAMESPACES as readonly string[]).includes(rawNs ?? '')
    ? rawNs as GaslessNamespace
    : 'picoclaw';

  // ── Coupon path: validate coupon before anything else ─────────────────────
  const isCouponMint = !!couponCode?.trim();
  if (isCouponMint) {
    try {
      const vRes  = await fetch(WORKER_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
        body:    JSON.stringify({ action: 'validateCoupon', code: couponCode!.trim().toUpperCase(), tld: `${namespace}.gno` }),
        signal:  AbortSignal.timeout(8000),
      });
      const vData = await vRes.json() as { valid: boolean; reason?: string };
      if (!vData.valid) {
        return NextResponse.json({ error: `Coupon invalid: ${vData.reason ?? 'unknown'}` }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Could not validate coupon — try again' }, { status: 502 });
    }
  } else if (!['picoclaw', 'agent'].includes(namespace)) {
    return NextResponse.json({ error: `Namespace ${namespace} requires a coupon for gasless mint` }, { status: 400 });
  }

  if (!label || typeof label !== 'string' || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]{1}$/.test(label) || label.length < 3) {
    return NextResponse.json({ error: 'Invalid label — min 3 chars, lowercase alphanumeric + hyphens' }, { status: 400 });
  }
  if (!owner || !/^0x[a-fA-F0-9]{40}$/.test(owner)) {
    return NextResponse.json({ error: 'Invalid owner address' }, { status: 400 });
  }

  const ethClient = createPublicClient({
    chain: mainnet,
    transport: http(process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com'),
  });

  // ── ENS holder path: keystone architecture ────────────────────────────────
  // ENS NFT is the keystone governing identity. We do NOT mint agent.gno.
  // Instead: verify ownership → deploy Gnosis mirror TBA → create Safe → mint beacon to Safe.
  // Delegates to /api/byo-molt which handles the universal keystone flow.
  if (namespace === 'agent' && ensProof) {
    const ensLabel = ensProof.name.toLowerCase().replace(/\.eth$/, '');
    if (!ensLabel || ensLabel !== label) {
      return NextResponse.json(
        { error: `ENS proof name does not match label "${label}"` },
        { status: 400 },
      );
    }
    // Verify ENS ownership
    let ensTokenId: bigint;
    try {
      ensTokenId = BigInt(keccak256(encodePacked(['string'], [ensLabel])));
      const ensOwner = await ethClient.readContract({
        address: ENS_BASE_REGISTRAR,
        abi: ENS_ABI,
        functionName: 'ownerOf',
        args: [ensTokenId],
      });
      if (!ensOwner || ensOwner.toLowerCase() !== owner.toLowerCase()) {
        return NextResponse.json(
          { error: `${ensLabel}.eth is not owned by ${owner}` },
          { status: 403 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: `${ensLabel}.eth does not exist on Ethereum mainnet` },
        { status: 403 },
      );
    }
    // Route through byo-molt keystone flow — ENS NFT becomes the governing keystone.
    // Mirror TBA + Safe + beacon are provisioned there; no agent.gno minted.
    const byoRes = await fetch(`${APP_URL}/api/byo-molt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        primaryName: ensLabel,
        tokenId: ensTokenId.toString(),
        ownerWallet: owner,
        nftType: 'ens',
        nftName: `${ensLabel}.eth`,
        couponCode: 'ENS-GASLESS',
        moltTarget: 'new-agent',
      }),
    });
    const byoData = await byoRes.json() as { status?: string; humanEmail?: string; agentEmail?: string; beaconNft?: string; beaconTxHash?: string; error?: string };
    if (byoData.status !== 'ok') {
      return NextResponse.json({ error: byoData.error ?? 'ENS keystone provisioning failed' }, { status: 502 });
    }
    return NextResponse.json({
      success: true,
      txHash: byoData.beaconTxHash ?? '',
      tbaAddress: '',
      label: ensLabel,
      namespace: 'nftmail',
      fullName: `${ensLabel}.nftmail.gno`,
      email: byoData.agentEmail ?? `${ensLabel}_@nftmail.box`,
      humanEmail: byoData.humanEmail,
      sponsor: APP_URL,
      keystoneNft: `${ensLabel}.eth`,
      keystoneChain: 'mainnet',
    });
  }

  // ── Rate limit (skip for coupon mints) ───────────────────────────────────
  if (!isCouponMint && !checkAndIncrementRateLimit()) {
    return NextResponse.json(
      { error: 'Daily gasless mint limit reached. Try again tomorrow or mint with your own wallet.' },
      { status: 429 },
    );
  }

  const account = privateKeyToAccount(
    treasuryKey.startsWith('0x') ? treasuryKey as `0x${string}` : `0x${treasuryKey}` as `0x${string}`,
  );

  const rpc = process.env.NEXT_PUBLIC_GNOSIS_RPC || 'https://rpc.gnosischain.com';
  const publicClient = createPublicClient({ chain: gnosis, transport: http(rpc) });
  const walletClient = createWalletClient({ chain: gnosis, transport: http(rpc), account });

  // ── Treasury balance guard ─────────────────────────────────────────────────
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance < BigInt(1e15)) {
    mintCountToday--; // refund counter
    return NextResponse.json(
      { error: 'Treasury wallet low on funds — please try again later' },
      { status: 503 },
    );
  }

  // ── On-chain duplicate check (both GNS registries) ────────────────────────
  const parentNode = namehash(`${namespace}.gno`);
  const labelHash  = keccak256(encodePacked(['string'], [label]));
  const subnode    = keccak256(encodePacked(['bytes32', 'bytes32'], [parentNode, labelHash]));
  for (const reg of [GNS_REGISTRY_PRIMARY, GNS_REGISTRY_SECONDARY] as const) {
    try {
      const existingOwner = await publicClient.readContract({
        address: reg,
        abi: GNS_REGISTRY_ABI,
        functionName: 'owner',
        args: [subnode],
      });
      if (existingOwner && existingOwner !== '0x0000000000000000000000000000000000000000') {
        mintCountToday--;
        return NextResponse.json(
          { error: `${label}.${namespace}.gno is already minted.` },
          { status: 409 },
        );
      }
    } catch {
      // Revert = not minted — proceed
    }
  }

  // ── In-flight mutex ────────────────────────────────────────────────────────
  const mutexKey = `${namespace}:${label}`;
  if (inFlightLabels.has(mutexKey)) {
    mintCountToday--;
    return NextResponse.json(
      { error: `${label}.${namespace}.gno is currently being minted. Please wait.` },
      { status: 409 },
    );
  }
  inFlightLabels.add(mutexKey);

  try {
    const registrar = GNO_REGISTRARS[namespace as keyof typeof GNO_REGISTRARS];

    const hash = await walletClient.writeContract({
      address: registrar,
      abi: NamespaceRegistrarABI,
      functionName: 'mintSubname',
      args: [
        label,
        owner as `0x${string}`,
        '0x' as `0x${string}`,
        '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
      ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    // Extract TBA from events
    let tbaAddress = '';
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: NamespaceRegistrarABI, data: log.data, topics: log.topics });
        if (decoded.eventName === 'TokenboundAccountCreated') {
          tbaAddress = (decoded.args as unknown as Record<string, string>).account ?? '';
        }
      } catch { /* not our event */ }
    }

    // ── Post-mint: ERC-8004 registration + email provisioning (non-fatal) ──
    fetch(`${APP_URL}/api/provision-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: label, tbaAddress, sld: namespace, ownerWallet: owner }),
    }).catch(() => {});

    // ── Reserve name globally in KV (cross-TLD protection) ──────────────────
    // Blocks chonk676.agent.gno if chonk676.molt.gno is already minted.
    fetch(WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
      body:    JSON.stringify({ action: 'setTld', agentName: label, tld: `${namespace}.gno` }),
    }).catch(() => {});

    // ── Redeem coupon after successful mint (non-fatal) ───────────────────────
    if (isCouponMint) {
      fetch(WORKER_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
        body:    JSON.stringify({ action: 'redeemCoupon', code: couponCode!.trim().toUpperCase(), tld: `${namespace}.gno`, redeemedBy: owner }),
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      txHash: hash,
      tbaAddress,
      label,
      namespace,
      fullName: `${label}.${namespace}.gno`,
      email: `${label}_@nftmail.box`,
      sponsor: account.address,
    });
  } finally {
    inFlightLabels.delete(mutexKey);
  }
}
