'use client';

/**
 * @module MercuryoWidget
 * Embedded Mercuryo fiat on-ramp for Gnosis Chain (xDAI).
 * Fallback when Transak is unavailable in user's region.
 *
 * Zero lock-in: uses Mercuryo's hosted widget URL directly — no SDK package needed.
 *
 * Environment vars required:
 *   NEXT_PUBLIC_MERCURYO_WIDGET_ID  — from mercuryo.io dashboard
 *   NEXT_PUBLIC_MERCURYO_SECRET     — for signature (public-safe subset only)
 *
 * Usage:
 *   <MercuryoButton walletAddress="0x..." defaultAmount={10} onSuccess={...} />
 */

import { useState, useEffect, useRef } from 'react';

const MERCURYO_WIDGET_URL = 'https://widget.mercuryo.io';

export interface MercuryoWidgetProps {
  walletAddress: string;
  defaultAmount?: number;  // fiat USD, default 10
  currency?: string;       // crypto to buy, e.g. 'USDC' or 'XDAI' (default 'USDC')
  network?: string;        // network slug, e.g. 'BASE' or 'ETHEREUM' (default 'BASE')
  onSuccess?: (txId: string) => void;
  onClose?: () => void;
}

function buildMercuryoUrl(
  walletAddress: string,
  defaultAmount: number,
  currency = 'USDC',
  network = 'BASE',
): string | undefined {
  const widgetId = process.env.NEXT_PUBLIC_MERCURYO_WIDGET_ID;
  if (!widgetId || widgetId === 'YOUR_MERCURYO_WIDGET_ID') {
    return undefined; // Widget not configured
  }
  // Map network to Mercuryo's expected format
  const networkMap: Record<string, string> = {
    'BASE': 'base',
    'ETHEREUM': 'ethereum',
    'GNOSIS': 'gnosis',
    'XDAI': 'gnosis',
  };
  const mercuryoNetwork = networkMap[network.toUpperCase()] || network.toLowerCase();
  const params = new URLSearchParams({
    widget_id:    widgetId,
    type:         'buy',
    currency:     currency.toUpperCase(),
    network:      mercuryoNetwork,
    address:      walletAddress,
    fiat_currency:'USD',
    amount:       String(defaultAmount),
    fix_amount:   'false',
    fix_currency: 'true',
    theme:        'dark',
    lang:         'en',
    return_url:   typeof window !== 'undefined' ? window.location.href : 'https://ghostagent.ninja',
  });
  return `${MERCURYO_WIDGET_URL}?${params.toString()}`;
}

// Fallback: open Mercuryo in new tab (works without widget ID)
function buildMercuryoDirectUrl(
  walletAddress: string,
  defaultAmount: number,
  currency = 'USDC',
  network = 'BASE',
): string {
  const networkMap: Record<string, string> = {
    'BASE': 'base',
    'ETHEREUM': 'ethereum',
    'GNOSIS': 'gnosis',
    'XDAI': 'gnosis',
  };
  const mercuryoNetwork = networkMap[network.toUpperCase()] || network.toLowerCase();
  const params = new URLSearchParams({
    type:         'buy',
    currency:     currency.toUpperCase(),
    network:      mercuryoNetwork,
    address:      walletAddress,
    fiat_currency:'USD',
    amount:       String(defaultAmount),
    theme:        'dark',
  });
  return `${MERCURYO_WIDGET_URL}?${params.toString()}`;
}

export function MercuryoWidget({
  walletAddress,
  defaultAmount = 10,
  currency = 'USDC',
  network = 'BASE',
  onSuccess,
  onClose,
}: MercuryoWidgetProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const url = buildMercuryoUrl(walletAddress, defaultAmount, currency, network);

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!e.origin.includes('widget.mercuryo.io')) return;
      try {
        const { type, data } = e.data ?? {};
        if (type === 'mercuryo-transaction' && data?.status === 'paid') {
          onSuccess?.(data?.id ?? data?.txId ?? 'unknown');
        }
        if (type === 'mercuryo-close') {
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
        title={`Mercuryo — Buy ${currency} with card`}
        className="h-[570px] w-full border-none"
      />
    </div>
  );
}

// ─── Trigger button + inline modal wrapper ─────────────────────────────────

export interface MercuryoButtonProps {
  walletAddress: string;
  defaultAmount?: number;
  currency?: string;   // 'USDC' (default) or 'XDAI'
  network?: string;    // 'BASE' (default), 'ETHEREUM', or 'GNOSIS'
  onSuccess?: (txId: string) => void;
  label?: string;
  className?: string;
}

export function MercuryoButton({
  walletAddress,
  defaultAmount = 10,
  currency = 'USDC',
  network = 'BASE',
  onSuccess,
  label = 'Pay with Card (Mercuryo)',
  className,
}: MercuryoButtonProps) {
  const [open, setOpen] = useState(false);
  const widgetUrl = buildMercuryoUrl(walletAddress, defaultAmount, currency, network);
  const directUrl = buildMercuryoDirectUrl(walletAddress, defaultAmount, currency, network);
  const isConfigured = typeof widgetUrl === 'string';

  function handleSuccess(txId: string) {
    onSuccess?.(txId);
    setOpen(false);
  }

  // If widget not configured, show disabled button with tooltip
  if (!isConfigured) {
    return (
      <div className="relative group">
        <button
          type="button"
          disabled
          className={
            className ??
            'flex w-full items-center justify-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/5 py-3 text-sm font-semibold text-sky-200/50 transition cursor-not-allowed'
          }
        >
          <span>💳</span>
          Card payments unavailable
        </button>
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-black border border-sky-500/30 rounded-lg text-[10px] text-sky-200 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
          Card payments require Mercuryo widget configuration
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          'flex w-full items-center justify-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 py-3 text-sm font-semibold text-sky-200 transition hover:bg-sky-500/20'
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
                Buy {currency.toUpperCase()} with card · {network.charAt(0).toUpperCase() + network.slice(1).toLowerCase()} · Mercuryo
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-[var(--muted)] hover:text-white transition-colors text-sm"
              >
                ✕
              </button>
            </div>

            <MercuryoWidget
              walletAddress={walletAddress}
              defaultAmount={defaultAmount}
              currency={currency}
              network={network}
              onSuccess={handleSuccess}
              onClose={() => setOpen(false)}
            />

            <p className="mt-2 text-center text-[9px] text-[var(--muted)]">
              Powered by Mercuryo · KYC required above limits · {currency.toUpperCase()} sent directly to your wallet
            </p>
          </div>
        </div>
      )}
    </>
  );
}
