'use client';
import { useState } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { createWalletClient, custom } from 'viem';
import { gnosis } from 'viem/chains';
import {
  AUTHORSHIP_EIP712_DOMAIN,
  AUTHORSHIP_EIP712_TYPES,
  buildDeclarationDocument,
  buildEIP712AuthorshipMessage,
  type AuthorshipDeclarationParams,
  type AuthorshipDeclarationRecord,
} from '../services/authorship-declaration';

interface Props {
  params: AuthorshipDeclarationParams;
  onComplete?: (record: AuthorshipDeclarationRecord) => void;
  onClose?: () => void;
}

type Step = 'review' | 'signing' | 'pinning' | 'done' | 'error';

export function AuthorshipDeclarationModal({ params, onComplete, onClose }: Props) {
  const { wallets } = useWallets();
  const [step, setStep] = useState<Step>('review');
  const [record, setRecord] = useState<AuthorshipDeclarationRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wallet = wallets[0];

  async function handleSign() {
    if (!wallet?.address) { setError('Wallet not connected'); setStep('error'); return; }
    setStep('signing');
    setError(null);
    try {
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: wallet.address as `0x${string}`,
        chain: gnosis,
        transport: custom(provider),
      });

      const doc = await buildDeclarationDocument(params);
      const message = buildEIP712AuthorshipMessage(doc);

      const signature = await walletClient.signTypedData({
        account: wallet.address as `0x${string}`,
        domain: { ...AUTHORSHIP_EIP712_DOMAIN, chainId: AUTHORSHIP_EIP712_DOMAIN.chainId },
        types: AUTHORSHIP_EIP712_TYPES,
        primaryType: 'AuthorshipDeclaration',
        message,
      });

      setStep('pinning');

      const res = await fetch('/api/agent/authorship/declare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document: { ...doc, text: doc.text, textHash: doc.textHash, timestamp: doc.timestamp, version: doc.version, params: doc.params },
          signature,
        }),
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? `Server error ${res.status}`);
      }

      const r = await res.json() as AuthorshipDeclarationRecord;
      setRecord(r);
      setStep('done');
      onComplete?.(r);
    } catch (e: any) {
      setError(e?.message ?? 'Signing failed');
      setStep('error');
    }
  }

  const fullDomain = `${params.agentName}.${params.domain}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[#0d0a07] shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#f2eee4]">IP Authorship Declaration</h2>
            <p className="text-[11px] text-[var(--muted)]">{fullDomain} · Victorian jurisdiction · EIP-712</p>
          </div>
          {onClose && (
            <button onClick={onClose} className="text-[var(--muted)] transition hover:text-white text-lg leading-none">×</button>
          )}
        </div>

        {/* Body */}
        <div className="max-h-[55vh] overflow-y-auto px-6 py-4">
          {step === 'done' && record ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg border border-green-800/40 bg-green-900/10 px-4 py-3 text-sm text-green-400">
                <span className="text-base">✓</span>
                Declaration signed, pinned to IPFS, and logged to GlassBox.
              </div>
              <dl className="space-y-2 text-[11px]">
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-[var(--muted)]">IPFS CID</dt>
                  <dd className="break-all font-mono text-[#c8bfb0]">{record.ipfsCid}</dd>
                </div>
                {record.glassBoxCid && (
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-[var(--muted)]">GlassBox</dt>
                    <dd className="break-all font-mono text-[#c8bfb0]">{record.glassBoxCid}</dd>
                  </div>
                )}
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-[var(--muted)]">Signature</dt>
                  <dd className="break-all font-mono text-[#c8bfb0]">{record.signature.slice(0, 20)}…</dd>
                </div>
              </dl>
              <p className="text-[10px] text-[var(--muted)]">
                This declaration is your contemporaneous record of human authorship under the <em>Electronic Transactions (Victoria) Act 2000</em> s.9 and <em>Copyright Act 1968</em> (Cth) s.197.
                Attach the IPFS CID to your Story Protocol IPA via PIL socialLegal metadata to complete the chain of title.
              </p>
            </div>
          ) : step === 'error' ? (
            <div className="rounded-lg border border-red-800/40 bg-red-900/10 px-4 py-3 text-sm text-red-400">
              {error ?? 'An error occurred.'}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Legal notice */}
              <div className="rounded-lg border border-amber-900/30 bg-amber-900/10 px-4 py-3 text-[11px] text-amber-300/80">
                <strong>Legal Notice:</strong> By signing this declaration with your wallet you are asserting human authorship over all IP generated by <strong>{fullDomain}</strong> during your ownership of NFT #{params.agentTokenId}. This constitutes a binding electronic signature under the <em>Electronic Transactions (Victoria) Act 2000</em> (Vic) s.9. Seek independent legal advice if uncertain.
              </div>

              {/* Declaration text */}
              <pre className="whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-black/30 px-4 py-3 font-mono text-[10px] leading-relaxed text-[#c8bfb0]">
{`AGENT IP AUTHORSHIP DECLARATION
Version: v1.0-2026-03-10

PARTIES
  Author:   ${params.authorWallet}
  Safe:     ${params.safeAddress}
  Agent:    ${fullDomain} (Token ID: ${params.agentTokenId})
  Platform: GhostAgent Ninja Pty Ltd, Victoria, Australia

DECLARATION
1. HUMAN AUTHORSHIP — Author is the Master Author directing AI output.
   AI agent is a tool. Copyright Act 1968 (Cth) — only humans hold copyright.

2. AGENT OUTPUT OWNERSHIP — Author claims all IP generated by the agent
   during ownership of NFT #${params.agentTokenId} on Gnosis Chain.

3. SCOPE — Code, narratives, trading strategies, creative works, and all
   other generative output produced under the Author's direction.

4. PLATFORM LICENSE — Non-exclusive, royalty-free license to GhostAgent
   Ninja Pty Ltd for display, showcase, and promotion only.

5. PIL LICENSING — Author sets Story Protocol PIL terms. Royalties → Safe.

6. MARKETPLACE TRANSFER — On NFT sale, IP transfers to Buyer per
   Marketplace IP Transfer Agreement.

7. PLATFORM IP SEPARATE — Platform code/branding remains with GhostAgent.

8. ELECTRONIC EXECUTION — EIP-712 signature under Electronic Transactions
   (Victoria) Act 2000 (Vic) s.9.`}
              </pre>

              {/* What MetaMask will show */}
              <div className="rounded-lg border border-[var(--border)] bg-black/20 px-4 py-3 text-[11px]">
                <p className="mb-1 font-medium text-[#f2eee4]">What you will sign in your wallet:</p>
                <ul className="space-y-0.5 text-[var(--muted)]">
                  <li><span className="font-mono text-[#c8bfb0]">authorWallet</span> → {params.authorWallet}</li>
                  <li><span className="font-mono text-[#c8bfb0]">safeAddress</span> → {params.safeAddress}</li>
                  <li><span className="font-mono text-[#c8bfb0]">agentTokenId</span> → {params.agentTokenId}</li>
                  <li><span className="font-mono text-[#c8bfb0]">declarationHash</span> → SHA-256 of full declaration text</li>
                  <li><span className="font-mono text-[#c8bfb0]">timestamp</span> → current Unix ms</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border)] px-6 py-4">
          {step === 'done' ? (
            <button onClick={onClose} className="ml-auto rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] transition hover:border-white/20 hover:text-white">
              Close
            </button>
          ) : step === 'error' ? (
            <div className="flex gap-3 ml-auto">
              <button onClick={() => setStep('review')} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] transition hover:text-white">
                Back
              </button>
              <button onClick={handleSign} className="rounded-lg bg-[#b0805c] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#c49070]">
                Retry
              </button>
            </div>
          ) : (
            <div className="flex w-full items-center justify-between gap-3">
              <p className="text-[10px] text-[var(--muted)]">
                Signed record pinned to IPFS · Logged to GlassBox · Linked to Story Protocol IPA
              </p>
              <div className="flex gap-2 shrink-0">
                {onClose && step === 'review' && (
                  <button onClick={onClose} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] transition hover:text-white">
                    Cancel
                  </button>
                )}
                <button
                  onClick={handleSign}
                  disabled={step !== 'review' || !wallet?.address}
                  className="relative rounded-lg bg-[#b0805c] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#c49070] disabled:opacity-50"
                >
                  {step === 'signing' ? (
                    <span className="flex items-center gap-2"><span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />Waiting for wallet…</span>
                  ) : step === 'pinning' ? (
                    <span className="flex items-center gap-2"><span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />Pinning to IPFS…</span>
                  ) : (
                    'Sign Declaration'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
