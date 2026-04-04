'use client';

// SDK Documentation page - https://nftmail.box/sdk
// Last updated: 2026-04-04 - Force rebuild
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

const codeBlocks = {
  install: `npm install @ghostagent/nftmail`,
  setup: `npx nftmail-setup`,
  basic: `import NFTMail from '@ghostagent/nftmail';

const nftmail = new NFTMail();

// Create freemium agent
const agent = await nftmail.createAgent('my-agent', 'freemium');

// Send email with optional payment
await nftmail.sendEmail(
  'my-agent@nftmail.box',
  'recipient@example.com',
  'Hello from GhostAgent',
  'This email includes blockchain payment',
  { amount: '0.1', recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb' }
);`,
  upgrade: `npx nftmail-upgrade --agent my-agent --tier professional`,
  brain: `npx ghostagent-add-brain --agent my-agent --model gpt-4`,
  molt: `npx ghostagent-molt --agent my-agent --tld gno`
};

export default function SDKPage() {
  const [activeTab, setActiveTab] = useState('install');

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.16),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.14),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
        
        {/* Header */}
        <header className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center gap-2">
              <Image src="/nftmail-logo.png" alt="NFTMail" width={48} height={48} className="opacity-95" />
              <span style={{ fontFamily: "'Ayuthaya', serif", color: '#d8d4cf' }} className="text-base tracking-wide">
                nftmail.box
              </span>
            </Link>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-[var(--border)] bg-black/20 px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-black/30"
          >
            ← Back
          </Link>
        </header>

        {/* Hero */}
        <section className="text-center mb-12">
          <h1 style={{ fontFamily: "'Ayuthaya', serif", color: '#d8d4cf' }} className="text-4xl font-bold tracking-tight mb-4">
            NFTMail SDK
          </h1>
          <p className="mx-auto max-w-2xl text-sm text-[var(--muted)] mb-6">
            Blockchain-native email service with x402 payments, sovereign identity, and marketplace integration.
          </p>
          <div className="flex justify-center gap-4">
            <a
              href="https://github.com/eyemine/ghostagent-ninja/tree/main/packages/nftmail"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-[rgba(0,163,255,0.12)] px-6 py-2.5 text-xs font-semibold text-[rgb(160,220,255)] border border-[rgba(0,163,255,0.3)] hover:bg-[rgba(0,163,255,0.2)] transition"
            >
              View on GitHub
            </a>
            <a
              href="https://www.npmjs.com/package/@ghostagent/nftmail"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-[var(--border)] bg-black/20 px-6 py-2.5 text-xs font-semibold text-[var(--foreground)] transition hover:bg-black/30"
            >
              NPM Package
            </a>
          </div>
        </section>

        {/* Key Features */}
        <section className="mb-12">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h2 className="text-lg font-semibold text-white mb-4">🏆 Key Features</h2>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Email Limits:</span>
                  <span className="text-green-400">Unlimited (paid tiers)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Storage:</span>
                  <span className="text-green-400">Up to 365 days</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Blockchain:</span>
                  <span className="text-green-400">Native integration</span>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Payments:</span>
                  <span className="text-green-400">x402 built-in</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Sovereignty:</span>
                  <span className="text-green-400">Complete identity</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Marketplace:</span>
                  <span className="text-green-400">Sellable agents</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Code Examples */}
        <section className="mb-12">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
            <div className="flex gap-2 mb-6 flex-wrap">
              {[
                { id: 'install', label: '📦 Install', icon: '📦' },
                { id: 'setup', label: '⚡ Quick Setup', icon: '⚡' },
                { id: 'basic', label: '💻 Basic Usage', icon: '💻' },
                { id: 'upgrade', label: '💰 Upgrade', icon: '💰' },
                { id: 'brain', label: '🧠 Add Brain', icon: '🧠' },
                { id: 'molt', label: '🔥 Molt', icon: '🔥' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
                    activeTab === tab.id
                      ? 'bg-[rgba(0,163,255,0.2)] border border-[rgba(0,163,255,0.3)] text-[rgb(160,220,255)]'
                      : 'bg-black/20 border border-[var(--border)] text-[var(--foreground)] hover:bg-black/30'
                  }`}
                >
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            <div className="bg-black/40 rounded-lg p-4 overflow-x-auto">
              <pre className="text-xs text-[#d8d4cf] font-mono whitespace-pre-wrap">
                <code>{codeBlocks[activeTab as keyof typeof codeBlocks]}</code>
              </pre>
            </div>

            {activeTab === 'install' && (
              <div className="mt-4 text-xs text-[var(--muted)]">
                <p>📦 Blockchain-native email service with x402 payments and sovereign identity</p>
              </div>
            )}
            {activeTab === 'setup' && (
              <div className="mt-4 text-xs text-[var(--muted)]">
                <p>⚡ Creates freemium agent with 100 emails, 8-day storage</p>
              </div>
            )}
            {activeTab === 'basic' && (
              <div className="mt-4 text-xs text-[var(--muted)]">
                <p>💻 Send emails with optional x402 payments for blockchain transactions</p>
              </div>
            )}
            {activeTab === 'upgrade' && (
              <div className="mt-4 text-xs text-[var(--muted)]">
                <p>💰 Professional: 10 xDAI/month unlimited, Vault: 24 xDAI/year unlimited</p>
              </div>
            )}
            {activeTab === 'brain' && (
              <div className="mt-4 text-xs text-[var(--muted)]">
                <p>🧠 Add AI brain for autonomous decision-making and email processing</p>
              </div>
            )}
            {activeTab === 'molt' && (
              <div className="mt-4 text-xs text-[var(--muted)]">
                <p>🔥 Convert to sellable agent with 3x-14x ROI on marketplace</p>
              </div>
            )}
          </div>
        </section>

        {/* User Journey */}
        <section className="mb-12">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h2 className="text-lg font-semibold text-white mb-4">🚀 User Journey</h2>
            <div className="space-y-4 text-sm">
              <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-[rgba(0,163,255,0.2)] border border-[rgba(0,163,255,0.3)] flex items-center justify-center text-xs font-bold text-[rgb(160,220,255)]">
                  1
                </div>
                <div>
                  <div className="font-semibold text-white">Start with Freemium</div>
                  <div className="text-[var(--muted)] text-xs">npx nftmail-setup → Creates my-agent@nftmail.box</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-[rgba(0,163,255,0.2)] border border-[rgba(0,163,255,0.3)] flex items-center justify-center text-xs font-bold text-[rgb(160,220,255)]">
                  2
                </div>
                <div>
                  <div className="font-semibold text-white">Upgrade for Unlimited</div>
                  <div className="text-[var(--muted)] text-xs">npx nftmail-upgrade --agent my-agent --tier professional</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-[rgba(0,163,255,0.2)] border border-[rgba(0,163,255,0.3)] flex items-center justify-center text-xs font-bold text-[rgb(160,220,255)]">
                  3
                </div>
                <div>
                  <div className="font-semibold text-white">Add Brain for Autonomy</div>
                  <div className="text-[var(--muted)] text-xs">npx ghostagent-add-brain --agent my-agent --model gpt-4</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-[rgba(0,163,255,0.2)] border border-[rgba(0,163,255,0.3)] flex items-center justify-center text-xs font-bold text-[rgb(160,220,255)]">
                  4
                </div>
                <div>
                  <div className="font-semibold text-white">Molt to Sellable</div>
                  <div className="text-[var(--muted)] text-xs">npx ghostagent-molt --agent my-agent --tld gno → Creates my-agent.gno</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h2 className="text-lg font-semibold text-white mb-4">💰 Pricing & Tiers</h2>
            <div className="grid md:grid-cols-3 gap-4 text-sm">
              <div className="border border-[var(--border)] rounded-lg p-4">
                <div className="font-semibold text-white mb-2">🆓 Freemium</div>
                <div className="text-green-400 font-bold mb-2">Free</div>
                <div className="text-[var(--muted)] space-y-1">
                  <div>• 100 emails</div>
                  <div>• 8 days storage</div>
                  <div>• Basic email</div>
                </div>
              </div>
              <div className="border border-[rgba(0,163,255,0.3)] rounded-lg p-4">
                <div className="font-semibold text-white mb-2">💼 Professional</div>
                <div className="text-[rgb(160,220,255)] font-bold mb-2">10 xDAI/month</div>
                <div className="text-[var(--muted)] space-y-1">
                  <div>• Unlimited emails</div>
                  <div>• 30 days storage</div>
                  <div>• Priority support</div>
                </div>
              </div>
              <div className="border border-[rgba(124,77,255,0.3)] rounded-lg p-4">
                <div className="font-semibold text-white mb-2">🏦 Vault</div>
                <div className="text-[rgb(180,160,255)] font-bold mb-2">24 xDAI/year</div>
                <div className="text-[var(--muted)] space-y-1">
                  <div>• Unlimited emails</div>
                  <div>• 365 days storage</div>
                  <div>• Priority support</div>
                </div>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
