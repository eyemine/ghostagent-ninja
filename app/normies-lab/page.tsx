'use client';

import Link from 'next/link';
import { FakeNormieLab } from '../components/FakeNormieLab';
import { WitnessChamber } from '../components/WitnessChamber';
import { MANDATE_OPTIONS } from '../services/erc8048-publisher';

export default function NormiesLabPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">

      {/* ── Hero ── */}
      <div className="border-b border-slate-800 bg-gradient-to-b from-violet-950/30 to-slate-950 px-6 py-14 text-center lg:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1.5 font-mono text-xs text-violet-300">
            Normies Hackathon 2026 · Live Demo
          </div>
          <h1 className="mt-4 text-4xl font-black tracking-tight lg:text-5xl">
            FakeNormie Lab
          </h1>
          <p className="mt-4 text-lg text-slate-400 leading-relaxed">
            Watch a 40×40 pixel avatar become an{' '}
            <span className="text-violet-300 font-semibold">economic entity</span> with verifiable on-chain spending limits.
          </p>

          {/* Architecture strip */}
          <div className="mt-8 flex items-center justify-center gap-2 flex-wrap font-mono text-xs">
            {[
              { label: 'ERC-8004', sub: 'Identity', color: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300' },
              { label: '+', sub: '', color: 'text-slate-600' },
              { label: 'ERC-8048', sub: 'Sidecar Metadata', color: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300' },
              { label: '+', sub: '', color: 'text-slate-600' },
              { label: 'ERC-8312', sub: 'Spend Cursor', color: 'border-violet-500/30 bg-violet-500/10 text-violet-300' },
            ].map((item, i) =>
              item.sub === '' ? (
                <span key={i} className={`text-lg font-bold ${item.color}`}>→</span>
              ) : (
                <div key={i} className={`rounded-lg border px-3 py-2 text-center ${item.color}`}>
                  <div className="font-bold">{item.label}</div>
                  <div className="mt-0.5 opacity-70 text-[10px]">{item.sub}</div>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-12 px-6 py-12 lg:px-8">

        {/* ── Step 1: Witness Chamber ── */}
        <section>
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-700 font-mono text-xs font-bold">1</span>
            <div>
              <h2 className="text-lg font-bold">The Witness Chamber</h2>
              <p className="text-sm text-slate-400">Live cursor state — no wallet required</p>
            </div>
          </div>
          <WitnessChamber />
          <p className="mt-3 text-xs text-slate-600 leading-relaxed">
            FakeNormie #1 has an ERC-8048 sidecar declaring its spending mandate. The ERC-8312 cursor on Chiado
            enforces that ceiling immutably. Every draw is recorded on-chain and reflected here in real time.
          </p>
        </section>

        {/* ── Step 2: Policy Factory ── */}
        <section>
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pink-700 font-mono text-xs font-bold">2</span>
            <div>
              <h2 className="text-lg font-bold">The Policy Factory</h2>
              <p className="text-sm text-slate-400">Claim your sandbox agent — gas sponsored by ghostagent.ninja</p>
            </div>
          </div>
          <FakeNormieLab />
        </section>

        {/* ── Step 3: Enforcement Lock ── */}
        <section>
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-700 font-mono text-xs font-bold">3</span>
            <div>
              <h2 className="text-lg font-bold">The Enforcement Lock</h2>
              <p className="text-sm text-slate-400">Declare your mandate · Register the immutable ceiling</p>
            </div>
          </div>
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {MANDATE_OPTIONS.map(m => (
                <div key={m.value} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 font-mono text-xs">
                  <div className="mb-2 text-base font-bold">{m.label}</div>
                  <div className="mb-3 text-slate-400">{m.subCapLabel}</div>
                  <div className="text-slate-600 leading-relaxed">
                    {m.value === 'restricted' && 'Sandbox default. Enough headroom for email pings and lightweight API calls.'}
                    {m.value === 'worker'     && 'Authorized for background workflows — micro-swaps, licensing, routine transactions.'}
                    {m.value === 'executive'  && 'High-frequency execution mode. Owner has explicitly signed off on elevated capital authority.'}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-xl border border-slate-800 bg-slate-900/50 p-4 font-mono text-xs text-slate-400 leading-relaxed">
              <span className="text-emerald-400 font-bold">How it works:</span>{' '}
              Once you have a FakeNormie, go to its ERC-8048 sidecar dashboard. Commit{' '}
              <span className="text-slate-300">cursor[mandate]</span> to the on-chain registry, then click{' '}
              <span className="text-slate-300">Apply Ceiling</span> — your wallet switches to Chiado testnet and calls{' '}
              <span className="text-slate-300">register(scopeId, capRoot)</span>. The spending ceiling is now enforced
              immutably without any trusted intermediary.
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/normies"
                className="rounded-lg bg-pink-700 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-pink-600"
              >
                Claim FakeNormie →
              </Link>
              <Link
                href="/dashboard/erc8048?collection=fakenormie"
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-5 py-2.5 text-sm font-bold text-emerald-300 transition hover:bg-emerald-500/20"
              >
                Open Mandate Dashboard →
              </Link>
            </div>
          </div>
        </section>

        {/* ── Architecture context ── */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 font-mono text-xs text-slate-400">
          <div className="mb-4 text-sm font-bold text-slate-200">Two-Tier Architecture</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4">
              <div className="mb-2 font-bold text-cyan-300">Native Sovereign Agents</div>
              <div className="mb-2 text-slate-500">ghostagent · victor · eyemine</div>
              <div className="space-y-1">
                <div className="text-slate-400">GNS-backed identity + Gnosis Safe</div>
                <div className="text-slate-400">DailyBudgetModule — institutional caps</div>
                <div className="text-slate-400">HumanInTheLoopModule — tx approval gates</div>
              </div>
            </div>
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-4">
              <div className="mb-2 font-bold text-violet-300">Paired Legacy NFTs</div>
              <div className="mb-2 text-slate-500">Normies · Chonks · FakeNormies</div>
              <div className="space-y-1">
                <div className="text-slate-400">ERC-8048 sidecar — live metadata layer</div>
                <div className="text-slate-400">ERC-8312 cursor — session spend ceiling</div>
                <div className="text-slate-400">No contract migration required</div>
              </div>
            </div>
          </div>
          <div className="mt-4 text-slate-600">
            Both layers compose: when you sell a FakeNormie on OpenSea, its cursor mandate and sidecar metadata move with it automatically.
          </div>
        </section>

      </div>
    </div>
  );
}
