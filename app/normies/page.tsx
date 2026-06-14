'use client';

import { useState, useEffect } from 'react';
import { useWallets } from '@privy-io/react-auth';
import Link from 'next/link';
import { NormieTrustBadge, type TrustTarget } from '../components/NormieTrustBadge';

interface NormieAttribute { trait_type: string; value: string; }
interface NormieMeta { tokenId: number; name: string; image: string; attributes: NormieAttribute[]; owner?: string; }

const TRAIT_MAP: Record<number, [string, string]> = {
  0: ['Super', 'Normie'], 1: ['Mad', 'Normie'], 2: ['Iron', 'Agent'], 3: ['Sir', 'Alien'],
  4: ['Rotten', 'Agent'], 5: ['Hot', 'Normie'], 6: ['Deaf', 'Agent'], 7: ['Rare', 'Normie'],
  8: ['Young', 'Cat'], 9: ['Faux', 'Agent'], 10: ['Lost', 'Agent'], 11: ['Damn', 'Human'],
  12: ['Broke', 'Alien'], 13: ['Sad', 'Normie'], 14: ['Crack', 'Agent'], 15: ['Old', 'Normie'],
  16: ['Wicked', 'Alien'], 17: ['Slow', 'Human'], 18: ['Bald', 'Cat'], 19: ['Drunk', 'Normie'],
  20: ['Wrong', 'Human'], 21: ['Punk', 'Alien'], 22: ['Dumb', 'Agent'], 23: ['Free', 'Agent'],
  24: ['Dead', 'Alien'], 25: ['Pretty', 'Alien'], 26: ['Only', 'Normie'], 27: ['Sexy', 'Human'],
  28: ['Legal', 'Alien'], 29: ['Poor', 'Normie'], 30: ['Fat', 'Cat'], 31: ['Old', 'Human'],
  32: ['Black', 'Cat'], 33: ['Based', 'Agent'], 34: ['Free', 'Alien'], 35: ['Secret', 'Agent'],
  36: ['Evil', 'Human'], 37: ['Baby', 'Alien'], 38: ['Copy', 'Normie'], 39: ['King', 'Cat'],
  40: ['Rotten', 'Normie'], 41: ['Loud', 'Normie'], 42: ['Ugly', 'Agent'], 43: ['Raw', 'Human'],
  44: ['Mad', 'Cat'], 45: ['Dead', 'Normie'], 46: ['Sick', 'Human'], 47: ['Found', 'Normie'],
  48: ['Nasty', 'Cat'], 49: ['Bored', 'Normie'], 50: ['Super', 'Human'], 51: ['Bored', 'Alien'],
  52: ['Hot', 'Alien'], 53: ['Mean', 'Cat'], 54: ['Lone', 'Human'], 55: ['Mid', 'Normie'],
  56: ['Raw', 'Normie'], 57: ['Woke', 'Normie'], 58: ['Drunk', 'Agent'], 59: ['Copy', 'Cat'],
  60: ['Broke', 'Human'], 61: ['Sore', 'Agent'], 62: ['House', 'Alien'], 63: ['Sober', 'Agent'],
  64: ['Saved', 'Normie'], 65: ['Pink', 'Agent'], 66: ['Dank', 'Normie'], 67: ['Lazy', 'Cat'],
  68: ['Lazy', 'Normie'], 69: ['Happy', 'Normie'], 70: ['Hairy', 'Normie'], 71: ['Wet', 'Alien'],
  72: ['Ugly', 'Normie'], 73: ['Limp', 'Alien'], 74: ['Bald', 'Normie'], 75: ['Epic', 'Human'],
  76: ['Big', 'Alien'], 77: ['Rebel', 'Normie'], 78: ['Floor', 'Agent'], 79: ['Lucky', 'Human'],
  80: ['Only', 'Agent'], 81: ['Thick', 'Alien'], 82: ['Known', 'Normie'], 83: ['Epic', 'Agent'],
  84: ['Big', 'Human'], 85: ['Step', 'Alien'], 86: ['Soft', 'Agent'], 87: ['Daft', 'Alien'],
  88: ['Last', 'Normie'], 89: ['Music', 'Agent'], 90: ['Kind', 'Human'], 91: ['Glitch', 'Cat'],
  92: ['Lazy', 'Normie'], 93: ['Good', 'Alien'], 94: ['Cheap', 'Normie'], 95: ['Super', 'Agent'],
  96: ['Broke', 'Normie'], 97: ['Copy', 'Agent'], 98: ['Safu', 'Agent'], 99: ['Lucky', 'Normie'],
};

const COLORS: Record<string, { text: string; bg: string; border: string }> = {
  Alien: { text: 'text-violet-300', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  Cat: { text: 'text-orange-300', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  Human: { text: 'text-blue-300', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  Normie: { text: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  Agent: { text: 'text-pink-300', bg: 'bg-pink-500/10', border: 'border-pink-500/20' },
};

const ARCHETYPE: Record<string, string> = {
  Alien: 'Unconventional thinker. Challenges assumptions.',
  Cat: 'Independent operator. Self-directed and agile.',
  Human: 'Pragmatic and relatable. Execution-focused.',
  Normie: 'Balanced and versatile. Community-aligned.',
  Agent: 'Protocol-native. Action-oriented, on-chain first.',
};

const FALLBACK_COLOR = { text: 'text-zinc-300', bg: 'bg-zinc-500/10', border: 'border-zinc-500/20' };

// Existing deployed GhostAgents available for live trust verification.
// agentId resolves on-chain individually; webUrl hosts the platform A2A card.
const VERIFIED_AGENTS: Array<TrustTarget & { label: string }> = [
  { label: 'ghostagent.molt.gno', agentName: 'ghostagent', agentId: 3199, chain: 'gnosis', webUrl: 'https://ghostagent.ninja' },
  { label: 'eyemine.nftmail.gno', agentName: 'eyemine', agentId: 3205, chain: 'gnosis', webUrl: 'https://ghostagent.ninja' },
  { label: 'victor.openclaw.gno', agentName: 'victor', agentId: 3206, chain: 'gnosis', webUrl: 'https://ghostagent.ninja' },
];

export default function NormiesPage() {
  const { wallets } = useWallets();
  const wallet = wallets[0]?.address ?? null;
  const [id, setId] = useState('');
  const [normie, setNormie] = useState<NormieMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [holders, setHolders] = useState<NormieMeta[]>([]);

  const previewFake = (tokenId: number) => {
    const traits = TRAIT_MAP[tokenId];
    if (!traits) return;
    const [adj, species] = traits;
    setNormie({
      tokenId,
      name: `${adj} ${species} #${tokenId}`,
      image: `/FakeNormies/SVGS/${tokenId.toString().padStart(2, '0')}.svg`,
      attributes: [
        { trait_type: 'Adjective', value: adj },
        { trait_type: 'Species', value: species },
      ],
    });
    setError(null);
  };

  const fetchNormie = async () => {
    const tid = parseInt(id, 10);
    if (Number.isNaN(tid)) { setError('Enter a valid ID'); return; }
    if (tid >= 0 && tid <= 99) { previewFake(tid); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/normies/normie/${tid}`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = (await res.json()) as { name?: string; image: string; attributes?: NormieAttribute[] };
      setNormie({ tokenId: tid, name: data.name ?? `Normie #${tid}`, image: data.image, attributes: data.attributes ?? [] });
    } catch {
      setError('Normie not found or API error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!wallet) { setHolders([]); return; }
    setHolders([0, 1, 2].map((i) => {
      const [adj, species] = TRAIT_MAP[i];
      return {
        tokenId: i,
        name: `${adj} ${species}`,
        image: `/FakeNormies/SVGS/0${i}.svg`,
        attributes: [
          { trait_type: 'Adjective', value: adj },
          { trait_type: 'Species', value: species },
        ],
      };
    }));
  }, [wallet]);

  const [trustAgent, setTrustAgent] = useState<(TrustTarget & { label: string })>(VERIFIED_AGENTS[0]);

  const adj = normie?.attributes.find((a) => a.trait_type === 'Adjective')?.value;
  const species = normie?.attributes.find((a) => a.trait_type === 'Species')?.value;
  const c = species ? COLORS[species] ?? FALLBACK_COLOR : FALLBACK_COLOR;
  const isFake = normie ? normie.tokenId >= 0 && normie.tokenId <= 99 : false;

  return (
    <div className="min-h-screen px-4 py-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Normie Preview Lab</h1>
      <p className="text-sm text-zinc-400 mb-6">
        Preview any Normie by ID. Traits derive agent personality. Connect wallet to see your collection.
      </p>

      <div className="flex gap-3 mb-8">
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') fetchNormie(); }}
          placeholder="Enter Normie ID (0-9999)"
          className="flex-1 rounded-lg border border-zinc-700 bg-black/50 px-4 py-2 text-sm outline-none focus:border-fuchsia-500/50"
        />
        <button
          onClick={fetchNormie}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-fuchsia-600 text-white text-sm font-semibold hover:bg-fuchsia-500 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Preview'}
        </button>
      </div>
      {error && <div className="mb-6 text-sm text-red-400">{error}</div>}

      {normie && (
        <div className={`mb-10 rounded-xl border ${c.border} ${c.bg} p-6`}>
          <div className="flex flex-col md:flex-row gap-6">
            <div className="w-48 h-48 shrink-0 rounded-lg bg-black/30 flex items-center justify-center overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={normie.image} alt={normie.name} className="w-full h-full object-contain" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-3">
                <h2 className={`text-xl font-bold ${c.text}`}>{normie.name}</h2>
                {isFake ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-amber-500/30 bg-amber-500/10 text-amber-300">Demo · Unverified</span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">Real Normie</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2 mb-4">
                {adj && <span className="px-2 py-1 rounded text-xs bg-black/40 border border-zinc-700">{adj}</span>}
                {species && (
                  <span className={`px-2 py-1 rounded text-xs font-semibold border ${c.border} ${c.text}`}>{species}</span>
                )}
              </div>
              {species && ARCHETYPE[species] && (
                <p className="text-sm text-zinc-300 mb-4">{ARCHETYPE[species]}</p>
              )}
              <div className="flex gap-3">
                <Link
                  href={`/pair-nft?normie=${normie.tokenId}`}
                  className="px-4 py-2 rounded-lg bg-fuchsia-600 text-white text-sm font-semibold hover:bg-fuchsia-500"
                >
                  Activate as Agent
                </Link>
                <button
                  onClick={() => { setId(''); setNormie(null); }}
                  className="px-4 py-2 rounded-lg border border-zinc-700 text-sm text-zinc-400 hover:text-white"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {wallet && holders.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold tracking-wider text-zinc-400 uppercase mb-4">Your Collection</h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {holders.map((h) => {
              const s = h.attributes.find((a) => a.trait_type === 'Species')?.value ?? 'Normie';
              const sc = COLORS[s] ?? FALLBACK_COLOR;
              return (
                <button
                  key={h.tokenId}
                  onClick={() => previewFake(h.tokenId)}
                  className={`rounded-lg border ${sc.border} bg-black/30 p-3 hover:bg-black/50 transition`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={h.image} alt={h.name} className="w-full aspect-square object-contain mb-2" />
                  <p className="text-xs text-zinc-300 truncate">{h.name}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Trust oracle — live verification of deployed GhostAgents */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold tracking-wider text-zinc-400 uppercase mb-1">Trust Verification</h3>
        <p className="text-xs text-zinc-500 mb-4">
          Real Normie agents are verified by an independent oracle. FakeNormies stay in the unverified demo tier.
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          {VERIFIED_AGENTS.map((a) => (
            <button
              key={a.agentId}
              onClick={() => setTrustAgent(a)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                trustAgent.agentId === a.agentId
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                  : 'border-zinc-700 bg-black/30 text-zinc-400 hover:text-white'
              }`}
            >
              {a.label} · #{a.agentId}
            </button>
          ))}
        </div>
        <NormieTrustBadge target={trustAgent} />
      </div>

      <div className="rounded-lg border border-zinc-800 bg-black/20 p-4">
        <p className="text-xs text-zinc-500">
          <strong>Demo Mode:</strong> IDs 0-99 show FakeNormies (on-chain Gnosis Chain). IDs 100+ call
          api.normies.art for real Normies data.
          <Link href="/fakenormies" className="text-fuchsia-400 hover:underline ml-1">Get a FakeNormie &rarr;</Link>
        </p>
      </div>
    </div>
  );
}
