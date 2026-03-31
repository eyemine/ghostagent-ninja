import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, namehash, keccak256, encodePacked } from 'viem';
import { mainnet, gnosis } from 'viem/chains';
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

// GNS Registry on Gnosis mainnet — authoritative on-chain subname ownership
const GNS_REGISTRY = '0xA505e447474bd1774977510e7a7C9459DA79c4b9' as const;
const GNS_REGISTRY_ABI = [{
  name: 'owner',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'node', type: 'bytes32' }],
  outputs: [{ name: '', type: 'address' }],
}] as const;

const gnosisClient = createPublicClient({
  chain: gnosis,
  transport: http(process.env.NEXT_PUBLIC_GNOSIS_RPC || 'https://rpc.gnosischain.com'),
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

  // ── 1. On-chain GNS Registry: is this subname already minted? ─────────────
  // This is the authoritative check — queries the Gnosis chain registry directly.
  const sld = tld.replace('.gno', '');
  try {
    const parentNode = namehash(tld);
    const labelHash  = keccak256(encodePacked(['string'], [name]));
    const subnode    = keccak256(encodePacked(['bytes32', 'bytes32'], [parentNode, labelHash]));
    const existingOwner = await gnosisClient.readContract({
      address: GNS_REGISTRY,
      abi: GNS_REGISTRY_ABI,
      functionName: 'owner',
      args: [subnode],
    });
    if (existingOwner && existingOwner !== '0x0000000000000000000000000000000000000000') {
      return NextResponse.json({
        available: false,
        reason: 'taken',
        message: `${name}.${tld} is already minted on Gnosis Chain.`,
      });
    }
  } catch {
    // On-chain check non-fatal — RPC may be unreachable
  }

  // ── 1b. Worker KV fallback: check acct-tier + tld keys ────────────────────
  try {
    const [acctRes, tldRes] = await Promise.all([
      fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getAcctTier', localPart: name }),
      }),
      fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getAgentTLD', localPart: name, parentTld: '' }),
      }),
    ]);
    let kvTaken = false;
    if (acctRes.ok) {
      const data = await acctRes.json() as { tier?: string | null; raw?: string | null; error?: string };
      kvTaken = !!(data.raw && !data.error);
    }
    if (!kvTaken && tldRes.ok) {
      const tldData = await tldRes.json() as { tld?: string | null };
      kvTaken = !!tldData.tld;
    }
    if (kvTaken) {
      return NextResponse.json({
        available: false,
        reason: 'taken',
        message: `${name}.${tld} is already registered.`,
      });
    }
  } catch {
    // worker unreachable — proceed optimistically
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
