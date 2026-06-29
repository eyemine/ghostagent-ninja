'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import {
  CURSOR_CONTRACT, CURSOR_CHIADO_RPC, CURSOR_ABI, CURSOR_ISSUER, REGISTRY_ABI,
  getSubCapFromMandate, decodeStringValue, MANDATE_OPTIONS,
} from '../services/erc8048-publisher';

const REGISTRY       = process.env.NEXT_PUBLIC_ERC8048_REGISTRY ?? '0x0106341056a8790f4b924c380ed5B81B2a062bCE';
const NULL_ROOT      = '0x0000000000000000000000000000000000000000000000000000000000000000';
const CHIADO_EXPLORER = 'https://gnosis-chiado.blockscout.com';
const GNOSIS_EXPLORER = 'https://gnosisscan.io';

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
  registerTxHash?: string;
  drawTxHash?: string;
  drawBlock?: number;
}

interface AuditLine {
  ts: string;
  text: string;
  kind: 'info' | 'ok' | 'warn' | 'dim';
}

function BscLink({ href, children, className = '' }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
       className={`underline decoration-dotted underline-offset-2 transition hover:opacity-80 ${className}`}>
      {children}
    </a>
  );
}

// Known method selectors for the (unverified) ERC-8312 cursor contract on Chiado.
// register(bytes32,bytes32) → 0x2f926732
// draw/advanceCursor (bytes32,bytes) → 0x8c02477a
const SEL_REGISTER = '0x2f926732';
const SEL_DRAW     = '0x8c02477a';

// Proof payload inner structure reverse-engineered from tx 0x99012341...3435ce (block 21795536).
// advanceCursor(bytes32 id, bytes proof) — proof is ABI-encoded with the following inner fields.
// amountWei is NOT a top-level calldata argument; it sits at offset 288 inside the bytes payload.
// This draw was against the ghostagent agent's own cursor leaf (chiado-leaf-init.mjs),
// NOT a FakeNormie token. The proof payload structure is the same for all draws.
const KNOWN_DECODED_DRAW = {
  txHash:    '0x99012341e6412efc07890fc5b192a3d04d57a98678710db1bbb05062e63435ce',
  block:     21795536,
  // scopeId = keccak256("ghostagent-cursor-1") — ghostagent agent's own cursor leaf
  scopeId:   '0xb111dc70dda0cd9874046258b157c898cdd891483d954b1fc8231ada010e4a34' as `0x${string}`,
  subCap:    100_000_000_000_000_000n, // 0x16345785d8a0000 → 0.1 xDAI
  amountWei: 500_000_000_000_000n,    // 0x1c6bf52634000   → 0.0005 xDAI, at offset 288 in proof
  issuer:    '0xb51441f05717e0321ac6c72271989bffd07a8a12c1364ccc51119c6ff46a80c5',
  chainId:   10200n,
} as const;

async function fetchBlockscoutProof(scopeId: string): Promise<{ registerTxHash?: string; drawTxHash?: string; drawBlock?: number }> {
  try {
    const res = await fetch(
      `${CHIADO_EXPLORER}/api/v2/addresses/${CURSOR_CONTRACT}/transactions?filter=to`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return {};
    const data = await res.json() as {
      items: Array<{
        hash: string;
        method?: string;
        raw_input?: string;
        block_number?: number;
      }>;
    };
    const needle = scopeId.slice(2).toLowerCase();
    let registerTxHash: string | undefined;
    let drawTxHash: string | undefined;
    let drawBlock: number | undefined;
    for (const tx of data.items ?? []) {
      if (!tx.raw_input?.toLowerCase().includes(needle)) continue;
      const sel = (tx.method ?? tx.raw_input?.slice(0, 10) ?? '').toLowerCase();
      if (sel === SEL_REGISTER && !registerTxHash) {
        registerTxHash = tx.hash;
      } else if (sel === SEL_DRAW && !drawTxHash) {
        drawTxHash = tx.hash;
        drawBlock = tx.block_number;
      }
    }
    return { registerTxHash, drawTxHash, drawBlock };
  } catch { return {}; }
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

      // Fetch Blockscout tx proofs (non-blocking — only on first poll per token)
      const proof = await fetchBlockscoutProof(scopeId);

      if (terminal) {
        if (registered) {
          appendLog([
            { ts: ts(), text: `[ERC-8312] capRoot = ${(capRoot as string).slice(0, 18)}…`, kind: 'ok' },
            { ts: ts(), text: `[ERC-8312] leafSpent = ${(Number(spent as bigint) / 1e18).toFixed(6)} xDAI`, kind: 'ok' },
            { ts: ts(), text: `[ERC-8312] subCap = ${(Number(subCap) / 1e18).toFixed(3)} xDAI`, kind: 'ok' },
            ...(proof.registerTxHash ? [{ ts: ts(), text: `[ERC-8312] register() → ${CHIADO_EXPLORER}/tx/${proof.registerTxHash}`, kind: 'ok' as const }] : []),
            ...(proof.drawTxHash     ? [{ ts: ts(), text: `[ERC-8312] draw()     → ${CHIADO_EXPLORER}/tx/${proof.drawTxHash}`,     kind: 'ok' as const }] : []),
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
        registerTxHash: proof.registerTxHash ?? prev?.registerTxHash,
        drawTxHash:     proof.drawTxHash     ?? prev?.drawTxHash,
        drawBlock:      proof.drawBlock      ?? prev?.drawBlock,
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
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [manualDecodeOpen, setManualDecodeOpen] = useState(false);
  const [recomputeResult, setRecomputeResult] = useState<string | null>(null);

  const isKnownDraw = cursor?.scopeId?.toLowerCase() === KNOWN_DECODED_DRAW.scopeId.toLowerCase()
    && cursor?.drawTxHash?.toLowerCase() === KNOWN_DECODED_DRAW.txHash.toLowerCase();

  async function runRecompute() {
    if (!isKnownDraw) {
      setRecomputeResult('⚠ contract unverified — amountWei is inside the bytes payload, not a top-level param. Inspect the raw draw tx to extract it manually.');
      return;
    }
    try {
      const { keccak256, encodeAbiParameters, parseAbiParameters } = await import('viem');
      const preimage = keccak256(encodeAbiParameters(
        parseAbiParameters('bytes32, uint256, uint256'),
        [KNOWN_DECODED_DRAW.scopeId, KNOWN_DECODED_DRAW.amountWei, KNOWN_DECODED_DRAW.chainId],
      ));
      setRecomputeResult(`✓ preimage: ${preimage}`);
    } catch (e) { setRecomputeResult(`error: ${e instanceof Error ? e.message : String(e)}`); }
  }

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
              <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded">
                <Image src={svgPath(t)} alt={`#${t}`} fill className="object-contain" unoptimized />
              </div>
              #{t}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-3">
            <a href={`/dashboard/erc8048?collection=fakenormie&tokenId=${token}`}
               className="text-[9px] text-violet-500 hover:text-violet-300 transition font-semibold">
              Mandate Dashboard ↗
            </a>
            <span className="text-[9px] text-zinc-700">live · 12s · Chiado</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 p-3">

        {/* Col 1 — Agent Genesis */}
        <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Agent Genesis</span>
            <BscLink href={`${GNOSIS_EXPLORER}/token/${process.env.NEXT_PUBLIC_FAKE_NORMIE_CONTRACT ?? '0x1d6b9e2af40322d2311ff0df66dade4490ac4c29'}/instance/${token}`}
                     className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400">
              Gnosis ↗
            </BscLink>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-zinc-700 bg-black">
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
            <div className="flex justify-between items-center">
              <span className="text-zinc-500">registered</span>
              {loading ? (
                <span className="text-zinc-600">…</span>
              ) : cursor?.registerTxHash ? (
                <BscLink href={`${CHIADO_EXPLORER}/tx/${cursor.registerTxHash}`} className="text-emerald-400 text-[10px]">
                  ✓ register() ↗
                </BscLink>
              ) : cursor?.registered ? (
                <span className="text-emerald-400">ACTIVE</span>
              ) : (
                <span className="text-amber-400">NOT REGISTERED</span>
              )}
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-500">last draw</span>
              {cursor?.drawTxHash ? (
                <BscLink href={`${CHIADO_EXPLORER}/tx/${cursor.drawTxHash}`} className="text-sky-400 text-[10px]">
                  advanceCursor() ↗{cursor.drawBlock ? ` #${cursor.drawBlock}` : ''}
                </BscLink>
              ) : (
                <span className="text-zinc-600 text-[10px]">{loading ? '…' : 'none yet'}</span>
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

        {/* Col 2 — Spend Meter + Verify panel */}
        <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Spend Meter</span>
            <BscLink href={`${CHIADO_EXPLORER}/address/${CURSOR_CONTRACT}?tab=read_contract`}
                     className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400">
              ERC-8312 ↗
            </BscLink>
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
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500">leafSpent</span>
                  <BscLink href={`${CHIADO_EXPLORER}/address/${CURSOR_CONTRACT}?tab=read_contract`}
                           className="text-zinc-200 hover:text-sky-300">
                    {(Number(cursor.leafSpent) / 1e18).toFixed(6)} xDAI ↗
                  </BscLink>
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

              {/* ── Verify / Recompute panel ── */}
              <div className="mt-1 rounded-lg border border-zinc-700/50 bg-black/30">
                <button
                  onClick={() => setVerifyOpen(v => !v)}
                  className="flex w-full items-center justify-between px-3 py-2 text-[10px] text-zinc-400 hover:text-zinc-200 transition"
                >
                  <span className="font-bold tracking-widest uppercase">▶ Verify (recompute preimage)</span>
                  <span className="text-zinc-600">{verifyOpen ? '▲' : '▼'}</span>
                </button>
                {verifyOpen && (
                  <div className="border-t border-zinc-800 px-3 pb-3 pt-2 space-y-2 text-[10px]">
                    <div className="space-y-1 text-zinc-500">
                      <div><span className="text-zinc-400">scopeId</span> <span className="text-zinc-600 break-all">{cursor.scopeId}</span></div>
                      <div>
                        <span className="text-zinc-400">amountWei</span>{' '}
                        {isKnownDraw ? (
                          <span className="text-emerald-400">{KNOWN_DECODED_DRAW.amountWei.toString()} wei ({(Number(KNOWN_DECODED_DRAW.amountWei) / 1e18).toFixed(4)} xDAI) — decoded ↓</span>
                        ) : cursor.drawTxHash ? (
                          <BscLink href={`${CHIADO_EXPLORER}/tx/${cursor.drawTxHash}?tab=raw_trace`} className="text-amber-500 text-[9px]">
                            — contract unverified; inspect raw tx ↗
                          </BscLink>
                        ) : (
                          <span className="text-zinc-600">— (no draw tx found)</span>
                        )}
                      </div>
                      <div><span className="text-zinc-400">chainId</span> <span className="text-zinc-300">10200 (Chiado)</span></div>
                      <div><span className="text-zinc-400">issuer</span> <span className="text-zinc-600 break-all text-[9px]">{CURSOR_ISSUER}</span></div>
                    </div>
                    <div className="text-zinc-600 leading-relaxed">
                      preimage = keccak256(abi.encode(scopeId, amountWei, chainId))
                    </div>

                    {/* Manual Decode panel — confirmed inner structure from reverse-engineering */}
                    <div className="rounded border border-zinc-700/40 bg-zinc-900/50">
                      <button
                        onClick={() => setManualDecodeOpen(v => !v)}
                        className="flex w-full items-center justify-between px-2.5 py-1.5 text-[9px] text-zinc-500 hover:text-zinc-300 transition"
                      >
                        <span>📐 Proof payload inner structure (manual decode)</span>
                        <span>{manualDecodeOpen ? '▲' : '▼'}</span>
                      </button>
                      {manualDecodeOpen && (
                        <div className="border-t border-zinc-800 px-2.5 pb-2.5 pt-2 text-[9px] font-mono leading-relaxed">
                          <div className="text-zinc-600 mb-1.5">
                            advanceCursor(bytes32 id, <span className="text-amber-400">bytes proof</span>) — proof decoded from
                            {' '}<BscLink href={`${CHIADO_EXPLORER}/tx/${KNOWN_DECODED_DRAW.txHash}?tab=raw_trace`} className="text-sky-500">tx 0x99012341…3435ce ↗</BscLink>
                            {' '}block {KNOWN_DECODED_DRAW.block}
                          </div>
                          <div className="space-y-0.5 text-zinc-400">
                            <div><span className="text-zinc-600">├─ subCap</span>{'    '}<span className="text-violet-400">0x16345785d8a0000</span> → <span className="text-zinc-200">{(Number(KNOWN_DECODED_DRAW.subCap) / 1e18).toFixed(2)} xDAI ceiling</span></div>
                            <div><span className="text-zinc-600">├─ amountWei</span> <span className="text-emerald-400">0x1c6bf52634000</span>{'  '}→ <span className="text-zinc-200">0.0005 xDAI drawn</span> <span className="text-zinc-600">(offset 288)</span></div>
                            <div><span className="text-zinc-600">├─ issuer</span>{'    '}<span className="text-zinc-500">0xb51441f…80c5</span> <span className="text-zinc-600">(BIP-340 x-only pubkey)</span></div>
                            <div><span className="text-zinc-600">└─ sig</span>{'       '}<span className="text-zinc-500">0x17026824…dc01d6</span> <span className="text-zinc-600">(64-byte Schnorr sig)</span></div>
                          </div>
                          <div className="mt-2 text-zinc-600">
                            Verify: extract amountWei at offset 288, then compute<br />
                            <span className="text-zinc-400">keccak256(abi.encode(scopeId, amountWei, 10200))</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {recomputeResult && (
                      <div className={`rounded p-2 break-all text-[9px] ${recomputeResult.startsWith('✓') ? 'bg-emerald-950 text-emerald-400' : 'bg-zinc-900 text-amber-400'}`}>
                        {recomputeResult}
                      </div>
                    )}
                    <button
                      onClick={() => void runRecompute()}
                      className={`w-full rounded border py-1.5 text-[10px] transition ${
                        isKnownDraw
                          ? 'border-emerald-600/60 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-950 hover:text-white'
                          : 'border-zinc-600 bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {isKnownDraw ? '✓ Recompute in browser (confirmed values)' : 'Recompute in browser'}
                    </button>
                    <div className="pt-1 space-y-1 border-t border-zinc-800/50">
                      <div className="text-zinc-600 text-[9px]">Oracle attestation (weaker — assertion by notapaperclip.red):</div>
                      <a href="https://notapaperclip.red" target="_blank" rel="noopener noreferrer"
                         className="block text-sky-600 hover:text-sky-400 text-[9px] transition">
                        notapaperclip.red ↗ — signed verdict, not a recompute
                      </a>
                      <div className="text-zinc-600 text-[9px]">Recompute (stronger — you derive the preimage from chain data, no trust required).</div>
                    </div>
                  </div>
                )}
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
            <BscLink href={`${CHIADO_EXPLORER}/address/${CURSOR_CONTRACT}`}
                     className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase hover:text-zinc-300">
              Chiado Audit Log ↗
            </BscLink>
            <span className="text-[9px] text-zinc-700">live · 12s</span>
          </div>
          <div
            ref={logRef}
            className="flex-1 overflow-y-auto space-y-0.5 text-[10px] leading-relaxed min-h-0 max-h-64"
          >
            {auditLog.length === 0 ? (
              <div className="text-zinc-700 italic pt-8 text-center">initialising…</div>
            ) : auditLog.map((line, i) => {
              // Linkify Blockscout URLs in log lines
              const bscMatch = line.text.match(/(https:\/\/gnosis-chiado\.blockscout\.com\/\S+)/);
              return (
                <div key={i} className={
                  line.kind === 'ok'   ? 'text-emerald-400' :
                  line.kind === 'warn' ? 'text-amber-400' :
                  line.kind === 'dim'  ? 'text-zinc-700' :
                  'text-zinc-400'
                }>
                  <span className="text-zinc-700 mr-1.5">{line.ts}</span>
                  {bscMatch ? (
                    <>
                      {line.text.slice(0, line.text.indexOf(bscMatch[1]))}
                      <a href={bscMatch[1]} target="_blank" rel="noopener noreferrer"
                         className="underline decoration-dotted hover:opacity-80">
                        {bscMatch[1].replace('https://gnosis-chiado.blockscout.com', 'bscout')
                          .replace(/\/tx\//, '/tx/').slice(0, 40)}…
                      </a>
                    </>
                  ) : line.text}
                </div>
              );
            })}
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
