'use client';

/// A2ACardModal — renders a GhostAgent's A2A Agent Card visually
/// Used in:
///   - Dashboard AgentCard (owner view — full private telemetry)
///   - Marketplace ItemCard (public view — skills + ERC-8004 only)

import { useEffect, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface A2ASkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
}

interface AgentCardData {
  // A2A fields
  name: string;
  description: string;
  version: string;
  supportedInterfaces: { url: string; protocolBinding: string; protocolVersion: string }[];
  capabilities: { streaming: boolean; pushNotifications: boolean; extendedAgentCard: boolean };
  skills: A2ASkill[];
  extensions: { uri: string; description: string; params: Record<string, unknown> }[];
  // ERC-8004 registration fields (from /api/agent/[name]/registration.json)
  active?: boolean;
  registrations?: { agentId: number; agentRegistry: string }[];
  // Telemetry (private, from getAgentStatus)
  telemetry?: {
    surgeScore: number;
    inbox: { count: number };
    heartbeat: { isActive: boolean; lastBeat?: number };
    erc8004AgentId?: number;
    safe?: string;
    accountTier?: string;
  };
}

interface Props {
  agentName: string;
  isOwner?: boolean;  // true → show private telemetry panel
  onClose: () => void;
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

const WORKER_URL = 'https://nftmail-email-worker.richard-159.workers.dev';
const APP_URL    = 'https://ghostagent.ninja';

async function fetchAgentCard(): Promise<AgentCardData> {
  const [cardRes, regRes] = await Promise.all([
    fetch(`${APP_URL}/.well-known/agent-card.json`, { cache: 'no-store' }),
    fetch(`${APP_URL}/api/agent/ghostagent/registration.json`, { cache: 'no-store' }),
  ]);
  const card = await cardRes.json();
  const reg  = regRes.ok ? await regRes.json() : {};
  return { ...card, active: reg.active, registrations: reg.registrations ?? [] };
}

async function fetchTelemetry(agentName: string) {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'getAgentStatus', localPart: `${agentName}_` }),
  });
  return res.ok ? res.json() : null;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function StatusDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {active && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${active ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
    </span>
  );
}

function Pill({ children, color = 'zinc' }: { children: React.ReactNode; color?: string }) {
  const cls: Record<string, string> = {
    zinc:    'bg-zinc-500/10 text-zinc-400 ring-zinc-500/20',
    violet:  'bg-violet-500/10 text-violet-300 ring-violet-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20',
    amber:   'bg-amber-500/10 text-amber-300 ring-amber-500/20',
    sky:     'bg-sky-500/10 text-sky-300 ring-sky-500/20',
    fuchsia: 'bg-fuchsia-500/10 text-fuchsia-300 ring-fuchsia-500/20',
    rose:    'bg-rose-500/10 text-rose-300 ring-rose-500/20',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${cls[color] ?? cls.zinc}`}>
      {children}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-bold tracking-[0.14em] text-[var(--muted)] uppercase">{title}</span>
        <div className="h-px flex-1 bg-[rgba(176,128,92,0.15)]" />
      </div>
      {children}
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export default function A2ACardModal({ agentName, isOwner = false, onClose }: Props) {
  const [card, setCard]         = useState<AgentCardData | null>(null);
  const [telemetry, setTelemetry] = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<'overview' | 'skills' | 'telemetry'>('overview');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchAgentCard(),
      isOwner ? fetchTelemetry(agentName) : Promise.resolve(null),
    ]).then(([cardData, telData]) => {
      if (cancelled) return;
      setCard(cardData);
      setTelemetry(telData);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [agentName, isOwner]);

  // Close on backdrop click
  function handleBackdrop(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const agentId    = card?.registrations?.[0]?.agentId;
  const chainInfo  = card?.registrations?.[0]?.agentRegistry; // "eip155:100:0x..."
  const [, chainId, registryAddr] = (chainInfo ?? '::').split(':');
  const isActive   = card?.active ?? false;
  const primaryIface = card?.supportedInterfaces?.[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={handleBackdrop}
    >
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-[rgba(176,128,92,0.4)] bg-[#0f0703] shadow-2xl"
        style={{ maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[rgba(176,128,92,0.2)] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(176,128,92,0.12)] text-sm">
              👻
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[#f2eee4]">{agentName}</span>
                <StatusDot active={isActive} />
                {isActive && <Pill color="emerald">Active</Pill>}
              </div>
              <p className="text-[10px] text-[var(--muted)]">A2A Agent Card · RC v1.0</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-white/5 hover:text-white"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[rgba(176,128,92,0.15)] px-5">
          {(['overview', 'skills', ...(isOwner ? ['telemetry'] as const : [])] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t as typeof tab)}
              className={`px-3 py-2.5 text-[11px] font-semibold capitalize transition border-b-2 -mb-px ${
                tab === t
                  ? 'border-[#b0805c] text-[#f2eee4]'
                  : 'border-transparent text-[var(--muted)] hover:text-[#f2eee4]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5" style={{ maxHeight: 'calc(90vh - 130px)' }}>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[rgba(176,128,92,0.3)] border-t-[#b0805c]" />
            </div>
          ) : !card ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">Failed to load agent card.</p>
          ) : (

            <>
              {/* ── OVERVIEW ── */}
              {tab === 'overview' && (
                <div className="space-y-5">
                  <p className="text-xs leading-relaxed text-[var(--muted)]">{card.description}</p>

                  <Section title="ERC-8004 Identity">
                    <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/20 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[var(--muted)]">Agent ID</span>
                        {agentId ? (
                          <a
                            href={`https://gnosisscan.io/token/${registryAddr}?a=${agentId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-mono font-semibold text-[#b0805c] hover:underline"
                          >
                            #{agentId} ↗
                          </a>
                        ) : (
                          <Pill color="zinc">Unregistered</Pill>
                        )}
                      </div>
                      {chainId && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[var(--muted)]">Chain</span>
                          <Pill color="emerald">
                            {chainId === '100' ? 'Gnosis Mainnet' : `chainId:${chainId}`}
                          </Pill>
                        </div>
                      )}
                      {registryAddr && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[var(--muted)]">Registry</span>
                          <span className="font-mono text-[10px] text-[var(--muted)]">
                            {registryAddr.slice(0, 6)}…{registryAddr.slice(-4)}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[var(--muted)]">Registration JSON</span>
                        <a
                          href={`${APP_URL}/api/agent/ghostagent/registration.json`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-[#b0805c] hover:underline"
                        >
                          View ↗
                        </a>
                      </div>
                    </div>
                  </Section>

                  <Section title="A2A Interfaces">
                    <div className="space-y-2">
                      {card.supportedInterfaces.map((iface, i) => (
                        <div key={i} className="flex items-center justify-between rounded-lg border border-[rgba(176,128,92,0.15)] bg-black/20 px-3 py-2">
                          <div className="flex items-center gap-2">
                            {i === 0 && <Pill color="amber">Primary</Pill>}
                            <Pill color={iface.protocolBinding === 'JSONRPC' ? 'violet' : 'sky'}>
                              {iface.protocolBinding}
                            </Pill>
                          </div>
                          <a
                            href={iface.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate max-w-[180px] font-mono text-[10px] text-[var(--muted)] hover:text-[#b0805c]"
                          >
                            {iface.url.replace('https://', '')}
                          </a>
                        </div>
                      ))}
                    </div>
                  </Section>

                  <Section title="Capabilities">
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: 'JSON-RPC 2.0',       active: true },
                        { label: 'Streaming',           active: card.capabilities.streaming },
                        { label: 'Push Notifications',  active: card.capabilities.pushNotifications },
                        { label: 'Extended Card',       active: card.capabilities.extendedAgentCard },
                        { label: 'ERC-8004',            active: !!agentId },
                        { label: 'EIP-712 TradeIntents',active: true },
                        { label: 'A2A-Version: 1.0',    active: true },
                      ].map(({ label, active }) => (
                        <span
                          key={label}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ${
                            active
                              ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20'
                              : 'bg-zinc-500/10 text-zinc-500 ring-zinc-500/15'
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                          {label}
                        </span>
                      ))}
                    </div>
                  </Section>

                  {/* Raw JSON link */}
                  <a
                    href={`${APP_URL}/.well-known/agent-card.json`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[11px] text-[var(--muted)] hover:text-[#b0805c] transition"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    View raw /.well-known/agent-card.json
                  </a>
                </div>
              )}

              {/* ── SKILLS ── */}
              {tab === 'skills' && (
                <div className="space-y-3">
                  {card.skills.map(skill => (
                    <div
                      key={skill.id}
                      className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/20 p-4 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-[#f2eee4]">{skill.name}</span>
                        <Pill color="violet">{skill.id}</Pill>
                      </div>
                      <p className="text-[11px] leading-relaxed text-[var(--muted)]">{skill.description}</p>
                      <div className="flex flex-wrap gap-1">
                        {skill.tags.map(tag => (
                          <Pill key={tag} color="zinc">{tag}</Pill>
                        ))}
                      </div>
                      {skill.examples?.[0] && (
                        <div className="rounded-lg bg-black/40 p-2">
                          <p className="text-[9px] font-semibold tracking-wider text-[var(--muted)] mb-1">EXAMPLE</p>
                          <code className="block text-[10px] text-[#b0805c] break-all leading-relaxed">
                            {skill.examples[0].startsWith('{')
                              ? skill.examples[0]
                              : skill.examples[0]}
                          </code>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ── TELEMETRY (owner only) ── */}
              {tab === 'telemetry' && isOwner && (
                <div className="space-y-5">
                  {!telemetry ? (
                    <p className="py-6 text-center text-sm text-[var(--muted)]">Telemetry unavailable.</p>
                  ) : (
                    <>
                      <Section title="Live Status">
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: 'INBOX',      value: telemetry.inbox?.count ?? 0,          color: 'text-[#f2eee4]' },
                            { label: 'SURGE',      value: (telemetry.surgeScore ?? 0).toFixed(1), color: 'text-violet-300' },
                            { label: 'ERC-8004 ID',value: telemetry.erc8004AgentId ?? '—',       color: 'text-[#b0805c]' },
                          ].map(({ label, value, color }) => (
                            <div key={label} className="rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/20 px-3 py-2.5">
                              <div className="text-[9px] font-semibold tracking-wider text-[var(--muted)]">{label}</div>
                              <div className={`mt-0.5 text-sm font-semibold ${color}`}>{value}</div>
                            </div>
                          ))}
                        </div>
                      </Section>

                      <Section title="Heartbeat">
                        <div className="flex items-center justify-between rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/20 px-4 py-3">
                          <div className="flex items-center gap-2">
                            <StatusDot active={telemetry.heartbeat?.isActive ?? false} />
                            <span className="text-xs text-[#f2eee4]">
                              {telemetry.heartbeat?.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          {telemetry.heartbeat?.lastBeat && (
                            <span className="text-[10px] text-[var(--muted)]">
                              Last: {new Date(telemetry.heartbeat.lastBeat).toLocaleTimeString()}
                            </span>
                          )}
                        </div>
                      </Section>

                      {telemetry.safe && (
                        <Section title="Gnosis Safe">
                          <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/20 px-4 py-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-[var(--muted)]">Safe Address</span>
                              <a
                                href={`https://app.safe.global/home?safe=gno:${telemetry.safe}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-[10px] text-[#b0805c] hover:underline"
                              >
                                {telemetry.safe.slice(0, 6)}…{telemetry.safe.slice(-4)} ↗
                              </a>
                            </div>
                          </div>
                        </Section>
                      )}

                      <Section title="EIP-155 Chain Binding">
                        <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/20 p-4 space-y-2.5">
                          {[
                            { label: 'Standard',      value: 'EIP-155 Validated',       color: 'text-emerald-300' },
                            { label: 'Primary Chain', value: 'Gnosis Mainnet (ID: 100)', color: 'text-[#f2eee4]' },
                            { label: 'Testnet',       value: 'Ethereum Sepolia (ID: 11155111)', color: 'text-amber-300' },
                            { label: 'EIP-1271',      value: 'Gnosis Safe — contract signature validation', color: 'text-sky-300' },
                            { label: 'EIP-712',       value: 'TradeIntents chain-bound, replay-protected',  color: 'text-violet-300' },
                          ].map(({ label, value, color }) => (
                            <div key={label} className="flex items-start justify-between gap-3">
                              <span className="shrink-0 text-[10px] text-[var(--muted)]">{label}</span>
                              <span className={`text-right text-[10px] font-medium ${color}`}>{value}</span>
                            </div>
                          ))}
                        </div>
                      </Section>

                      <Section title="Test A2A SendMessage">
                        <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/20 p-3 space-y-1.5">
                          <p className="text-[10px] text-[var(--muted)]">
                            POST <code className="text-[#b0805c]">/api/a2a</code> — JSON-RPC 2.0 with EIP-712 metadata:
                          </p>
                          <pre className="overflow-x-auto rounded bg-black/40 p-2 text-[9px] text-emerald-300 leading-relaxed whitespace-pre-wrap break-all">{JSON.stringify({
                            jsonrpc: '2.0', id: '1', method: 'SendMessage',
                            params: {
                              message: { role: 'user', parts: [{ text: `status of ${agentName}` }] },
                              metadata: {
                                agentName,
                                chainId: 100,
                                eip155: true,
                                eip712Domain: { name: 'GhostAgent', version: '1', chainId: 100 },
                              },
                            },
                          }, null, 2)}</pre>
                        </div>
                      </Section>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
