'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallets } from '@privy-io/react-auth';
import Link from 'next/link';
import { FakeNormieLab } from '../components/FakeNormieLab';
import { NormieTrustBadge, type TrustTarget } from '../components/NormieTrustBadge';
import { generateNormieHandles } from '../services/agent-identity-router';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

const HEADER_IMG = '/FakeNormies/FakeNormie1.png';
const NORMIE_CONTRACT = '0x9eb6e2025b64f340691e424b7fe7022ffde12438'; // Normies on Ethereum mainnet
const NORMIES_BINDING_BASE = '0xde152afb7db5373f34876e1499fbd893a82dd336'; // Normies.art binding contract on Base
const ETH_RPC = 'https://cloudflare-eth.com';

interface Trait { trait_type: string; value: string; }
interface NormieData { tokenId: number; raw: string; attributes: Trait[]; pixelOn: number | null; isAgent: boolean | null; agentDelegate: string | null; }

// Existing deployed GhostAgents available for live trust verification.
const VERIFIED_AGENTS: Array<TrustTarget & { label: string }> = [
  { label: 'ghostagent.molt.gno', agentName: 'ghostagent', agentId: 3199, chain: 'gnosis', webUrl: 'https://ghostagent.ninja' },
  { label: 'eyemine.nftmail.gno', agentName: 'eyemine', agentId: 3205, chain: 'gnosis', webUrl: 'https://ghostagent.ninja' },
  { label: 'victor.openclaw.gno', agentName: 'victor', agentId: 3206, chain: 'gnosis', webUrl: 'https://ghostagent.ninja' },
];

const CAP_POOL = [
  'defi_swaps', 'meme_generation', 'governance_voting', 'data_analysis',
  'social_posting', 'nft_trading', 'yield_farming', 'arbitrage',
  'liquidity_provision', 'oracle_feeds',
];

// Personality flavour derived from the Normie's on-chain expression/type.
const EXPRESSION_TONE: Record<string, string> = {
  Peaceful: 'calm and deliberate', Angry: 'aggressive and competitive',
  Happy: 'optimistic and collaborative', Sad: 'cautious and risk-averse',
  Smug: 'confident and contrarian', Surprised: 'reactive and opportunistic',
  Bored: 'methodical and patient', Crazy: 'experimental and high-variance',
};
const TYPE_ARCHETYPE: Record<string, string> = {
  Human: 'a pragmatic operator', Alien: 'an unconventional strategist',
  Ape: 'a high-conviction degen', Zombie: 'a relentless background worker',
  Robot: 'a deterministic executor',
};

function deriveCapabilities(raw: string): string[] {
  const hex = raw.replace(/^0x/, '');
  const bytes = hex.match(/.{1,2}/g) ?? [];
  const picks: string[] = [];
  bytes.forEach((b, i) => {
    const n = parseInt(b, 16);
    if (!n) return;
    const cap = CAP_POOL[(n + i) % CAP_POOL.length];
    if (!picks.includes(cap)) picks.push(cap);
  });
  while (picks.length < 2) {
    const cap = CAP_POOL[picks.length];
    if (!picks.includes(cap)) picks.push(cap);
  }
  return picks.slice(0, 3);
}

function derivePersonality(attrs: Trait[]): string {
  const get = (t: string) => attrs.find((a) => a.trait_type === t)?.value ?? '';
  const tone = EXPRESSION_TONE[get('Expression')] ?? 'balanced and versatile';
  const archetype = TYPE_ARCHETYPE[get('Type')] ?? 'a steady generalist';
  const acc = get('Accessory');
  const flavour = acc && acc !== 'None' ? ` Signals with its ${acc.toLowerCase()}.` : '';
  return `${capitalize(tone)} — ${archetype}.${flavour}`;
}

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function traitEmoji(type: string): string {
  const map: Record<string, string> = {
    Type: '🧬', Gender: '⚧', Age: '⏳', 'Hair Style': '💇', 'Facial Feature': '🧔',
    Eyes: '👁️', Expression: '😐', Accessory: '🎀', Background: '🌌', Head: '🎩', Mouth: '👄',
  };
  return map[type] ?? '🔹';
}

export default function NormiesPage() {
  const { wallets } = useWallets();
  const wallet = wallets[0]?.address ?? null;

  const [tab, setTab] = useState<'mint' | 'preview'>('preview');
  const [id, setId] = useState('');
  const [normie, setNormie] = useState<NormieData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [owned, setOwned] = useState<boolean | null>(null);
  const [collection, setCollection] = useState<Array<{ tokenId: string; name: string; image: string }>>([]);
  const [trustAgent, setTrustAgent] = useState<(TrustTarget & { label: string })>(VERIFIED_AGENTS[0]);
  const [agentStatus, setAgentStatus] = useState<'idle' | 'checking' | 'registered' | 'unregistered'>('idle');
  const [registeredTarget, setRegisteredTarget] = useState<(TrustTarget & { label: string }) | null>(null);

  const fetchNormie = useCallback(async (rawId: string) => {
    const tid = parseInt(rawId, 10);
    if (Number.isNaN(tid) || tid < 0 || tid > 9999) { setError('Enter a valid Normie ID (0–9999)'); return; }
    setLoading(true); setError(null); setOwned(null);
    try {
      const [traitsRes, pixelsRes, canvasRes] = await Promise.all([
        fetch(`/api/normies/normie/${tid}/traits`),
        fetch(`/api/normies/normie/${tid}/pixels`),
        fetch(`/api/normies/normie/${tid}/canvas`).catch(() => null),
      ]);
      if (!traitsRes.ok) throw new Error('traits');
      const traits = (await traitsRes.json()) as { raw: string; attributes: Trait[] };
      let pixelOn: number | null = null;
      if (pixelsRes.ok) {
        const grid = await pixelsRes.text();
        pixelOn = (grid.match(/1/g) ?? []).length;
      }
      let isAgent: boolean | null = null;
      let agentDelegate: string | null = null;
      if (canvasRes && canvasRes.ok) {
        try {
          const canvas = (await canvasRes.json()) as { isAgent?: boolean; delegate?: string };
          if (typeof canvas.isAgent === 'boolean') isAgent = canvas.isAgent;
          if (typeof canvas.delegate === 'string' && canvas.delegate.startsWith('0x')) agentDelegate = canvas.delegate;
        } catch { /* canvas endpoint may not exist */ }
      }
      setNormie({ tokenId: tid, raw: traits.raw, attributes: traits.attributes, pixelOn, isAgent, agentDelegate });
    } catch {
      setError('Normie not found or API error');
      setNormie(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Ownership check via ownerOf(tokenId) on Ethereum mainnet
  useEffect(() => {
    if (!normie || !wallet) { setOwned(null); return; }
    let cancelled = false;
    const tokenHex = BigInt(normie.tokenId).toString(16).padStart(64, '0');
    fetch(ETH_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: NORMIE_CONTRACT, data: `0x6352211e${tokenHex}` }, 'latest'] }),
    })
      .then((r) => r.json())
      .then((d: { result?: string }) => {
        if (cancelled || !d.result || d.result === '0x') return;
        const ownerAddr = `0x${d.result.slice(-40)}`.toLowerCase();
        setOwned(ownerAddr === wallet.toLowerCase());
      })
      .catch(() => { if (!cancelled) setOwned(null); });
    return () => { cancelled = true; };
  }, [normie, wallet]);

  // Real "Your Collection" — fetch the connected wallet's Normies via Alchemy
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
    if (!wallet || !key) { setCollection([]); return; }
    let cancelled = false;
    fetch(`https://eth-mainnet.g.alchemy.com/nft/v3/${key}/getNFTsForOwner?owner=${wallet}&contractAddresses[]=${NORMIE_CONTRACT}&withMetadata=true&pageSize=12`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { ownedNfts?: Array<{ tokenId: string; name?: string; image?: { cachedUrl?: string; originalUrl?: string } }> } | null) => {
        if (cancelled || !d?.ownedNfts) return;
        setCollection(d.ownedNfts.map((n) => ({
          tokenId: n.tokenId,
          name: n.name ?? `Normie #${n.tokenId}`,
          image: n.image?.cachedUrl ?? n.image?.originalUrl ?? `/api/normies/normie/${n.tokenId}/image.png`,
        })));
      })
      .catch(() => { if (!cancelled) setCollection([]); });
    return () => { cancelled = true; };
  }, [wallet]);

  // Live ERC-8004 registration check for the previewed Normie's derived agent.
  useEffect(() => {
    if (!normie) { setAgentStatus('idle'); setRegisteredTarget(null); return; }
    let cancelled = false;
    setAgentStatus('checking'); setRegisteredTarget(null);
    const handles = generateNormieHandles(normie.tokenId);
    // Dotted form (normie.N) is the preferred identity name; hyphenated (normie-N) is the beacon subname.
    const candidates = Array.from(new Set([
      `normie.${normie.tokenId}`,
      `normie-${normie.tokenId}`,
      `normies.${normie.tokenId}`,
      `normies-${normie.tokenId}`,
      handles.ghostAgentName,
      handles.slug,
    ]));
    (async () => {
      for (const name of candidates) {
        try {
          const res = await fetch(WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'getAgentIdentity', agentName: name }),
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) continue;
          const data = (await res.json()) as { erc8004?: { gnosis?: { agentId?: number } } };
          const agentId = data?.erc8004?.gnosis?.agentId;
          if (typeof agentId === 'number' && !cancelled) {
            // Display name preserves dots (normie.100); beacon NFT subname is hyphenated (normie-100.agent.gno)
            setRegisteredTarget({ label: name, agentName: name, agentId, chain: 'gnosis', webUrl: 'https://ghostagent.ninja' });
            setAgentStatus('registered');
            return;
          }
        } catch { /* try next candidate */ }
      }
      if (!cancelled) { setAgentStatus('unregistered'); setRegisteredTarget(null); }
    })();
    return () => { cancelled = true; };
  }, [normie]);

  const capabilities = normie ? deriveCapabilities(normie.raw) : [];
  const personality = normie ? derivePersonality(normie.attributes) : '';

  return (
    <div className="min-h-screen bg-[var(--background)] pt-14">
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 pb-12 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={HEADER_IMG} alt="FakeNormies / Normies" className="h-28 w-28 rounded object-contain drop-shadow-[0_0_18px_rgba(184,134,97,0.4)]" />
          <div>
            <h1 className="pl-1 text-2xl font-bold text-[#f2eee4]">Normies V FakeNormies</h1>
          </div>
        </div>

        {/* Dual selection panel */}
        <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] p-4 space-y-3">
          <div className="text-xs font-semibold tracking-[0.18em] text-[var(--muted)]">IF YOU HAVENT MADE IT, FAKE IT!</div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setTab('preview')}
              className={`rounded-xl border px-4 py-4 text-left transition ${tab === 'preview' ? 'border-fuchsia-500/50 bg-fuchsia-500/10' : 'border-[rgba(176,128,92,0.2)] bg-black/20 hover:border-fuchsia-500/30'}`}
            >
              <p className={`text-sm font-bold ${tab === 'preview' ? 'text-fuchsia-300' : 'text-[#f2eee4]'}`}>Normie Preview Lab</p>
              <p className="text-[11px] text-[var(--muted)] mt-0.5">Read any real Normie&apos;s traits → derive a verified agent.</p>
            </button>
            <button
              onClick={() => setTab('mint')}
              className={`rounded-xl border px-4 py-4 text-left transition ${tab === 'mint' ? 'border-pink-500/50 bg-pink-500/10' : 'border-[rgba(176,128,92,0.2)] bg-black/20 hover:border-pink-500/30'}`}
            >
              <p className={`text-sm font-bold ${tab === 'mint' ? 'text-pink-300' : 'text-[#f2eee4]'}`}>FakeNormie Lab</p>
              <p className="text-[11px] text-[var(--muted)] mt-0.5">Free mint NFT on Gnosis – Basic GhostAgent tier</p>
            </button>
          </div>
        </div>

        {tab === 'mint' ? (
          <FakeNormieLab />
        ) : (
          <>
            {/* ID input */}
            <div className="flex gap-3">
              <input
                value={id}
                onChange={(e) => setId(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') fetchNormie(id); }}
                placeholder="Enter a real Normie ID (0–9999)"
                className="flex-1 rounded-lg border border-[rgba(176,128,92,0.3)] bg-black/40 px-4 py-2.5 text-sm text-[#f2eee4] outline-none focus:border-fuchsia-500/50"
              />
              <button
                onClick={() => fetchNormie(id)}
                disabled={loading}
                className="rounded-lg bg-fuchsia-600/80 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-fuchsia-600 disabled:opacity-50"
              >
                {loading ? 'Reading…' : 'Preview'}
              </button>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}

            {/* Preview */}
            {normie && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Visual + pixel seed */}
                <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] p-5 space-y-3">
                  <div className="aspect-square w-full overflow-hidden rounded-xl border border-white/10 bg-black/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/normies/normie/${normie.tokenId}/image.png`} alt={`Normie #${normie.tokenId}`} className="h-full w-full object-contain" />
                  </div>
                  <div className="rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/30 px-3 py-2">
                    <p className="text-[9px] font-semibold tracking-wider text-[var(--muted)] mb-0.5">PIXEL SEED → CAPABILITIES</p>
                    <p className="font-mono text-xs text-cyan-300 break-all">{normie.raw}</p>
                    {normie.pixelOn !== null && (
                      <p className="text-[10px] text-[var(--muted)] mt-1">{normie.pixelOn} active pixels (40×40 grid)</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {capabilities.map((c) => (
                        <span key={c} className="rounded bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 text-[10px] font-mono text-cyan-300">{c}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Traits + personality + CTAs */}
                <div className="space-y-4">
                  <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] p-5">
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-1.5">
                      <h2 className="text-lg font-bold text-[#f2eee4]">Normie #{normie.tokenId}</h2>
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">Real Normie</span>
                        {normie.isAgent === true && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300">🔥 Awakened</span>
                        )}
                        {normie.isAgent === false && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-amber-500/30 bg-amber-500/10 text-amber-300">💤 Dormant</span>
                        )}
                      </div>
                    </div>
                    <p className="text-[9px] font-semibold tracking-wider text-[var(--muted)] mb-2">ON-CHAIN TRAITS</p>
                    <div className="flex flex-wrap gap-2">
                      {normie.attributes.map((a) => (
                        <span key={a.trait_type} className="rounded-lg border border-[rgba(176,128,92,0.25)] bg-black/30 px-2.5 py-1 text-[11px] text-[#f2eee4]">
                          <span className="mr-1">{traitEmoji(a.trait_type)}</span>
                          <span className="text-[var(--muted)]">{a.trait_type}:</span> {a.value}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-fuchsia-500/30 bg-fuchsia-500/5 p-5">
                    <p className="text-[9px] font-semibold tracking-wider text-fuchsia-300/80 mb-1">DERIVED AGENT PERSONALITY</p>
                    <p className="text-sm text-[#f2eee4]">{personality}</p>
                  </div>

                  {/* Ownership-aware CTAs */}
                  <div className="space-y-2">
                    {owned ? (
                      <Link
                        href={`/pair-nft?nft=normie&tokenId=${normie.tokenId}`}
                        className="block w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3 text-center text-sm font-bold text-white transition hover:opacity-90"
                      >
                        Activate as GhostAgent (deploy Safe + ERC-8004) →
                      </Link>
                    ) : (
                      <div className="rounded-xl border border-[rgba(176,128,92,0.25)] bg-black/30 py-3 px-4 text-center">
                        <p className="text-xs text-[var(--muted)]">
                          {owned === false ? 'You don\u2019t own this Normie.' : wallet ? 'Checking ownership…' : 'Connect a wallet to check ownership.'}
                        </p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => setTab('mint')} className="rounded-xl border border-pink-500/30 bg-pink-500/10 py-2.5 text-xs font-semibold text-pink-300 transition hover:bg-pink-500/20">
                        Mint a FakeNormie to try (free)
                      </button>
                      <button onClick={() => { setNormie(null); setId(''); }} className="rounded-xl border border-[rgba(176,128,92,0.25)] py-2.5 text-xs font-semibold text-[var(--muted)] transition hover:text-white">
                        Clear preview
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Your Collection — real holdings */}
            {wallet && collection.length > 0 && (
              <div>
                <h3 className="text-[10px] font-semibold tracking-widest text-[var(--muted)] uppercase mb-3">Your Normies ({collection.length})</h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                  {collection.map((n) => (
                    <button key={n.tokenId} onClick={() => { setId(n.tokenId); fetchNormie(n.tokenId); }} className="rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/30 p-2 hover:border-fuchsia-500/40 transition">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={n.image} alt={n.name} className="w-full aspect-square object-contain rounded mb-1" />
                      <p className="text-[10px] text-[var(--muted)] truncate">#{n.tokenId}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Per-Normie identity panel — two tracks: Normies.art vs GhostAgent */}
            {normie && (
              <div className="space-y-3">
                <h3 className="text-[10px] font-semibold tracking-widest text-[var(--muted)] uppercase">Normie #{normie.tokenId} Identity</h3>

                {/* Track A: Normies.art Awakening (Base) */}
                <div className={`rounded-xl border px-4 py-3.5 space-y-1.5 ${
                  normie.isAgent === null ? 'border-[rgba(176,128,92,0.25)] bg-black/20'
                  : normie.isAgent ? 'border-fuchsia-500/40 bg-fuchsia-500/[0.06]'
                  : 'border-[rgba(176,128,92,0.2)] bg-black/20'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold tracking-wider text-[var(--muted)] uppercase">A · Normies.art Awakening</span>
                    <span className="text-[9px] font-mono text-[var(--muted)]">Base · proprietary</span>
                  </div>
                  {normie.isAgent === null ? (
                    <p className="text-xs text-[var(--muted)]">Checking Normies.art canvas…</p>
                  ) : normie.isAgent ? (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-fuchsia-300">🔥 Awakened — agent binding active on Base</p>
                      {normie.agentDelegate && (
                        <p className="text-[10px] font-mono text-[var(--muted)] break-all">Agent wallet: {normie.agentDelegate.slice(0, 10)}…{normie.agentDelegate.slice(-8)}</p>
                      )}
                      <p className="text-[10px] text-[var(--muted)]">
                        Binding contract: <a href={`https://basescan.org/address/${NORMIES_BINDING_BASE}`} target="_blank" rel="noreferrer" className="text-fuchsia-400 hover:underline font-mono">{NORMIES_BINDING_BASE.slice(0, 10)}…↗</a>
                      </p>
                      <p className="text-[10px] text-[var(--muted)] mt-0.5">Closed ecosystem — interoperability limited to Normies.art platform.</p>
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--muted)]">Not awakened — no binding registered on Normies.art yet.</p>
                  )}
                </div>

                {/* Track B: GhostAgent ERC-8004 (Gnosis, open standard) */}
                <div className={`rounded-xl border px-4 py-3.5 space-y-1.5 ${
                  agentStatus === 'registered' ? 'border-emerald-500/40 bg-emerald-500/[0.06]'
                  : agentStatus === 'checking' ? 'border-[rgba(176,128,92,0.25)] bg-black/20'
                  : 'border-amber-500/30 bg-amber-500/[0.04]'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold tracking-wider text-[var(--muted)] uppercase">B · GhostAgent ERC-8004</span>
                    <span className="text-[9px] font-mono text-[var(--muted)]">Gnosis · open standard</span>
                  </div>
                  {agentStatus === 'checking' && (
                    <p className="text-xs text-[var(--muted)]">Checking ERC-8004 registry…</p>
                  )}
                  {agentStatus === 'registered' && registeredTarget && (
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs font-semibold text-emerald-300">✓ Registered — <span className="font-mono">{registeredTarget.label}</span> · ERC-8004 #{registeredTarget.agentId}</p>
                        <p className="text-[10px] text-[var(--muted)] mt-0.5">Beacon NFT: <span className="font-mono">{registeredTarget.label.replace(/\./g, '-')}.agent.gno</span> · verifiable on any ERC-8004 oracle.</p>
                      </div>
                      <NormieTrustBadge target={registeredTarget} />
                    </div>
                  )}
                  {agentStatus === 'unregistered' && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-amber-300">Not registered in ERC-8004 registry</p>
                      <p className="text-[11px] text-[var(--muted)]">
                        {normie.isAgent
                          ? `This Normie is awakened on Normies.art (Track A) but hasn't been registered in the open ERC-8004 registry. ${owned ? 'Register it as a GhostAgent to make it cross-platform verifiable.' : 'The owner can register it as a GhostAgent.'}`
                          : `Normie ${normie.tokenId} has no GhostAgent identity yet. ${owned ? 'Activate it to register on Gnosis.' : 'The owner can activate it as a GhostAgent.'}`}
                      </p>
                      {owned && (
                        <a href={`/pair-nft?nft=normie&tokenId=${normie.tokenId}`} className="inline-block mt-1 rounded-lg bg-fuchsia-600/70 px-4 py-1.5 text-xs font-bold text-white hover:bg-fuchsia-600 transition">
                          Register as GhostAgent →
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Trust verification — live notapaperclip.red oracle */}
            <div>
              <h3 className="text-[10px] font-semibold tracking-widest text-[var(--muted)] uppercase mb-1">Reference Agents</h3>
              <p className="text-xs text-[var(--muted)] mb-3">
                The notapaperclip.red oracle resolves an agent&apos;s ERC-8004 identity on-chain. The agents below are live,
                registered GhostAgents, so they verify green. A free FakeNormie is an off-chain demo identity until you
                upgrade it — that registers an on-chain ERC-8004 agent you can then verify right here.
              </p>
              <div className="flex flex-wrap gap-2 mb-4">
                {VERIFIED_AGENTS.map((a) => (
                  <button
                    key={a.agentId}
                    onClick={() => setTrustAgent(a)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${trustAgent.agentId === a.agentId ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' : 'border-[rgba(176,128,92,0.25)] bg-black/30 text-[var(--muted)] hover:text-white'}`}
                  >
                    {a.label} · #{a.agentId}
                  </button>
                ))}
              </div>
              <NormieTrustBadge target={trustAgent} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
