'use client';

/**
 * @module TransakWidget
 * Embedded Transak fiat on-ramp for Gnosis Chain (xDAI).
 *
 * Zero lock-in: uses Transak's hosted widget URL directly — no SDK package needed.
 * Transak handles KYC, payment processing, and on-chain delivery.
 *
 * Environment vars required:
 *   NEXT_PUBLIC_TRANSAK_API_KEY  — staging key: "your-staging-key", prod key from transak.com
 *
 * Usage:
 *   <TransakWidget walletAddress="0x..." defaultAmount={10} onSuccess={...} onClose={...} />
 */

import { useState, useEffect, useRef } from 'react';

const TRANSAK_STAGING_URL = 'https://global-stg.transak.com';
const TRANSAK_PROD_URL    = 'https://global.transak.com';

const IS_PROD = process.env.NODE_ENV === 'production';
const TRANSAK_BASE = IS_PROD ? TRANSAK_PROD_URL : TRANSAK_STAGING_URL;

export interface TransakWidgetProps {
  walletAddress: string;
  defaultAmount?: number;   // fiat amount in USD, default 10
  maxAmount?: number;       // cap, default 50
  onSuccess?: (orderId: string) => void;
  onClose?: () => void;
  label?: string;           // button label override
}

function buildTransakUrl(walletAddress: string, defaultAmount: number): string {
  const apiKey = process.env.NEXT_PUBLIC_TRANSAK_API_KEY ?? 'YOUR_TRANSAK_API_KEY';
  const params = new URLSearchParams({
    apiKey,
    environment:          IS_PROD ? 'PRODUCTION' : 'STAGING',
    cryptoCurrencyCode:   'XDAI',
    network:              'gnosis',
    walletAddress,
    defaultFiatAmount:    String(defaultAmount),
    fiatCurrency:         'USD',
    defaultPaymentMethod: 'credit_debit_card',
    disableWalletAddressForm: 'true',
    hideMenu:             'true',
    widgetHeight:         '570px',
    widgetWidth:          '100%',
    themeColor:           'f59e0b',   // amber-400 — matches GhostAgent UI
    backgroundColor:      '0a0a0a',
  });
  return `${TRANSAK_BASE}?${params.toString()}`;
}

export function TransakWidget({
  walletAddress,
  defaultAmount = 10,
  onSuccess,
  onClose,
}: TransakWidgetProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const url = buildTransakUrl(walletAddress, defaultAmount);

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!e.origin.includes('transak.com')) return;
      try {
        const { event_id, data } = e.data ?? {};
        if (event_id === 'TRANSAK_ORDER_SUCCESSFUL') {
          onSuccess?.(data?.status?.id ?? data?.orderId ?? 'unknown');
        }
        if (event_id === 'TRANSAK_WIDGET_CLOSE') {
          onClose?.();
        }
      } catch {
        // ignore malformed messages
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onSuccess, onClose]);

  return (
    <div className="w-full overflow-hidden rounded-xl border border-[var(--border)] bg-black">
      <iframe
        ref={iframeRef}
        src={url}
        allow="camera; microphone; payment"
        title="Transak — Buy xDAI with card"
        className="h-[570px] w-full border-none"
      />
    </div>
  );
}

// ─── Trigger button + inline modal wrapper ─────────────────────────────────

export interface TransakButtonProps {
  walletAddress: string;
  defaultAmount?: number;
  onSuccess?: (orderId: string) => void;
  label?: string;
  className?: string;
}

export function TransakButton({
  walletAddress,
  defaultAmount = 10,
  onSuccess,
  label = 'Pay with Card from $10 (Transak)',
  className,
}: TransakButtonProps) {
  const [open, setOpen] = useState(false);

  function handleSuccess(orderId: string) {
    onSuccess?.(orderId);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          'flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 py-3 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/20'
        }
      >
        <span>💳</span>
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center px-4 pb-4 sm:pb-0">
          <div className="relative w-full max-w-sm">
            {/* Header */}
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="text-xs font-semibold text-[var(--muted)]">
                Buy xDAI with card · Gnosis Chain
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-[var(--muted)] hover:text-white transition-colors text-sm"
              >
                ✕
              </button>
            </div>

            <TransakWidget
              walletAddress={walletAddress}
              defaultAmount={defaultAmount}
              onSuccess={handleSuccess}
              onClose={() => setOpen(false)}
            />

            <p className="mt-2 text-center text-[9px] text-[var(--muted)]">
              Powered by Transak · KYC required above limits · xDAI sent directly to your wallet
            </p>
          </div>
        </div>
      )}
    </>
  );
}
