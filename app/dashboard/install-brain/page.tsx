'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { GenomeEditor } from '../../components/GenomeEditor';
import { AgentCapabilityForm } from '../../components/AgentCapabilityForm';
import { InstallBrain } from '../../components/InstallBrain';
import { defaultGenomeMetadata, type GenomeMetadata, type SldKey } from '../../services/genome-metadata';

const GHOST_LOGO = '/ghost-logo.png';
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';

type BrainType = 'cloudflare' | 'safe';

export default function InstallBrainPage() {
  const searchParams = useSearchParams();
  const [brainType, setBrainType] = useState<BrainType>('cloudflare');
  const [agentName, setAgentName] = useState('');
  const [agentSld, setAgentSld] = useState<SldKey>('agent');
  const [genomeMeta, setGenomeMeta] = useState<GenomeMetadata | null>(null);
  const [tbaAddress, setTbaAddress] = useState<string>('');
  const [safeAddress, setSafeAddress] = useState<string>('');
  const [identityLoading, setIdentityLoading] = useState(false);

  // Read body query parameter and pre-fill agentName
  useEffect(() => {
    const bodyParam = searchParams.get('body');
    if (bodyParam) {
      const agentNameFormatted = bodyParam.replace(/-/g, '.');
      setAgentName(agentNameFormatted);
      setGenomeMeta(defaultGenomeMetadata(agentNameFormatted, agentSld));
    }
  }, [searchParams, agentSld]);

  // Fetch real TBA + Safe from KV whenever agentName changes
  useEffect(() => {
    if (!agentName || agentName.length < 2) { setTbaAddress(''); setSafeAddress(''); return; }
    setIdentityLoading(true);
    fetch(`/api/agent-lookup?q=${agentName}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: Record<string, unknown> | null) => {
        if (!data) return;
        const tba  = data.tbaAddress  as string | null ?? '';
        const safe = data.safeAddress as string | null ?? data.safe as string | null ?? '';
        setTbaAddress(tba);
        setSafeAddress(safe);
      })
      .catch(() => {})
      .finally(() => setIdentityLoading(false));
  }, [agentName]);

  const tbaDisplay = identityLoading ? 'loading…' : (tbaAddress || '0x…your-tba-address');
  const nftmailAddr = agentName ? `${agentName}_@nftmail.box` : '';

  function handleNameChange(val: string) {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9._-]/g, '');
    setAgentName(cleaned);
    setGenomeMeta(cleaned ? defaultGenomeMetadata(cleaned, agentSld) : null);
  }

  return (
    <div className="max-w-5xl space-y-6">

      {/* ── Hero ── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={GHOST_LOGO} alt="GhostAgent" className="h-28 w-28 shrink-0 object-contain drop-shadow-[0_0_18px_rgba(184,134,97,0.4)]" />
          <div>
            <h1 className="text-2xl font-bold text-[#f2eee4]">Install Agent Brain</h1>
            <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
              Attach intelligence to your agent body. A brain lets your agent receive and send A2A email,
              execute tasks, and post autonomously.
            </p>
          </div>
        </div>
        <a
          href="https://nftmail.box/"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg border border-[rgba(176,128,92,0.3)] bg-[rgba(176,128,92,0.08)] px-4 py-1.5 text-xs font-semibold transition hover:bg-[rgba(176,128,92,0.14)]"
          style={{ fontFamily: "Ayuthaya, 'Courier New', monospace", color: '#d9d9d8' }}
        >
          NFTmail.box ↗
        </a>
      </div>

      {/* ── SELECT BRAIN TYPE ── */}
      <div className="space-y-3">
        <div className="text-xs font-semibold tracking-[0.18em] text-[var(--muted)]">SELECT BRAIN TYPE</div>
        <div className="grid gap-3 sm:grid-cols-2">

          {/* Cloudflare Worker */}
          <button
            onClick={() => setBrainType('cloudflare')}
            className={`relative flex flex-col gap-2 rounded-xl border p-4 text-left transition-all ${
              brainType === 'cloudflare'
                ? 'border-[rgba(0,163,255,0.5)] bg-[rgba(0,163,255,0.08)]'
                : 'border-[var(--border)] bg-[var(--card)] hover:border-[rgba(0,163,255,0.25)]'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className={`text-sm font-semibold ${brainType === 'cloudflare' ? 'text-[rgb(160,220,255)]' : 'text-[#f2eee4]'}`}>
                Cloudflare Worker Brain
              </span>
              <span className="rounded-full border border-emerald-500/50 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                FREE
              </span>
            </div>
            <p className="text-xs text-[var(--muted)]">
              Deploy a JS Worker on Cloudflare. Free tier, zero infrastructure, auto-polls your inbox every 5 min.
            </p>
          </button>

          {/* Safe Brain Module */}
          <button
            onClick={() => setBrainType('safe')}
            className={`relative flex flex-col gap-2 rounded-xl border p-4 text-left transition-all ${
              brainType === 'safe'
                ? 'border-[rgba(176,128,92,0.5)] bg-[rgba(176,128,92,0.08)]'
                : 'border-[var(--border)] bg-[var(--card)] hover:border-[rgba(176,128,92,0.25)]'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className={`text-sm font-semibold ${brainType === 'safe' ? 'text-[#b0805c]' : 'text-[#f2eee4]'}`}>
                Safe Brain Module
              </span>
              <span className="rounded-full border border-violet-500/50 px-2 py-0.5 text-[10px] font-bold text-violet-300">
                ON-CHAIN
              </span>
            </div>
            <p className="text-xs text-[var(--muted)]">
              Installs an on-chain module into a Gnosis Safe smart account. The Safe acts as the agent&apos;s
              custodian — transactions are signed by the Safe&apos;s owners and executed on-chain. Best for
              high-value agents that need cryptographic accountability for every action.
            </p>
          </button>

        </div>
      </div>

      {/* ── TARGET AGENT BODY NAME ── */}
      <div className="space-y-2">
        <div className="text-xs font-semibold tracking-[0.18em] text-[var(--muted)]">TARGET AGENT BODY NAME</div>
        <div className="flex gap-2">
          <div className="flex-1 rounded-xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] px-4 py-3">
            <input
              value={agentName}
              onChange={e => handleNameChange(e.target.value)}
              placeholder="postmaster"
              className="w-full bg-transparent text-sm text-[#f2eee4] outline-none placeholder:text-[var(--muted)]"
            />
          </div>
          {/* SLD picker */}
          <select
            value={agentSld}
            onChange={e => {
              const sld = e.target.value as SldKey;
              setAgentSld(sld);
              if (agentName) setGenomeMeta(defaultGenomeMetadata(agentName, sld));
            }}
            className="rounded-xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--muted)] outline-none focus:border-[rgba(176,128,92,0.5)] cursor-pointer"
          >
            <option value="agent">agent.gno</option>
            <option value="openclaw">openclaw.gno</option>
            <option value="molt">molt.gno</option>
            <option value="picoclaw">picoclaw.gno</option>
            <option value="vault">vault.gno</option>
            <option value="nftmail">nftmail.gno</option>
          </select>
        </div>
        {agentName && (
          <p className="text-xs text-[rgb(160,220,255)]">
            Brain will be attached to <span className="font-semibold">{agentName}_@nftmail.box</span>
          </p>
        )}
      </div>

      {/* ── Genome NFT + Capabilities ── */}
      {agentName.length >= 2 && (
        <div className="rounded-xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] p-5 space-y-6">
          <GenomeEditor
            agentName={agentName}
            sld={agentSld}
            value={genomeMeta}
            onChange={setGenomeMeta}
            showDescription={true}
            compact={true}
          />
          <div className="h-px bg-[rgba(176,128,92,0.15)]" />
          <AgentCapabilityForm
            value={genomeMeta}
            brainType={brainType}
            onChange={setGenomeMeta}
          />
        </div>
      )}

      {/* ── Steps panel ── */}
      {brainType === 'cloudflare' && (
        <CloudflarePanel agentName={agentName} tbaAddress={tbaAddress} tbaDisplay={tbaDisplay} nftmailAddr={nftmailAddr} />
      )}
      {brainType === 'safe' && (
        <SafePanel agentName={agentName} safeAddress={safeAddress} tbaAddress={tbaAddress} />
      )}

    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-[10px] text-[var(--muted)] hover:text-[#f2eee4] transition-colors"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CloudflarePanel({ agentName, tbaAddress, tbaDisplay, nftmailAddr }: { agentName: string; tbaAddress: string; tbaDisplay: string; nftmailAddr: string }) {
  const [workerUrl, setWorkerUrl] = useState('');
  const [registering, setRegistering] = useState(false);
  const [registerResult, setRegisterResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function registerWorkerUrl() {
    if (!workerUrl || !agentName) return;
    setRegistering(true);
    setRegisterResult(null);
    try {
      const res = await fetch('/api/agent-worker-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName, workerUrl }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      setRegisterResult({ ok: !!data.ok, msg: data.ok ? 'Worker URL registered ✓' : (data.error ?? 'Failed') });
    } catch (e: unknown) {
      setRegisterResult({ ok: false, msg: (e as Error).message ?? 'Network error' });
    } finally {
      setRegistering(false);
    }
  }
  return (
    <div className="rounded-xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] p-5 space-y-4">
      <div>
        <div className="text-sm font-semibold text-[#f2eee4]">Attach Cloudflare Worker</div>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Deploys an OpenClaw JS Worker and attaches it to your agent&apos;s TBA. Cloud-native, zero cost.
        </p>
      </div>

      {/* Step 1 */}
      <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/20 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[rgba(176,128,92,0.3)] bg-[var(--card)] text-xs font-bold text-[#f2eee4]">
            1
          </span>
          <div>
            <div className="text-sm font-semibold text-[#f2eee4]">Deploy OpenClaw Worker</div>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Fork the template, set your agent name + TBA as env vars, deploy to Cloudflare Workers (free tier).
            </p>
          </div>
        </div>
        <div className="flex gap-2 pl-9">
          <a
            href="https://github.com/Ghost-Agency/ghostagent-proxy"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(176,128,92,0.3)] bg-black/30 px-3 py-1.5 text-xs font-medium text-[#f2eee4] hover:bg-white/5 transition-colors"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/>
            </svg>
            GitHub Template
          </a>
          <a
            href="https://developers.cloudflare.com/workers/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-[rgba(176,128,92,0.3)] bg-black/30 px-3 py-1.5 text-xs font-medium text-[var(--muted)] hover:text-[#f2eee4] hover:bg-white/5 transition-colors"
          >
            CF Workers Docs
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17 17 7M7 7h10v10"/></svg>
          </a>
        </div>

        {/* Env vars block */}
        <div className="ml-9 rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/40 p-3 space-y-1.5 font-mono text-xs">
          <div className="text-[10px] font-semibold tracking-[0.14em] text-[var(--muted)] mb-2">REQUIRED ENV VARS</div>
          <div className="flex items-center gap-1">
            <span className="text-[rgb(160,220,255)]">AGENT_NAME</span>
            <span className="text-[var(--muted)]"> = </span>
            <span className="text-[#f2eee4]">{agentName || 'your-agent-name'}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[rgb(160,220,255)]">TBA_ADDRESS</span>
            <span className="text-[var(--muted)]"> = </span>
            <span className="text-amber-300">{tbaDisplay}</span>
            {tbaAddress && <CopyBtn text={tbaAddress} />}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[rgb(160,220,255)]">NFTMAIL_ADDRESS</span>
            <span className="text-[var(--muted)]"> = </span>
            <span className="text-[#b0805c]">{nftmailAddr || 'agentname_@nftmail.box'}</span>
          </div>
        </div>
      </div>

      {/* Step 2 */}
      <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/20 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[rgba(176,128,92,0.3)] bg-[var(--card)] text-xs font-bold text-[#f2eee4]">
            2
          </span>
          <div>
            <div className="text-sm font-semibold text-[#f2eee4]">Register Worker URL</div>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              After deploying your Cloudflare Worker, paste its URL below. This stores it in the GhostAgent registry so A2A messages get routed to your worker.
            </p>
          </div>
        </div>
        <div className="flex gap-2 pl-9">
          <input
            value={workerUrl}
            onChange={e => setWorkerUrl(e.target.value)}
            placeholder="https://my-agent.myaccount.workers.dev"
            className="flex-1 rounded-lg border border-[rgba(176,128,92,0.25)] bg-black/40 px-3 py-2 text-xs text-[#f2eee4] outline-none placeholder:text-[var(--muted)] focus:border-[rgba(176,128,92,0.5)]"
          />
          <button
            onClick={registerWorkerUrl}
            disabled={!workerUrl || !agentName || registering}
            className="rounded-lg border border-[rgba(176,128,92,0.3)] bg-[rgba(176,128,92,0.08)] px-3 py-2 text-xs font-semibold text-[#b0805c] transition hover:bg-[rgba(176,128,92,0.15)] disabled:opacity-40"
          >
            {registering ? 'Saving…' : 'Register'}
          </button>
        </div>
        {registerResult && (
          <p className={`pl-9 text-xs ${registerResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
            {registerResult.msg}
          </p>
        )}
      </div>

    </div>
  );
}

function SafePanel({ agentName, safeAddress, tbaAddress }: { agentName: string; safeAddress: string; tbaAddress: string }) {
  const [manualSafe, setManualSafe] = useState('');
  const [manualTba, setManualTba] = useState('');

  const effectiveSafe = (safeAddress || manualSafe) as `0x${string}` | '';
  const effectiveTba  = (tbaAddress  || manualTba)  as `0x${string}` | '';

  return (
    <div className="rounded-xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] p-5 space-y-4">
      <div>
        <div className="text-sm font-semibold text-[#f2eee4]">Install Safe Brain Module</div>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Installs the BrainModule as a Safe module and awakens it in the GhostRegistry.
          Your wallet must be a Safe owner to sign the transaction.
        </p>
      </div>

      {/* Address display / override */}
      <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/20 p-4 space-y-3">
        <div className="space-y-2">
          <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">SAFE ADDRESS</div>
          {effectiveSafe ? (
            <code className="block text-xs text-emerald-300 break-all">{effectiveSafe}</code>
          ) : (
            <input
              value={manualSafe}
              onChange={e => setManualSafe(e.target.value)}
              placeholder="0x… your Safe address"
              className="w-full rounded-lg border border-[rgba(176,128,92,0.25)] bg-black/40 px-3 py-2 text-xs text-[#f2eee4] outline-none placeholder:text-[var(--muted)]"
            />
          )}
        </div>
        <div className="space-y-2">
          <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">TBA ADDRESS (NFT token bound account)</div>
          {effectiveTba ? (
            <code className="block text-xs text-amber-300 break-all">{effectiveTba}</code>
          ) : (
            <input
              value={manualTba}
              onChange={e => setManualTba(e.target.value)}
              placeholder="0x… your TBA address"
              className="w-full rounded-lg border border-[rgba(176,128,92,0.25)] bg-black/40 px-3 py-2 text-xs text-[#f2eee4] outline-none placeholder:text-[var(--muted)]"
            />
          )}
        </div>

        {agentName && (
          <p className="text-xs text-[rgb(160,220,255)]">
            Brain for: <span className="font-semibold font-mono">{agentName}_@nftmail.box</span>
          </p>
        )}
      </div>

      {effectiveSafe && agentName ? (
        <InstallBrain
          agentName={agentName}
          safeAddress={effectiveSafe as `0x${string}`}
          tbaAddress={effectiveTba ? effectiveTba as `0x${string}` : undefined}
        />
      ) : (
        <p className="text-xs text-[var(--muted)]">
          {!agentName ? 'Enter an agent body name above first.' : 'Safe address required — enter it above or it will be fetched automatically.'}
        </p>
      )}
    </div>
  );
}
