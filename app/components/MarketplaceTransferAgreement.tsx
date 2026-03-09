'use client';

import { useState } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { createWalletClient, custom } from 'viem';
import { gnosis } from 'viem/chains';
import {
  EIP712_DOMAIN,
  EIP712_TYPES,
  buildAgreementDocument,
  buildEIP712Message,
  logAgreementToGlassBox,
} from '../services/ip-transfer-agreement';

interface TransferAgreementProps {
  agentName: string;
  safeAddress: string;
  listingPriceXdai: number;
  namespace: string;
  onSigned: (result: { signature: string; agreementHash: string; ipfsCid: string }) => void;
  onCancel: () => void;
}

type SignStep = 'idle' | 'signing' | 'pinning' | 'logging' | 'done' | 'error';

export function MarketplaceTransferAgreement({
  agentName,
  safeAddress,
  listingPriceXdai,
  namespace,
  onSigned,
  onCancel,
}: TransferAgreementProps) {
  const { wallets } = useWallets();
  const [agreed, setAgreed] = useState(false);
  const [step, setStep] = useState<SignStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ signature: string; agreementHash: string; ipfsCid: string } | null>(null);

  const wallet = wallets[0];

  async function handleSign() {
    if (!agreed || !wallet?.address) return;
    setStep('signing');
    setError(null);

    try {
      // 1. Build agreement document
      const doc = await buildAgreementDocument({
        agentName,
        safeAddress,
        listingPriceXdai,
        seller: wallet.address,
      });

      // 2. EIP-712 sign via wallet
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: wallet.address as `0x${string}`,
        chain: gnosis,
        transport: custom(provider),
      });

      const message = buildEIP712Message(doc);
      const signature = await walletClient.signTypedData({
        account: wallet.address as `0x${string}`,
        domain: EIP712_DOMAIN,
        types: EIP712_TYPES,
        primaryType: 'IPTransferAgreement',
        message,
      });

      // 3. Submit to API (pins to IPFS + logs to GlassBox + stores listing)
      setStep('pinning');
      const res = await fetch('/api/marketplace/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName,
          safeAddress,
          listingPriceXdai,
          seller: wallet.address,
          namespace,
          signature,
          agreementHash: doc.textHash,
          timestamp: doc.timestamp,
        }),
      });

      setStep('logging');
      const data = await res.json() as { status?: string; ipfsCid?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Listing failed');

      // 4. Also fire client-side GlassBox log for immediate UI feedback
      await logAgreementToGlassBox({
        agentName,
        tld: namespace,
        seller: wallet.address,
        textHash: doc.textHash,
        ipfsCid: data.ipfsCid ?? '',
        signature,
      }).catch(() => {});

      const signedResult = { signature, agreementHash: doc.textHash, ipfsCid: data.ipfsCid ?? '' };
      setResult(signedResult);
      setStep('done');
      setTimeout(() => onSigned(signedResult), 1500);

    } catch (e: any) {
      setError(e?.message ?? 'Signing failed');
      setStep('error');
    }
  }

  const stepLabel: Record<SignStep, string> = {
    idle:    'Sign & List Agent',
    signing: 'Waiting for wallet signature…',
    pinning: 'Pinning to IPFS…',
    logging: 'Logging to GlassBox…',
    done:    'IP Transfer Agreement Signed ✓',
    error:   'Retry',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--border)] bg-[#0f0703] shadow-2xl">

        {/* Header */}
        <div className="border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-base font-semibold text-[#f2eee4]">Marketplace IP Transfer Agreement</h2>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            EIP-712 signed · IPFS pinned · GlassBox logged · NSW, Australia law
          </p>
        </div>

        {/* Signed badge */}
        {step === 'done' && result && (
          <div className="mx-6 mt-4 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-3">
            <span className="text-emerald-400 text-lg">✓</span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-emerald-300">IP Transfer Agreement Signed ✓</p>
              <p className="truncate text-[10px] text-[var(--muted)]">IPFS: {result.ipfsCid}</p>
            </div>
          </div>
        )}

        {/* Agreement text — hidden once done */}
        {step !== 'done' && (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <pre className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-[#a09080]">
{`MARKETPLACE IP TRANSFER AGREEMENT
Version: v1.0-2026-03-09

PARTIES:
  Transferor (Seller): ${wallet?.address ?? '[connect wallet]'}
  Transferee (Buyer):  [wallet completing purchase]
  Platform:            GhostAgent.ninja, Eyemine Pty Ltd, Australia

ASSET:
  Agent Identity:  ${agentName}
  Gnosis Safe:     ${safeAddress}
  Listing Price:   ${listingPriceXdai} xDAI

TERMS:
1. Full legal and beneficial ownership of agent identity "${agentName}",
   associated NFT, metadata, and Gnosis Safe at ${safeAddress} transfers
   to Buyer on completion of purchase transaction.

2. The Seller's EIP-712 wallet signature constitutes a binding written
   agreement under the Electronic Transactions Act 1999 (Cth) and is
   intended as a copyright assignment under Copyright Act 1968 (Cth) s.197.

3. Seller warrants sole ownership, no encumbrances, and full authority.

4. GhostAgent.ninja accepts no liability for transfer disputes.
   Both parties should seek independent legal advice.

5. Governed by the laws of New South Wales, Australia.

RECORD: Agreement text pinned to IPFS. Signature hash logged to GlassBox.`}
            </pre>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-[var(--border)] px-6 py-4 space-y-4">
          {step !== 'done' && (
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={agreed}
                onChange={e => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#b0805c]"
                disabled={step !== 'idle' && step !== 'error'}
              />
              <span className="text-[11px] leading-relaxed text-[var(--muted)]">
                I am the legal owner of <strong className="text-[#f2eee4]">{agentName}</strong> and the Gnosis Safe at{' '}
                <code className="text-[10px] text-[#b0805c]">{safeAddress.slice(0, 6)}…{safeAddress.slice(-4)}</code>.
                My wallet signature is a binding agreement under Australian law.
              </span>
            </label>
          )}

          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/8 px-3 py-2 text-[11px] text-red-400">{error}</p>
          )}

          {/* Progress indicators */}
          {(step === 'signing' || step === 'pinning' || step === 'logging') && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#b0805c] border-t-transparent" />
              {stepLabel[step]}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 rounded-lg border border-[var(--border)] py-2.5 text-xs text-[var(--muted)] transition hover:border-white/20 hover:text-white"
              disabled={step === 'signing' || step === 'pinning' || step === 'logging'}
            >
              Cancel
            </button>
            {step !== 'done' && (
              <button
                onClick={handleSign}
                disabled={!agreed || !wallet || (step !== 'idle' && step !== 'error')}
                className="flex-1 rounded-lg bg-[#b0805c] py-2.5 text-xs font-semibold text-white transition hover:bg-[#c8935f] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {stepLabel[step]}
              </button>
            )}
          </div>
          <p className="text-center text-[10px] text-[var(--muted)]">
            EIP-712 signature · IPFS permanent record · GlassBox audit trail
          </p>
        </div>
      </div>
    </div>
  );
}
