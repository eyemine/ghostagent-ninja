"use client";

import { useState } from 'react';
import { ConnectButton } from './components/ConnectButton';
import { MintButton } from './components/MintButton';
import { NamespaceSelect } from './components/NamespaceSelect';
import type { Namespace } from './components/NamespaceSelect';
import { usePrivy } from '@privy-io/react-auth';
import { LinkButton } from './components/LinkButton';
import Link from 'next/link';

export default function Home() {
  const { authenticated } = usePrivy();
  const [namespace, setNamespace] = useState<Namespace>('agent');
  const [agentName, setAgentName] = useState('');

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.16),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.14),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center gap-8 px-4 py-6 md:px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="text-xs font-semibold tracking-[0.18em] text-[rgb(160,220,255)]">
            GHOSTAGENT.NINJA
          </div>
          <h1 className="text-4xl font-bold tracking-tight">
            Non-custodial agent identity
          </h1>
          <p className="max-w-md text-sm text-[var(--muted)]">
            Mint your agent NFT to create a persistent identity vault on Gnosis Chain.
            Your NFT is the key — transfer it to transfer control.
          </p>
        </div>

        <div className="flex w-full max-w-2xl flex-col gap-6">
          <ConnectButton />
          {authenticated && (
            <>
              {/* Agent Name Input */}
              <div className="rounded-2xl border border-[var(--border)] bg-black/20 p-5">
                <label className="text-xs font-semibold tracking-[0.18em] text-[var(--muted)]">
                  AGENT NAME
                </label>
                <div className="mt-3 flex items-center gap-3">
                  <input
                    type="text"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder="e.g. postmaster"
                    className="flex-1 rounded-lg border border-[var(--border)] bg-black/40 px-4 py-2.5 text-sm text-white placeholder-[var(--muted)] outline-none focus:border-[rgba(0,163,255,0.5)]"
                  />
                  <span className="shrink-0 text-sm text-[var(--muted)]">
                    .{namespace}.gno
                  </span>
                </div>
                {agentName && (
                  <p className="mt-2 text-xs text-[rgb(160,220,255)]">
                    {namespace === 'nftmail'
                      ? `${agentName}.${agentName}.nftmail.gno → ${agentName}.${agentName}@nftmail.box`
                      : `${agentName}.${namespace}.gno → ${agentName}.creation.ip → ${agentName}_@nftmail.box`}
                  </p>
                )}
              </div>

              <NamespaceSelect namespace={namespace} onSelect={setNamespace} />
              <MintButton namespace={namespace} agentName={agentName} />
              <div className="flex items-center justify-center gap-3 pt-2">
                <LinkButton />
                <Link
                  href="/nftmail"
                  className="group inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-5 py-3 text-sm font-semibold text-emerald-300 transition-all hover:bg-emerald-500/15 hover:shadow-[0_0_24px_rgba(16,185,129,0.12)]"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="6" width="20" height="12" rx="2" />
                    <path d="M22 8l-10 5L2 8" />
                  </svg>
                  NFTMail.box
                  <svg className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </>
          )}

          {/* NFTMail.box entry — always visible */}
          {!authenticated && (
            <div className="flex flex-col items-center gap-3 pt-4">
              <span className="text-[10px] tracking-wider text-[var(--muted)]">OR START WITH EMAIL</span>
              <Link
                href="/nftmail"
                className="group inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-6 py-3 text-sm font-semibold text-emerald-300 transition-all hover:bg-emerald-500/15 hover:shadow-[0_0_24px_rgba(16,185,129,0.12)]"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="6" width="20" height="12" rx="2" />
                  <path d="M22 8l-10 5L2 8" />
                </svg>
                Get a free NFTMail.box address
                <svg className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </Link>
              <p className="text-[10px] text-[var(--muted)]">
                Mint → Upgrade → Molt to Agent — same TBA, zero migration
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
