'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { MoltStep1, type SourceAgent } from '../components/MoltStep1';
import { MoltStep2, type TargetIdentity } from '../components/MoltStep2';
import { MoltStep3, type MoltFinalResult } from '../components/MoltStep3';

type PageStep = 1 | 2 | 3 | 4;

const STEPS = [
  { n: 1, label: 'Select Agent' },
  { n: 2, label: 'Target Identity' },
  { n: 3, label: 'Preview & Execute' },
];

export default function MoltPage() {
  const searchParams = useSearchParams();
  const preselectedBody = searchParams.get('body') || searchParams.get('agent') || '';
  
  const [step, setStep] = useState<PageStep>(1);
  const [source, setSource] = useState<SourceAgent | null>(null);
  const [target, setTarget] = useState<TargetIdentity | null>(null);
  const [result, setResult] = useState<MoltFinalResult | null>(null);
  const [autoLookupDone, setAutoLookupDone] = useState(false);

  // Auto-lookup agent when body/agent is passed via query params
  useEffect(() => {
    if (preselectedBody && !autoLookupDone && step === 1) {
      // Trigger lookup via custom event that MoltStep1 will listen for
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('molt:autoLookup', { detail: { agentName: preselectedBody } }));
      }, 100);
      setAutoLookupDone(true);
    }
  }, [preselectedBody, autoLookupDone, step]);

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(176,128,92,0.12),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.1),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-10 md:px-6">

        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/collection-icons/lite.png" alt="Molt" className="h-8 w-8 rounded object-contain" />
            <div className="text-xs font-semibold tracking-[0.18em] text-amber-300">MOLT</div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/byo-molt"
              className="rounded-full border border-[var(--border)] bg-black/20 px-3 py-1.5 text-[11px] text-[var(--muted)] transition hover:text-white"
            >
              BYO NFT Molt
            </Link>
            <Link
              href="/dashboard"
              className="rounded-full border border-[var(--border)] bg-black/20 px-3 py-1.5 text-[11px] text-[var(--muted)] transition hover:text-white"
            >
              Dashboard
            </Link>
          </div>
        </header>

        {/* Hero */}
        <section className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-white">Identity Molt</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
            Change your agent's display identity while keeping your email, Safe, TBA, and history intact.
            Costs 14 xDAI — funds your surge reputation score.
          </p>
        </section>

        {/* Step indicator */}
        {step < 4 && (
          <div className="flex items-center justify-center gap-2">
            {STEPS.map((s, i) => {
              const isDone = step > s.n;
              const isCurrent = step === s.n;
              return (
                <div key={s.n} className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold transition-all ${
                      isDone
                        ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30'
                        : isCurrent
                        ? 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40 animate-pulse'
                        : 'bg-white/5 text-[var(--muted)] ring-1 ring-[var(--border)]'
                    }`}>
                      {isDone ? '✓' : s.n}
                    </div>
                    <span className={`text-xs font-medium ${
                      isDone ? 'text-amber-400' : isCurrent ? 'text-amber-300' : 'text-[var(--muted)]'
                    }`}>
                      {s.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`h-px w-6 ${isDone ? 'bg-amber-500/40' : 'bg-[var(--border)]'}`} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* FakeNormie upgrade nudge — shown when source is basic tier */}
        {source && (source.tier === 'basic' || !source.tier) && source.name && /\.(agent|fakenormie)/.test(source.name) && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-4 flex items-start gap-4">
            <span className="text-2xl shrink-0">⬆</span>
            <div className="flex-1">
              <div className="text-sm font-bold text-emerald-300 mb-1">Upgrade your tier before molting</div>
              <p className="text-xs text-[var(--muted)]">
                <span className="font-mono text-white">{source.name}_</span> is on the <strong className="text-white">Basic</strong> tier.
                Molt changes your identity, but <strong className="text-white">PRO</strong> gives you a Gnosis Safe + ERC-8004 on-chain identity and
                <strong className="text-white"> PREMIUM</strong> adds auto-forwarding and persistent history.
                Upgrade first, then molt for maximum impact.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <a
                  href={`/normies-lab#upgrade`}
                  className="rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-4 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30 transition"
                >
                  Upgrade tier → PRO / PREMIUM
                </a>
                <span className="text-[10px] text-[var(--muted)]">or continue with identity-only molt below</span>
              </div>
            </div>
          </div>
        )}

        {/* Step panels */}
        <div className="rounded-2xl border border-[rgba(176,128,92,0.2)] bg-[var(--card)] p-6">

          {/* Step 1: Select source agent */}
          {step === 1 && (
            <>
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-bold text-amber-300">1</div>
                  <h2 className="text-base font-semibold text-white">Select Your Agent</h2>
                </div>
                <p className="ml-8 text-xs text-[var(--muted)]">Look up the agent you want to molt. Must be connected with the owner wallet.</p>
              </div>
              <MoltStep1
                onSelect={(agent) => {
                  setSource(agent);
                  setStep(2);
                }}
              />
            </>
          )}

          {/* Step 2: Select target identity */}
          {step === 2 && source && (
            <>
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-bold text-amber-300">2</div>
                  <h2 className="text-base font-semibold text-white">Choose Target Identity</h2>
                </div>
                <p className="ml-8 text-xs text-[var(--muted)]">Select or search the identity <span className="text-white">{source.name}_</span> will molt into.</p>
              </div>
              <MoltStep2
                sourceAgentName={source.name}
                onSelect={(identity) => {
                  setTarget(identity);
                  setStep(3);
                }}
                onBack={() => setStep(1)}
              />
            </>
          )}

          {/* Step 3: Preview & execute */}
          {step === 3 && source && target && (
            <>
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-bold text-amber-300">3</div>
                  <h2 className="text-base font-semibold text-white">Preview & Execute</h2>
                </div>
                <p className="ml-8 text-xs text-[var(--muted)]">Review what changes, what stays the same, then pay 14 xDAI to execute.</p>
              </div>
              <MoltStep3
                source={source}
                target={target}
                onBack={() => setStep(2)}
                onSuccess={(r) => {
                  setResult(r);
                  setStep(4);
                }}
              />
              
              {/* Ghost tier molt option (Premium-only) */}
              {source.tier === 'premium' && (
                <div className="mt-6 rounded-xl border border-zinc-500/30 bg-zinc-900/40 p-5">
                  <div className="flex items-start gap-4">
                    <img 
                      src="/collection-icons/ghost.png" 
                      alt="Ghost" 
                      className="h-12 w-12 rounded-lg object-cover"
                    />
                    <div className="flex-1">
                      <h3 className="text-sm font-bold text-white">Molt to Ghost Tier</h3>
                      <p className="mt-1 text-xs text-zinc-400">
                        Final evolution — full autonomy, privacy-preserving, optional local execution. Brain preserved.
                      </p>
                      <div className="mt-3 flex items-center gap-3">
                        <Link
                          href={`/dashboard/settings/ghost?agent=${source.name}`}
                          className="rounded-lg border border-zinc-400/30 bg-zinc-800/60 px-4 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-700/60"
                        >
                          Molt to Ghost (50 xDAI)
                        </Link>
                        <span className="text-[10px] text-zinc-500">Premium tier required</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {source.tier !== 'premium' && (
                <div className="mt-6 rounded-xl border border-zinc-500/20 bg-zinc-900/20 p-5 opacity-50">
                  <div className="flex items-start gap-4">
                    <img 
                      src="/collection-icons/ghost.png" 
                      alt="Ghost" 
                      className="h-12 w-12 rounded-lg object-cover grayscale"
                    />
                    <div className="flex-1">
                      <h3 className="text-sm font-bold text-zinc-500">Molt to Ghost Tier</h3>
                      <p className="mt-1 text-xs text-zinc-600">
                        Only Premium tier agents can molt to Ghost. Molt to Premium first.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Step 4: Done */}
          {step === 4 && result && (
            <div className="space-y-6 text-center">
              <div className="flex flex-col items-center gap-3">
                <span className="text-5xl">🦋</span>
                <h2 className="text-xl font-bold text-white">Molt Complete</h2>
                <p className="text-sm text-[var(--muted)]">
                  <span className="font-mono text-white">{result.agentName}_</span> has shed its identity and emerged as{' '}
                  <span className="font-mono text-amber-300">{result.targetIdentity}</span>
                </p>
              </div>

              <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/30 p-4 text-left space-y-2">
                <div className="text-[9px] font-semibold tracking-[0.15em] text-[var(--muted)]">MOLT SUMMARY</div>
                {[
                  { label: 'Agent', value: `${result.agentName}_@nftmail.box` },
                  { label: 'New identity', value: result.targetIdentity },
                  { label: 'Total xDAI burned', value: `${result.totalXdaiBurned.toFixed(1)} xDAI` },
                  { label: 'Surge reputation', value: `${result.surgeReputationScore} pts` },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span className="text-[var(--muted)]">{label}</span>
                    <span className="font-mono text-white">{value}</span>
                  </div>
                ))}
                {result.newBeaconCid && (
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--muted)]">Beacon CID</span>
                    <a
                      href={`https://gateway.lighthouse.storage/ipfs/${result.newBeaconCid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-sky-400 hover:underline"
                    >
                      {result.newBeaconCid.slice(0, 16)}…
                    </a>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => { setStep(1); setSource(null); setTarget(null); setResult(null); }}
                  className="flex-1 rounded-xl border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-[var(--muted)] transition hover:text-white"
                >
                  Molt another agent
                </button>
                <Link
                  href="/dashboard"
                  className="flex-1 rounded-xl bg-amber-500/15 px-4 py-3 text-center text-sm font-semibold text-amber-200 transition hover:bg-amber-500/25"
                >
                  Go to Dashboard →
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Info footer */}
        {step < 4 && (
          <div className="rounded-xl border border-[var(--border)] bg-black/20 px-5 py-3">
            <div className="flex items-center justify-center gap-6 text-[10px] text-[var(--muted)]">
              <span>✓ Email unchanged</span>
              <span>✓ Safe preserved</span>
              <span>✓ TBA unchanged</span>
              <span>✓ vault.gno blocked</span>
            </div>
          </div>
        )}

        <footer className="text-center text-[10px] text-[var(--muted)]">
          Identity molts are permanent · primary email never changes · 2 xDAI fee non-refundable
        </footer>
      </div>
    </div>
  );
}
