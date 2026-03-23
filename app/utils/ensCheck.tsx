'use client';

import { useEffect, useRef, useState } from 'react';
import { createPublicClient, http, parseAbi, namehash, labelhash } from 'viem';
import { gnosis, mainnet } from 'viem/chains';

const GNS_REGISTRY      = '0x00cEBf9E1E81D3CC17fbA0a49306fA77e3dBe823' as const;
const ENS_BASE_REGISTRAR = '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85' as const;

const gnosisClient = createPublicClient({ chain: gnosis,  transport: http('https://rpc.gnosischain.com') });
const ethClient    = createPublicClient({ chain: mainnet, transport: http('https://cloudflare-eth.com') });

const GNS_ABI = parseAbi(['function owner(bytes32 node) view returns (address)']);
const ENS_ABI = parseAbi(['function ownerOf(uint256 tokenId) view returns (address)']);

export type NameStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'taken';    gnsOwner: string }
  | { state: 'reserved'; ensOwner: string }   // name.eth exists, not your wallet
  | { state: 'yours';    ensOwner: string }   // name.eth exists and you own it
  | { state: 'error';    message: string };

/**
 * Checks two things for a given label + GNS TLD:
 * 1. GNS registry: is `label.tld` already minted on Gnosis?
 * 2. ENS BaseRegistrar: does `label.eth` exist on mainnet? If so, only its
 *    holder may mint — enforcing ENS name reservation across all GNS namespaces.
 *
 * @param label          The bare name (e.g. "ghostagent")
 * @param tld            The GNS TLD (e.g. "nftmail.gno")
 * @param connectedWallet Connected wallet address (or empty string)
 * @param debounceMs     Debounce delay in ms (default 600)
 */
export function useNameCheck(
  label: string,
  tld: string,
  connectedWallet: string,
  debounceMs = 600,
): NameStatus {
  const [status, setStatus] = useState<NameStatus>({ state: 'idle' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!label || label.length < 3) {
      setStatus({ state: 'idle' });
      return;
    }

    setStatus({ state: 'checking' });
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      try {
        const node = namehash(`${label}.${tld}`);

        // 1. GNS: already minted?
        const gnsOwner = (await gnosisClient.readContract({
          address: GNS_REGISTRY, abi: GNS_ABI, functionName: 'owner', args: [node],
        })) as string;

        if (gnsOwner && gnsOwner !== '0x0000000000000000000000000000000000000000') {
          setStatus({ state: 'taken', gnsOwner });
          return;
        }

        // 2. ENS: does label.eth exist on mainnet?
        const tokenId = BigInt(labelhash(label));
        let ensOwner: string | null = null;
        try {
          ensOwner = (await ethClient.readContract({
            address: ENS_BASE_REGISTRAR, abi: ENS_ABI, functionName: 'ownerOf', args: [tokenId],
          })) as string;
        } catch {
          // ownerOf reverts when token doesn't exist — no reservation needed
          ensOwner = null;
        }

        if (ensOwner && ensOwner !== '0x0000000000000000000000000000000000000000') {
          const yours = !!connectedWallet &&
            connectedWallet.toLowerCase() === ensOwner.toLowerCase();
          setStatus(yours
            ? { state: 'yours',    ensOwner }
            : { state: 'reserved', ensOwner });
          return;
        }

        setStatus({ state: 'available' });
      } catch (e) {
        setStatus({ state: 'error', message: (e as Error).message ?? 'Check failed' });
      }
    }, debounceMs);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [label, tld, connectedWallet, debounceMs]);

  return status;
}

/** Inline status badge — drop into any form below the name input */
export function NameStatusBadge({
  status,
  label,
  tld,
}: {
  status: NameStatus;
  label: string;
  tld: string;
}) {
  if (status.state === 'idle') return null;
  return (
    <div className="mt-2">
      {status.state === 'checking' && (
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
          <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-zinc-600 border-t-zinc-300" />
          Checking availability…
        </div>
      )}
      {status.state === 'available' && (
        <p className="text-[10px] font-semibold text-emerald-400">
          ✓ Available — <span className="font-normal text-zinc-400">{label}.{tld} is free to mint</span>
        </p>
      )}
      {status.state === 'yours' && (
        <p className="text-[10px] font-semibold text-emerald-400">
          ✓ ENS reserved for you — <span className="font-normal text-zinc-400">{label}.eth holder confirmed</span>
        </p>
      )}
      {status.state === 'taken' && (
        <p className="text-[10px] font-semibold text-rose-400">
          ✗ Already minted — <span className="font-normal text-zinc-400">{label}.{tld} is taken</span>
        </p>
      )}
      {status.state === 'reserved' && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <p className="text-[10px] font-semibold text-amber-400">
            ⚠ ENS Reserved — {label}.eth is registered
          </p>
          <p className="mt-0.5 text-[10px] text-zinc-500">
            Only the holder of <span className="text-zinc-300">{label}.eth</span> can mint this name.
            Connect that wallet to proceed.
          </p>
        </div>
      )}
      {status.state === 'error' && (
        <p className="text-[10px] text-zinc-600">Could not check availability. Proceed with caution.</p>
      )}
    </div>
  );
}
