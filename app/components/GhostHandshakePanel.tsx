'use client';

/**
 * GhostHandshakePanel
 *
 * Interactive UI for signing and registering a Ghost-Tunnel handshake.
 * Shows: build → sign (EIP-712) → register → live tunnel status.
 *
 * Used in:
 *   - /dashboard/swarm (Vertex hackathon demo page)
 *   - /dashboard/settings/ghost (embedded)
 */

import { useState, useCallback } from 'react';
import { useWallets } from '@privy-io/react-auth';
import {
  buildGhostHandshake,
  signGhostHandshake,
  registerGhostHandshake,
  validateGhostHandshake,
  resolveGhostTunnel,
  GHOST_HANDSHAKE_DOMAIN,
  type GhostHandshake,
  type GhostRegistration,
  type GhostProtocol,
} from '../services/ghost-handshake';
import type { Address } from 'viem';
import { createWalletClient, custom } from 'viem';
import { gnosis } from 'viem/chains';

type Step = 'idle' | 'building' | 'signing' | 'registering' | 'done' | 'error';

interface TunnelStatus {
  endpoint: string;
  protocol: GhostProtocol;
  active:   boolean;
}

interface Props {
  agentName:   string;       // fully qualified e.g. "alice.vault.gno"
  safeAddress: string;
  ghostId?:    string;       // SBT token ID
}

const PRESET_LLM = [
  'Ollama/llama3.2:3b',
  'Ollama/mistral-7b',
  'LMStudio/mistral-7b-instruct',
  'LMStudio/phi-3-mini',
  'OpenAI/gpt-4o',
];

const PRESET_MCP = [
  'filesystem',
  'memory-vault',
  'local-python-exec',
  'story-sdk-mcp',
  'ghost-tunnel',
];

export function GhostHandshakePanel({ agentName, safeAddress, ghostId }: Props) {
  const { wallets } = useWallets();

  const [step,          setStep]          = useState<Step>('idle');
  const [tunnelEndpoint,setTunnelEndpoint] = useState('https://');
  const [protocol,      setProtocol]      = useState<GhostProtocol>('A2A-RPC');
  const [llm,           setLlm]           = useState(PRESET_LLM[0]);
  const [mcpServers,    setMcpServers]     = useState<string[]>(['filesystem', 'memory-vault']);
  const [mcpInput,      setMcpInput]       = useState('');
  const [handshake,     setHandshake]      = useState<GhostHandshake | null>(null);
  const [handshakeHash, setHandshakeHash]  = useState<string | null>(null);
  const [registeredAt,  setRegisteredAt]   = useState<number | null>(null);
  const [tunnelStatus,  setTunnelStatus]   = useState<TunnelStatus | null>(null);
  const [errorMsg,      setErrorMsg]       = useState<string | null>(null);
  const [resolving,     setResolving]      = useState(false);

  const resolveStatus = useCallback(async () => {
    setResolving(true);
    const t = await resolveGhostTunnel(agentName);
    setTunnelStatus(t);
    setResolving(false);
  }, [agentName]);

  function toggleMcp(server: string) {
    setMcpServers(prev =>
      prev.includes(server) ? prev.filter(s => s !== server) : [...prev, server]
    );
  }

  function addCustomMcp() {
    const s = mcpInput.trim();
    if (!s || mcpServers.includes(s)) return;
    setMcpServers(prev => [...prev, s]);
    setMcpInput('');
  }

  async function handleSign() {
    if (!tunnelEndpoint.startsWith('https://') || !agentName.endsWith('.vault.gno')) {
      setErrorMsg(
        !agentName.endsWith('.vault.gno')
          ? 'Ghost tier requires a .vault.gno agent name'
          : 'Tunnel endpoint must start with https://'
      );
      return;
    }
    if (mcpServers.length === 0) {
      setErrorMsg('At least one MCP server is required');
      return;
    }

    const wallet = wallets[0];
    if (!wallet) { setErrorMsg('No wallet connected'); return; }

    setStep('building');
    setErrorMsg(null);

    try {
      const unsigned = buildGhostHandshake({
        ghostId:       ghostId ?? '0x1',
        agentName,
        safeAddress:   safeAddress as Address,
        tunnelEndpoint,
        protocol,
        llm,
        mcpServers,
        capabilities:  [],
      });

      const preCheck = validateGhostHandshake({
        ...unsigned,
        heartbeat: { ...unsigned.heartbeat, signature: '0x' + '0'.repeat(130) as `0x${string}` },
      });
      if (!preCheck.valid) throw new Error(preCheck.reason);

      setStep('signing');

      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        chain:     gnosis,
        transport: custom(provider),
      });

      const signed = await signGhostHandshake(walletClient, unsigned);
      setHandshake(signed);

      setStep('registering');

      const result = await registerGhostHandshake(signed);
      if (!result.ok) throw new Error(result.error ?? 'Registration failed');

      setHandshakeHash(result.handshakeHash ?? null);
      setRegisteredAt(result.registeredAt ?? null);
      setStep('done');

      await resolveStatus();
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStep('error');
    }
  }

  const isVaultGno = agentName.endsWith('.vault.gno');

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">🌐</span>
          <span className="text-xs font-bold text-[#f2eee4]">Ghost-Tunnel Handshake</span>
          <span className="rounded-full bg-fuchsia-500/10 px-2 py-0.5 text-[9px] font-bold text-fuchsia-300 ring-1 ring-fuchsia-500/20">
            EIP-712
          </span>
        </div>
        <button
          onClick={resolveStatus}
          disabled={resolving}
          className="text-[10px] text-[var(--muted)] hover:text-[#f2eee4] transition disabled:opacity-50"
        >
          {resolving ? '…' : '↻ Check tunnel'}
        </button>
      </div>

      {/* ── Gating: must be vault.gno ── */}
      {!isVaultGno && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
          Ghost-Tunnel requires a <strong>.vault.gno</strong> agent name. Current: <code className="font-mono">{agentName}</code>
        </div>
      )}

      {/* ── Tunnel status ── */}
      {tunnelStatus && (
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
          tunnelStatus.active
            ? 'border-emerald-500/25 bg-emerald-500/5'
            : 'border-zinc-600/25 bg-zinc-800/20'
        }`}>
          <span className={`h-2 w-2 rounded-full shrink-0 ${tunnelStatus.active ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-semibold text-[#f2eee4]">
              {tunnelStatus.active ? 'Tunnel Active' : 'Tunnel Stale'} · {tunnelStatus.protocol}
            </div>
            <div className="font-mono text-[9px] text-[var(--muted)] truncate">{tunnelStatus.endpoint}</div>
          </div>
        </div>
      )}

      {/* ── Form (idle / error) ── */}
      {(step === 'idle' || step === 'error') && isVaultGno && (
        <div className="space-y-3">

          {/* Tunnel endpoint */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-[var(--muted)]">TUNNEL ENDPOINT</label>
            <input
              value={tunnelEndpoint}
              onChange={e => setTunnelEndpoint(e.target.value)}
              placeholder="https://abc123.ghost-tunnel.ninja"
              className="w-full rounded-lg border border-[var(--border)] bg-black/30 px-3 py-2 text-xs text-[#f2eee4] placeholder:text-zinc-600 outline-none focus:border-fuchsia-500/40 font-mono"
            />
          </div>

          {/* Protocol */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-[var(--muted)]">PROTOCOL</label>
            <div className="flex gap-1.5">
              {(['A2A-RPC', 'MCP-over-HTTP', 'XMTP', 'nftmail'] as GhostProtocol[]).map(p => (
                <button
                  key={p}
                  onClick={() => setProtocol(p)}
                  className={`rounded-lg border px-2.5 py-1 text-[9px] font-semibold transition-all ${
                    protocol === p
                      ? 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300'
                      : 'border-[rgba(176,128,92,0.15)] text-[var(--muted)] hover:text-[#f2eee4]'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* LLM */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-[var(--muted)]">LOCAL BRAIN (LLM)</label>
            <div className="flex gap-1.5 flex-wrap">
              {PRESET_LLM.map(l => (
                <button
                  key={l}
                  onClick={() => setLlm(l)}
                  className={`rounded-lg border px-2.5 py-1 text-[9px] transition-all ${
                    llm === l
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                      : 'border-[rgba(176,128,92,0.15)] text-[var(--muted)] hover:text-[#f2eee4]'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* MCP servers */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-[var(--muted)]">MCP SERVERS</label>
            <div className="flex gap-1.5 flex-wrap">
              {PRESET_MCP.map(s => (
                <button
                  key={s}
                  onClick={() => toggleMcp(s)}
                  className={`rounded-lg border px-2.5 py-1 text-[9px] transition-all ${
                    mcpServers.includes(s)
                      ? 'border-violet-500/40 bg-violet-500/10 text-violet-300'
                      : 'border-[rgba(176,128,92,0.15)] text-[var(--muted)] hover:text-[#f2eee4]'
                  }`}
                >
                  {mcpServers.includes(s) ? '✓ ' : ''}{s}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={mcpInput}
                onChange={e => setMcpInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustomMcp()}
                placeholder="custom-mcp-server"
                className="flex-1 rounded-lg border border-[var(--border)] bg-black/30 px-2.5 py-1.5 text-[10px] text-[#f2eee4] placeholder:text-zinc-600 outline-none focus:border-violet-500/40"
              />
              <button
                onClick={addCustomMcp}
                className="rounded-lg border border-[rgba(176,128,92,0.3)] px-3 py-1.5 text-[10px] text-[var(--muted)] hover:text-[#f2eee4] transition"
              >
                + Add
              </button>
            </div>
            {mcpServers.filter(s => !PRESET_MCP.includes(s)).map(s => (
              <div key={s} className="flex items-center justify-between rounded-lg border border-violet-500/20 bg-violet-500/5 px-2.5 py-1">
                <span className="text-[10px] text-violet-300">{s}</span>
                <button onClick={() => toggleMcp(s)} className="text-[9px] text-zinc-500 hover:text-red-400 transition">✕</button>
              </div>
            ))}
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[10px] text-red-400">
              {errorMsg}
            </div>
          )}

          {/* EIP-712 domain preview */}
          <div className="rounded-lg bg-black/30 border border-[rgba(176,128,92,0.15)] px-3 py-2 space-y-1">
            <div className="text-[9px] font-semibold tracking-widest text-[var(--muted)]">EIP-712 DOMAIN</div>
            <div className="space-y-0.5 font-mono text-[9px] text-zinc-500">
              <div><span className="text-zinc-400">name:</span> {GHOST_HANDSHAKE_DOMAIN.name}</div>
              <div><span className="text-zinc-400">chainId:</span> {GHOST_HANDSHAKE_DOMAIN.chainId} (Gnosis)</div>
              <div><span className="text-zinc-400">contract:</span> {GHOST_HANDSHAKE_DOMAIN.verifyingContract.slice(0, 10)}…</div>
            </div>
          </div>

          <button
            onClick={handleSign}
            disabled={!wallets[0]}
            className="w-full rounded-xl bg-gradient-to-r from-fuchsia-700 to-violet-700 py-3 text-sm font-bold text-white shadow-lg shadow-fuchsia-500/15 transition hover:shadow-fuchsia-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {wallets[0] ? '🌐 Sign & Register Tunnel' : 'Connect wallet to continue'}
          </button>
        </div>
      )}

      {/* ── In-progress states ── */}
      {(step === 'building' || step === 'signing' || step === 'registering') && (
        <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 px-4 py-6 text-center space-y-3">
          <svg className="h-8 w-8 animate-spin mx-auto text-fuchsia-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83"/>
          </svg>
          <div className="text-sm font-semibold text-fuchsia-300">
            {step === 'building'    ? 'Building handshake payload…' :
             step === 'signing'     ? 'Waiting for EIP-712 signature…' :
             'Registering with swarm router…'}
          </div>
          <div className="flex items-center justify-center gap-6 text-[10px]">
            {(['building', 'signing', 'registering'] as Step[]).map((s, i, arr) => (
              <div key={s} className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${step === s ? 'bg-fuchsia-400 animate-pulse' : (arr.indexOf(step) > i ? 'bg-emerald-400' : 'bg-zinc-700')}`} />
                <span className={step === s ? 'text-fuchsia-300' : arr.indexOf(step) > i ? 'text-emerald-400' : 'text-zinc-600'}>
                  {s}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Done ── */}
      {step === 'done' && handshake && (
        <div className="space-y-3">
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">✅</span>
              <span className="text-sm font-bold text-emerald-300">Tunnel Registered</span>
              {registeredAt && (
                <span className="ml-auto text-[9px] text-zinc-600">
                  {new Date(registeredAt).toLocaleTimeString()}
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex gap-2 text-[10px]">
                <span className="text-[var(--muted)] shrink-0 w-20">Agent</span>
                <span className="font-mono text-[#f2eee4]">{handshake.agentName}</span>
              </div>
              <div className="flex gap-2 text-[10px]">
                <span className="text-[var(--muted)] shrink-0 w-20">Endpoint</span>
                <span className="font-mono text-[#b0805c] break-all">{handshake.connection.endpoint}</span>
              </div>
              <div className="flex gap-2 text-[10px]">
                <span className="text-[var(--muted)] shrink-0 w-20">Protocol</span>
                <span className="text-fuchsia-300">{handshake.connection.protocol}</span>
              </div>
              <div className="flex gap-2 text-[10px]">
                <span className="text-[var(--muted)] shrink-0 w-20">LLM</span>
                <span className="text-amber-300">{handshake.localStack.llm}</span>
              </div>
              <div className="flex gap-2 text-[10px]">
                <span className="text-[var(--muted)] shrink-0 w-20">MCP</span>
                <span className="text-violet-300">{handshake.localStack.mcpServers.join(', ')}</span>
              </div>
            </div>

            {handshakeHash && (
              <div className="rounded-lg bg-black/30 px-3 py-2 space-y-0.5">
                <div className="text-[9px] font-semibold tracking-widest text-[var(--muted)]">HANDSHAKE HASH</div>
                <div className="font-mono text-[9px] text-[#b0805c] break-all">{handshakeHash}</div>
              </div>
            )}

            <div className="rounded-lg bg-black/30 px-3 py-2 space-y-0.5">
              <div className="text-[9px] font-semibold tracking-widest text-[var(--muted)]">EIP-712 SIGNATURE</div>
              <div className="font-mono text-[9px] text-zinc-500 break-all">{handshake.heartbeat.signature.slice(0, 40)}…</div>
            </div>
          </div>

          <button
            onClick={() => { setStep('idle'); setHandshake(null); setHandshakeHash(null); }}
            className="w-full rounded-xl border border-[rgba(176,128,92,0.25)] py-2 text-[10px] text-[var(--muted)] hover:text-[#f2eee4] transition"
          >
            Register another handshake
          </button>
        </div>
      )}
    </div>
  );
}
