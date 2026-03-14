import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, namehash } from 'viem';
import { mainnet } from 'viem/chains';
import { getAllCollections } from '../../services/collection-registry';
import { WORKER_URL } from '../../utils/config';

// Flat set of all reserved words derived from collection registry at module load.
// Includes ENS-reserved prefixes like 'chonk', 'atom', 'punk', 'punks', etc.
const COLLECTION_RESERVED: Set<string> = new Set(
  getAllCollections().flatMap(c => c.ensReserved),
);


// ENS Registry on Ethereum mainnet
const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const;
const ENS_REGISTRY_ABI = [{
  name: 'owner',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'node', type: 'bytes32' }],
  outputs: [{ name: '', type: 'address' }],
}] as const;

const ethClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com'),
});

/**
 * GET /api/check-name?name=postmaster&tld=agent.gno
 *
 * Returns:
 *   { available: true, ensOwner: null, ensClash: false }
 *   { available: false, reason: 'taken', message: '…' }
 *   { available: true, ensOwner: '0x…', ensName: 'postmaster.eth', ensClash: true }
 */
export async function GET(req: NextRequest) {
  const name   = req.nextUrl.searchParams.get('name')?.toLowerCase().trim();
  const tld    = req.nextUrl.searchParams.get('tld') || 'agent.gno';
  const wallet = req.nextUrl.searchParams.get('wallet')?.toLowerCase().trim() ?? null;

  if (!name || name.length < 2) {
    return NextResponse.json({ error: 'Name too short' }, { status: 400 });
  }

  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(name)) {
    return NextResponse.json({
      available: false,
      reason: 'invalid',
      message: 'Only lowercase letters, numbers, and hyphens allowed.',
    });
  }

  // ── 0. Collection-reserved prefix block ─────────────────────────────────────
  // Names like 'chonk', 'atom', 'punk', 'normie' are reserved for NFT collection
  // direct-mint accounts (CHONK.123@nftmail.box) and must not be registered as
  // plain agent names to prevent identity spoofing and ENS clashes.
  if (COLLECTION_RESERVED.has(name)) {
    return NextResponse.json({
      available: false,
      reason: 'reserved',
      message: `"${name}" is reserved for an approved NFT collection identity.`,
    });
  }

  // ── 1. Worker KV: is this agent name already provisioned? ───────────────────
  // getAcctTier returns { tier, ... } only if the acct-tier KV entry exists.
  // Unregistered agents have no entry → returns { tier: null } or { error }.
  let agentTaken = false;
  try {
    const workerRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAcctTier', localPart: name }),
    });
    if (workerRes.ok) {
      const data = await workerRes.json() as { tier?: string | null; raw?: string | null; error?: string };
      // raw is null when no acct-tier KV entry exists → name is free
      // raw is a non-null string only when an entry was actually written (provisioned agent)
      agentTaken = !!(data.raw && !data.error);
    }
  } catch {
    // worker unreachable — proceed optimistically
  }

  if (agentTaken) {
    return NextResponse.json({
      available: false,
      reason: 'taken',
      message: `${name}.${tld} is already registered.`,
    });
  }

  // ── 2. ENS check: does name.eth exist on Ethereum mainnet? ──────────────────
  let ensOwner: string | null = null;
  let ensName: string | null = null;
  let ensClash = false;

  try {
    const node = namehash(`${name}.eth`);
    const owner = await ethClient.readContract({
      address: ENS_REGISTRY,
      abi: ENS_REGISTRY_ABI,
      functionName: 'owner',
      args: [node],
    });
    const isZero = owner === '0x0000000000000000000000000000000000000000';
    if (!isZero) {
      ensOwner = owner;
      ensName  = `${name}.eth`;
      ensClash = true;
    }
  } catch {
    // ENS check non-fatal — network may be unreachable
  }

  // Does the connected wallet own the ENS name?
  const ensOwnedByWallet = ensClash && wallet !== null
    && ensOwner !== null
    && ensOwner.toLowerCase() === wallet.toLowerCase();

  return NextResponse.json({
    available: true,
    name,
    tld,
    fullName: `${name}.${tld}`,
    email: `${name}_@nftmail.box`,
    ensOwner,
    ensName,
    ensClash,
    ensOwnedByWallet,
    message: ensClash
      ? ensOwnedByWallet
        ? `Available to ${ensName} on ENS.`
        : `Available only to ${ensName} on ENS.`
      : `${name}.${tld} is available.`,
  });
}
