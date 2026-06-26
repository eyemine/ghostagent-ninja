'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import {
  CURSOR_CONTRACT, CURSOR_CHIADO_RPC, CURSOR_ABI, REGISTRY_ABI,
  getSubCapFromMandate, decodeStringValue,
} from '../services/erc8048-publisher';

const REGISTRY   = process.env.NEXT_PUBLIC_ERC8048_REGISTRY ?? '0x0106341056a8790f4b924c380ed5B81B2a062bCE';
const DEMO_TOKEN = 1;
const DEMO_SCOPE = `erc8048:fakenormie:${DEMO_TOKEN}`;
const NULL_ROOT  = '0x0000000000000000000000000000000000000000000000000000000000000000';

interface CursorState {
  mandate: string;
  leafSpent: bigint;
  subCap: bigint;
  registered: boolean;
}

function MeterBar({ spent, cap }: { spent: bigint; cap: bigint }) {
  const pct   = cap > 0n ? Math.min(Number((spent * 10000n) / cap) / 100, 100) : 0;
  const color = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div>
      <div className="mb-1 flex justify-between font-mono text-xs text-[var(--muted)]">
        <span>{(Number(spent) / 1e18).toFixed(6)} xDAI spent</span>
        <span>{(Number(cap) / 1e18).toFixed(3)} xDAI ceiling</span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-black/40 border border-white/5">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-right font-mono text-xs text-[var(--muted)]">{pct.toFixed(2)}% consumed</div>
    </div>
  );
}

export function WitnessChamber({ compact = false }: { compact?: boolean }) {
  const [cursor, setCursor] = useState<CursorState | null>(null);
  const [loading, setLoading] = useState(true);

  const poll = useCallback(async () => {
    try {
      const { createPublicClient, http, keccak256 } = await import('viem');
      const { gnosis } = await import('viem/chains');
      const chiado = {
        id: 10200, name: 'Gnosis Chiado',
        nativeCurrency: { name: 'Chiado xDAI', symbol: 'xDAI', decimals: 18 },
        rpcUrls: { default: { http: [CURSOR_CHIADO_RPC] } },
      } as const;
      const gClient = createPublicClient({ chain: gnosis, transport: http() });
      const cClient = createPublicClient({ chain: chiado, transport: http(CURSOR_CHIADO_RPC) });

      const mandateBytes = await gClient.readContract({
        address: REGISTRY as `0x${string}`, abi: REGISTRY_ABI,
        functionName: 'metadata', args: [BigInt(DEMO_TOKEN), 'cursor[mandate]'],
      }).catch(() => '0x' as `0x${string}`);
      const mandate = mandateBytes && mandateBytes !== '0x'
        ? decodeStringValue(mandateBytes as string) : 'worker';

      const scopeId = keccak256(new TextEncoder().encode(DEMO_SCOPE)) as `0x${string}`;
      const [capRoot, spent] = await Promise.all([
        cClient.readContract({ address: CURSOR_CONTRACT, abi: CURSOR_ABI, functionName: 'capabilityRoot', args: [scopeId] }).catch(() => NULL_ROOT as `0x${string}`),
        cClient.readContract({ address: CURSOR_CONTRACT, abi: CURSOR_ABI, functionName: 'leafSpent',      args: [scopeId] }).catch(() => 0n),
      ]);
      setCursor({
        mandate,
        leafSpent: spent as bigint,
        subCap:    getSubCapFromMandate(mandate),
        registered: (capRoot as string) !== NULL_ROOT,
      });
    } catch { /* non-fatal */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void poll();
    const iv = setInterval(() => void poll(), 12000);
    return () => clearInterval(iv);
  }, [poll]);

  return (
    <div className={`rounded-2xl border border-violet-500/25 bg-violet-500/5 ${compact ? 'p-4' : 'p-5'}`}>
      <div className="mb-4 flex items-start gap-4">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-[rgba(176,128,92,0.25)] bg-black/40">
          <Image src="/FakeNormies/SVGS/01.svg" alt="FakeNormie #1" fill className="object-contain p-1" unoptimized />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm font-bold text-[#f2eee4]">FakeNormie #1</span>
            <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] text-violet-300">Demo Agent</span>
            {cursor?.registered && (
              <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-400">cursor active</span>
            )}
          </div>
          <p className="mt-0.5 font-mono text-[10px] text-[var(--muted)]">Gnosis Mainnet · ERC-8048 Sidecar · Chiado Cursor</p>
          {cursor?.mandate && (
            <p className="mt-0.5 font-mono text-[10px] text-violet-400 capitalize">mandate: {cursor.mandate}</p>
          )}
        </div>
      </div>

      {loading ? (
        <div className="h-7 animate-pulse rounded bg-black/40" />
      ) : cursor?.registered ? (
        <MeterBar spent={cursor.leafSpent} cap={cursor.subCap} />
      ) : (
        <div className="rounded-lg border border-dashed border-[rgba(176,128,92,0.2)] px-4 py-3 text-center font-mono text-[11px] text-[var(--muted)]">
          Cursor leaf not yet registered for this demo agent.
          <br /><span className="text-xs opacity-50">Run the tier upgrade script to activate it.</span>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="font-mono text-[10px] text-[var(--muted)] opacity-50">Live · polls every 12s · Chiado testnet</span>
        <button
          onClick={() => void poll()}
          className="rounded border border-[rgba(176,128,92,0.2)] bg-black/30 px-2.5 py-1 font-mono text-[10px] text-[var(--muted)] hover:text-white transition"
        >
          ↻ refresh
        </button>
      </div>
    </div>
  );
}
