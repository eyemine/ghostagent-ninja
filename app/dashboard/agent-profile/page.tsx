'use client';

/**
 * /dashboard/agent-profile
 *
 * Edit the ERC-8004 off-chain fields for any agent owned by the connected wallet.
 * Editable: description, web URL, social links (X, GitHub, Farcaster, custom).
 * Not editable: agentWallet (= Safe address, trustless on-chain, immutable here).
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePrivy, useWallets } from '@privy-io/react-auth';

const WORKER_URL = 'https://nftmail-email-worker.richard-159.workers.dev';
const GHOST_LOGO = '/ghost-logo.png';

interface KnownAgent { name: string; tld: string; safe: string; }

interface AgentProfile {
  description: string;
  webUrl: string;
  socialLinks: {
    x?: string;
    github?: string;
    farcaster?: string;
    [key: string]: string | undefined;
  };
}

const EMPTY_PROFILE: AgentProfile = {
  description: '',
  webUrl: '',
  socialLinks: { x: '', github: '', farcaster: '' },
};

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function AgentProfilePage() {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const connectedWallet = wallets[0]?.address ?? null;

  const [ownedAgents, setOwnedAgents] = useState<KnownAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [profile, setProfile] = useState<AgentProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [liveCard, setLiveCard] = useState<Record<string, unknown> | null>(null);

  const selected = ownedAgents[selectedIdx] ?? null;

  // Load agents owned by the connected wallet
  useEffect(() => {
    if (!connectedWallet) { setOwnedAgents([]); return; }
    setAgentsLoading(true);
    setSelectedIdx(0);
    fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'listAgents', safeAddress: connectedWallet }),
    })
      .then(r => r.json() as Promise<{ agents?: Array<{ name: string; tld: string; erc8004?: { gnosis?: { agentId: number } } }> }>)
      .then(data => {
        const agents: KnownAgent[] = (data.agents ?? []).map(a => ({
          name: a.name,
          tld:  a.tld,
          safe: connectedWallet,
        }));
        setOwnedAgents(agents);
      })
      .catch(() => setOwnedAgents([]))
      .finally(() => setAgentsLoading(false));
  }, [connectedWallet]);

  const loadProfile = useCallback(async (agentName: string) => {
    setLoading(true);
    setError('');
    setLiveCard(null);
    try {
      const [profileRes, cardRes] = await Promise.all([
        fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getAgentProfile', agentName }),
        }),
        fetch(`/api/agent-card?agent=${agentName}`),
      ]);
      if (profileRes.ok) {
        const { profile: kv } = await profileRes.json() as { profile: Partial<AgentProfile> };
        setProfile({
          description: kv.description ?? '',
          webUrl:       kv.webUrl       ?? '',
          socialLinks:  { x: '', github: '', farcaster: '', ...(kv.socialLinks ?? {}) },
        });
      }
      if (cardRes.ok) {
        setLiveCard(await cardRes.json());
      }
    } catch {
      setError('Failed to load profile.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) loadProfile(selected.name);
  }, [selected, loadProfile]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:      'setAgentProfile',
          agentName:   selected.name,
          description: profile.description || undefined,
          webUrl:      profile.webUrl       || undefined,
          socialLinks: Object.fromEntries(
            Object.entries(profile.socialLinks).filter(([, v]) => v),
          ),
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      setSaved(true);
      // Reload live card to show merged result
      const cardRes = await fetch(`/api/agent-card?agent=${selected.name}`);
      if (cardRes.ok) setLiveCard(await cardRes.json());
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  function setSocial(key: string, value: string) {
    setProfile(p => ({ ...p, socialLinks: { ...p.socialLinks, [key]: value } }));
  }

  return (
    <div className="space-y-8">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={GHOST_LOGO} alt="GhostAgent" className="h-14 w-14 object-contain drop-shadow-[0_0_14px_rgba(184,134,97,0.4)]" />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-[#f2eee4]">Agent Profile</h1>
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-500/20">
                ERC-8004
              </span>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-500/20">
                off-chain fields
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Edit your agent&apos;s description, website, and social links. Changes reflect in the live ERC-8004 card immediately.
            </p>
          </div>
        </div>
        <Link
          href="/dashboard"
          className="shrink-0 rounded-lg border border-[rgba(176,128,92,0.3)] bg-black/20 px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition hover:text-white"
        >
          ← Dashboard
        </Link>
      </div>

      {/* ── Info banner ── */}
      <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-[rgba(176,128,92,0.04)] p-4 space-y-1.5">
        <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">HOW THIS WORKS</div>
        <p className="text-[11px] text-[var(--muted)] leading-relaxed">
          ERC-8004 stores only a <span className="text-amber-300 font-medium">URI pointer</span> on-chain.
          The JSON it points to is served live from this platform — so editing these fields requires no wallet transaction.
          Your agent&apos;s <span className="text-emerald-300 font-medium">Safe address</span> is the payment wallet
          and is bound on-chain — it is not editable here.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">

        {/* ── Left: editor ── */}
        <div className="space-y-5">

          {/* Agent selector */}
          <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] p-5 space-y-4">
            <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">SELECT AGENT</div>
            {agentsLoading ? (
              <div className="text-xs text-[var(--muted)] py-2">Loading your agents…</div>
            ) : !authenticated ? (
              <div className="text-xs text-[var(--muted)] py-2">Connect wallet to see your agents.</div>
            ) : ownedAgents.length === 0 ? (
              <div className="text-xs text-[var(--muted)] py-2">No agents found for this wallet.</div>
            ) : (
              <div className="flex gap-3 flex-wrap">
                {ownedAgents.map((agent, i) => {
                  const sld = (agent.tld || 'agent.gno').replace('.gno', '');
                  return (
                    <button
                      key={agent.name}
                      onClick={() => setSelectedIdx(i)}
                      className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                        selectedIdx === i
                          ? 'border-amber-500/40 bg-amber-500/8'
                          : 'border-[rgba(176,128,92,0.15)] bg-transparent hover:border-[rgba(176,128,92,0.3)]'
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/genome-image?sld=${sld}&name=${encodeURIComponent(agent.name)}`}
                        alt={agent.name}
                        className="h-16 w-16 rounded-lg border border-[rgba(176,128,92,0.2)] object-cover"
                      />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-semibold text-[#f2eee4]">{agent.name}</span>
                        <span className="text-[11px] text-[var(--muted)]">{agent.tld || 'unknown'}</span>
                        <span className="font-mono text-[10px] text-zinc-500">{shortAddr(agent.safe)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {!authenticated || !selected ? (
            <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-[rgba(176,128,92,0.05)] px-6 py-10 text-center">
              <p className="text-sm text-[var(--muted)]">
                {!authenticated ? 'Connect your wallet to edit agent profiles.' : 'Select an agent above.'}
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] p-5 space-y-5">

              {loading ? (
                <div className="py-8 text-center text-xs text-[var(--muted)]">Loading profile…</div>
              ) : (
                <>
                  {/* Description */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">
                      DESCRIPTION
                      <span className="ml-2 font-normal normal-case text-zinc-600">
                        What does this agent do? ({profile.description.length}/500)
                      </span>
                    </label>
                    <textarea
                      rows={4}
                      value={profile.description}
                      onChange={e => setProfile(p => ({ ...p, description: e.target.value.slice(0, 500) }))}
                      placeholder="A sovereign ghost agent operating across GNS namespaces…"
                      className="w-full rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/30 px-4 py-3 text-xs text-[#f2eee4] placeholder-zinc-600 outline-none focus:border-amber-500/40 resize-none leading-relaxed"
                    />
                  </div>

                  {/* Web URL */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">
                      WEBSITE URL
                      <span className="ml-2 font-normal normal-case text-zinc-600">agent&apos;s primary web endpoint</span>
                    </label>
                    <input
                      type="url"
                      value={profile.webUrl}
                      onChange={e => setProfile(p => ({ ...p, webUrl: e.target.value.slice(0, 200) }))}
                      placeholder={`https://ghostagent.ninja/agent/${selected?.name}`}
                      className="w-full rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/30 px-4 py-2.5 text-xs text-[#f2eee4] placeholder-zinc-600 outline-none focus:border-amber-500/40 font-mono"
                    />
                  </div>

                  {/* Social links */}
                  <div className="space-y-2">
                    <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">
                      SOCIAL LINKS
                      <span className="ml-2 font-normal normal-case text-zinc-600">added as service endpoints in ERC-8004</span>
                    </div>
                    {[
                      { key: 'x',        label: 'X (Twitter)', placeholder: 'https://x.com/yourhandle' },
                      { key: 'github',   label: 'GitHub',      placeholder: 'https://github.com/yourrepo' },
                      { key: 'farcaster',label: 'Farcaster',   placeholder: 'https://warpcast.com/yourname' },
                    ].map(({ key, label, placeholder }) => (
                      <div key={key} className="flex items-center gap-3">
                        <span className="w-20 shrink-0 text-[10px] text-zinc-500">{label}</span>
                        <input
                          type="url"
                          value={profile.socialLinks[key] ?? ''}
                          onChange={e => setSocial(key, e.target.value)}
                          placeholder={placeholder}
                          className="flex-1 rounded-xl border border-[rgba(176,128,92,0.15)] bg-black/30 px-3 py-2 text-[11px] text-[#f2eee4] placeholder-zinc-700 outline-none focus:border-amber-500/30 font-mono"
                        />
                      </div>
                    ))}
                  </div>

                  {/* Safe (read-only) */}
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">
                      PAYMENT WALLET (SAFE)
                      <span className="ml-2 font-normal normal-case text-zinc-500">on-chain · not editable here</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-black/20 px-4 py-2.5">
                      <span className="font-mono text-[11px] text-zinc-500 flex-1 truncate">{selected?.safe}</span>
                      <span className="text-[9px] text-zinc-700 shrink-0">ERC-8004 agentWallet</span>
                    </div>
                  </div>

                  {/* Error */}
                  {error && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-2.5 text-xs text-red-400">
                      {error}
                    </div>
                  )}

                  {/* Save */}
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="rounded-xl bg-amber-600/80 px-6 py-2.5 text-xs font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save Profile'}
                    </button>
                    {saved && (
                      <span className="text-xs text-emerald-400">✓ Saved — live card updated</span>
                    )}
                    <span className="ml-auto text-[10px] text-zinc-600">No wallet transaction required</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Right: live card preview ── */}
        <div className="space-y-4">
          <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)] px-1">LIVE ERC-8004 CARD</div>

          <div className="rounded-2xl border border-[rgba(176,128,92,0.2)] bg-[var(--card)] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-amber-300/80">
                /api/agent-card?agent={selected?.name}
              </span>
              <a
                href={`/api/agent-card?agent=${selected?.name}`}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-zinc-500 hover:text-zinc-300 transition"
              >
                open ↗
              </a>
            </div>

            {liveCard ? (
              <div className="space-y-2.5">
                {/* Name */}
                <div className="space-y-0.5">
                  <div className="text-[9px] text-zinc-600 tracking-widest">NAME</div>
                  <div className="text-xs font-mono text-[#f2eee4]">{liveCard.name as string}</div>
                </div>
                {/* Description */}
                <div className="space-y-0.5">
                  <div className="text-[9px] text-zinc-600 tracking-widest">DESCRIPTION</div>
                  <div className="text-[11px] text-[var(--muted)] leading-relaxed">{liveCard.description as string}</div>
                </div>
                {/* Services */}
                <div className="space-y-1">
                  <div className="text-[9px] text-zinc-600 tracking-widest">SERVICES</div>
                  {(liveCard.services as Array<{ name: string; endpoint: string }>)?.map(s => (
                    <div key={s.name} className="flex items-start gap-2">
                      <span className="w-16 shrink-0 text-[9px] text-amber-300/70 font-mono pt-0.5">{s.name}</span>
                      <span className="text-[10px] text-zinc-400 font-mono break-all">{s.endpoint}</span>
                    </div>
                  ))}
                </div>
                {/* Registrations */}
                {(liveCard.registrations as Array<{ agentId: number; agentRegistry: string }>)?.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[9px] text-zinc-600 tracking-widest">ON-CHAIN ID</div>
                    {(liveCard.registrations as Array<{ agentId: number; agentRegistry: string }>).map(r => (
                      <div key={r.agentId} className="text-[10px] font-mono text-emerald-400/80">
                        #{r.agentId} · {r.agentRegistry}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-zinc-600">Loading card…</div>
            )}
          </div>

          {/* Note about agentURI */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-1.5">
            <div className="text-[9px] font-semibold tracking-widest text-zinc-600">ON-CHAIN POINTER</div>
            <p className="text-[10px] text-zinc-600 leading-relaxed">
              The ERC-8004 token on-chain stores only a URI pointing to this endpoint.
              Updating the description or links here changes the JSON immediately — no gas required.
              To update the on-chain URI itself, the token owner must call <span className="font-mono text-zinc-500">setAgentURI()</span> on the registry.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
