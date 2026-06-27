'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import {
  CURSOR_CONTRACT, CURSOR_CHIADO_RPC, CURSOR_ABI, REGISTRY_ABI,
  getSubCapFromMandate, decodeStringValue, MANDATE_OPTIONS,
} from '../services/erc8048-publisher';

const REGISTRY  = process.env.NEXT_PUBLIC_ERC8048_REGISTRY ?? '0x0106341056a8790f4b924c380ed5B81B2a062bCE';
const NULL_ROOT = '0x0000000000000000000000000000000000000000000000000000000000000000';

const DEMO_TOKENS = [0, 1, 2, 3, 4, 5];

function svgPath(token: number) {
  return `/FakeNormies/SVGS/${String(token).padStart(2, '0')}.svg`;
}
function demoScope(token: number) {
  return `erc8048:fakenormie:${token}`;
}

interface CursorState {
  mandate: string;
  leafSpent: bigint;
  subCap: bigint;
  registered: boolean;
  capRoot: string;
  scopeId: string;
  pollCount: number;
}

interface AuditLine {
  ts: string;
  text: string;
  kind: 'info' | 'ok' | 'warn' | 'dim';
}

function ts() {
  return new Date().toISOString().slice(11, 23);
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
      <div className="mt-1 text-right font-mono text-xs text-[var(--muted)]">{pct.toFixed(2)}% of ceiling consumed</div>
    </div>
  );
}

export function WitnessChamber({ compact = false, terminal = false, initialToken = 0 }: { compact?: boolean; terminal?: boolean; initialToken?: number }) {
  const [token, setToken] = useState(initialToken);
  const [cursor, setCursor] = useState<CursorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditLog, setAuditLog] = useState<AuditLine[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const appendLog = useCallback((lines: AuditLine[]) => {
    setAuditLog(prev => [...prev, ...lines].slice(-80));
  }, []);

  const poll = useCallback(async (t: number) => {
    const scope = demoScope(t);
    if (terminal) appendLog([{ ts: ts(), text: `── token #${t} ────────────────────────────`, kind: 'dim' }]);
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

      if (terminal) appendLog([{ ts: ts(), text: `[ERC-8048] reading cursor[mandate] · token ${t} · Gnosis`, kind: 'info' }]);
      const mandateBytes = await gClient.readContract({
        address: REGISTRY as `0x${string}`, abi: REGISTRY_ABI,
        functionName: 'metadata', args: [BigInt(t), 'cursor[mandate]'],
      }).catch(() => '0x' as `0x${string}`);
      const mandate = mandateBytes && mandateBytes !== '0x'
        ? decodeStringValue(mandateBytes as string) : 'worker';
      if (terminal) appendLog([{ ts: ts(), text: `[ERC-8048] mandate = "${mandate}"`, kind: 'ok' }]);

      const scopeId = keccak256(new TextEncoder().encode(scope)) as `0x${string}`;
      if (terminal) appendLog([
        { ts: ts(), text: `[ERC-8312] scope  = ${scope}`, kind: 'info' },
        { ts: ts(), text: `[ERC-8312] scopeId = ${scopeId.slice(0, 18)}…`, kind: 'dim' },
        { ts: ts(), text: `[ERC-8312] reading capabilityRoot + leafSpent · Chiado`, kind: 'info' },
      ]);

      const [capRoot, spent] = await Promise.all([
        cClient.readContract({ address: CURSOR_CONTRACT, abi: CURSOR_ABI, functionName: 'capabilityRoot', args: [scopeId] }).catch(() => NULL_ROOT as `0x${string}`),
        cClient.readContract({ address: CURSOR_CONTRACT, abi: CURSOR_ABI, functionName: 'leafSpent',      args: [scopeId] }).catch(() => 0n),
      ]);

      const registered = (capRoot as string) !== NULL_ROOT;
      const subCap = getSubCapFromMandate(mandate);

      if (terminal) {
        if (registered) {
          appendLog([
            { ts: ts(), text: `[ERC-8312] capRoot = ${(capRoot as string).slice(0, 18)}…`, kind: 'ok' },
            { ts: ts(), text: `[ERC-8312] leafSpent = ${(Number(spent as bigint) / 1e18).toFixed(6)} xDAI`, kind: 'ok' },
            { ts: ts(), text: `[ERC-8312] subCap = ${(Number(subCap) / 1e18).toFixed(3)} xDAI`, kind: 'ok' },
            { ts: ts(), text: `[VERDICT] cursor leaf ACTIVE · ceiling enforced`, kind: 'ok' },
          ]);
        } else {
          appendLog([
            { ts: ts(), text: `[ERC-8312] capRoot = NULL_ROOT (not registered)`, kind: 'warn' },
            { ts: ts(), text: `[VERDICT] no leaf registered for scope ${scope}`, kind: 'warn' },
            { ts: ts(), text: `  → upgrade this token to activate cursor leaf`, kind: 'dim' },
          ]);
        }
      }

      setCursor(prev => ({
        mandate,
        leafSpent: spent as bigint,
        subCap,
        registered,
        capRoot: capRoot as string,
        scopeId,
        pollCount: (prev?.pollCount ?? 0) + 1,
      }));
    } catch (e) {
      if (terminal) appendLog([{ ts: ts(), text: `[ERROR] ${e instanceof Error ? e.message : 'rpc error'}`, kind: 'warn' }]);
    } finally {
      setLoading(false);
    }
  }, [terminal, appendLog]);

  // Re-poll when token changes
  useEffect(() => {
    setLoading(true);
    setCursor(null);
    if (terminal) {
      appendLog([{ ts: ts(), text: `── switched to FakeNormie #${token} ──────────────`, kind: 'dim' }]);
    }
    void poll(token);
    const iv = setInterval(() => void poll(token), 12000);
    return () => clearInterval(iv);
  }, [token, poll, terminal, appendLog]);

  // Init banner (once, on mount)
  useEffect(() => {
    if (!terminal) return;
    appendLog([
      { ts: ts(), text: `WitnessChamber v2 — ERC-8312 enforcement monitor`, kind: 'dim' },
      { ts: ts(), text: `cursor : ${CURSOR_CONTRACT.slice(0, 18)}… (Chiado)`, kind: 'info' },
      { ts: ts(), text: `registry: ${REGISTRY.slice(0, 18)}… (Gnosis)`, kind: 'info' },
      { ts: ts(), text: `tokens available: ${DEMO_TOKENS.join(', ')}`, kind: 'dim' },
    ]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminal]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [auditLog]);

  const mandateMeta = MANDATE_OPTIONS.find(m => m.value === cursor?.mandate);

  /* ── Terminal (3-column) mode ── */
  if (terminal) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 font-mono text-zinc-300 overflow-hidden">

        {/* Token picker strip */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-zinc-800 bg-zinc-900/50">
          <span className="text-[9px] text-zinc-600 uppercase tracking-widest mr-2">Token</span>
          {DEMO_TOKENS.map(t => (
            <button
              key={t}
              onClick={() => setToken(t)}
              className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-bold transition ${
                token === t
                  ? 'border-violet-500/60 bg-violet-500/15 text-violet-300'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
              }`}
            >
              <div className="relative h-4 w-4 shrink-0 overflow-hidden rounded">
                <Image src={svgPath(t)} alt={`#${t}`} fill className="object-contain" unoptimized />
              </div>
              #{t}
            </button>
          ))}
          <div className="ml-auto text-[9px] text-zinc-700">live · 12s · Chiado</div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 p-3">

        {/* Col 1 — Agent Status */}
        <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Agent Genesis</span>
            <span className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400">Gnosis + Chiado</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-zinc-700 bg-black">
              <Image src={svgPath(token)} alt={`FakeNormie #${token}`} fill className="object-contain p-1" unoptimized />
            </div>
            <div>
              <div className="text-xs font-bold text-white">FakeNormie #{token}</div>
              <div className="text-[10px] text-zinc-500">token {token} · ERC-8048</div>
            </div>
          </div>

          <div className="space-y-1.5 text-[11px]">
            <div className="flex justify-between">
              <span className="text-zinc-500">mandate</span>
              <span className="font-bold text-violet-400 uppercase">{cursor?.mandate ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">tier label</span>
              <span className="text-zinc-300">{mandateMeta?.label ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">ceiling</span>
              <span className="text-zinc-300">{mandateMeta?.subCapLabel ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">scope</span>
              <span className="text-zinc-600 text-[10px]">{demoScope(token)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">cursor leaf</span>
              {loading ? (
                <span className="text-zinc-600">…</span>
              ) : cursor?.registered ? (
                <span className="text-emerald-400">ACTIVE</span>
              ) : (
                <span className="text-amber-400">NOT REGISTERED</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">polls</span>
              <span className="text-zinc-400">{cursor?.pollCount ?? 0}</span>
            </div>
          </div>

          <div className="mt-auto pt-2 border-t border-zinc-800">
            <button
              onClick={() => void poll(token)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 py-1.5 text-[10px] text-zinc-400 hover:text-white hover:border-violet-500/50 transition"
            >
              ↻ force poll
            </button>
          </div>
        </div>

        {/* Col 2 — Spend Meter */}
        <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Spend Meter</span>
            <span className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400">ERC-8312</span>
          </div>

          {loading ? (
            <div className="flex flex-col gap-2">
              <div className="h-4 animate-pulse rounded bg-zinc-800" />
              <div className="h-3 animate-pulse rounded bg-zinc-800 w-2/3" />
            </div>
          ) : cursor?.registered ? (
            <>
              <MeterBar spent={cursor.leafSpent} cap={cursor.subCap} />
              <div className="space-y-1.5 text-[11px] pt-1">
                <div className="flex justify-between">
                  <span className="text-zinc-500">spent</span>
                  <span className="text-zinc-200">{(Number(cursor.leafSpent) / 1e18).toFixed(6)} xDAI</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">remaining</span>
                  <span className="text-emerald-400">
                    {(Number(cursor.subCap - cursor.leafSpent) / 1e18).toFixed(6)} xDAI
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">capRoot</span>
                  <span className="text-zinc-500 text-[10px]">{cursor.capRoot.slice(0, 10)}…</span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 text-center py-4">
              <div className="text-2xl">🔒</div>
              <div className="text-[11px] text-amber-400 font-bold">Leaf not registered</div>
              <div className="text-[10px] text-zinc-600 leading-relaxed">
                No capabilityRoot on Chiado for FakeNormie #{token}.
                <br />Try another token or upgrade this one via the mandate dashboard.
              </div>
            </div>
          )}

          <div className="mt-auto pt-2 border-t border-zinc-800 text-[10px] text-zinc-600">
            scope: <span className="text-zinc-500">{demoScope(token)}</span>
          </div>
        </div>

        {/* Col 3 — Audit Log */}
        <div className="flex flex-col rounded-xl border border-zinc-800 bg-black p-4">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-zinc-800">
            <span className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Chiado Audit Log</span>
            <span className="text-[9px] text-zinc-700">live · 12s</span>
          </div>
          <div
            ref={logRef}
            className="flex-1 overflow-y-auto space-y-0.5 text-[10px] leading-relaxed min-h-0 max-h-64"
          >
            {auditLog.length === 0 ? (
              <div className="text-zinc-700 italic pt-8 text-center">initialising…</div>
            ) : auditLog.map((line, i) => (
              <div key={i} className={
                line.kind === 'ok'   ? 'text-emerald-400' :
                line.kind === 'warn' ? 'text-amber-400' :
                line.kind === 'dim'  ? 'text-zinc-700' :
                'text-zinc-400'
              }>
                <span className="text-zinc-700 mr-1.5">{line.ts}</span>{line.text}
              </div>
            ))}
          </div>
        </div>

        </div>{/* end grid */}
      </div>
    );
  }

  /* ── Compact / standard mode (unchanged) ── */
  return (
    <div className={`rounded-2xl border border-violet-500/25 bg-violet-500/5 ${compact ? 'p-4' : 'p-5'}`}>
      <div className="mb-4 flex items-start gap-4">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-[rgba(176,128,92,0.25)] bg-black/40">
          <Image src={svgPath(token)} alt={`FakeNormie #${token}`} fill className="object-contain p-1" unoptimized />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm font-bold text-[#f2eee4]">FakeNormie #{token}</span>
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
          onClick={() => void poll(token)}
          className="rounded border border-[rgba(176,128,92,0.2)] bg-black/30 px-2.5 py-1 font-mono text-[10px] text-[var(--muted)] hover:text-white transition"
        >
          ↻ refresh
        </button>
      </div>
    </div>
  );
}
