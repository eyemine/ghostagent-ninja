'use client';

/// X402Badge — shows x402 payment-gated status for an agent endpoint
/// Displays: price, network, payment address, and live "PAID" receipt if available

import { useState } from 'react';

interface X402BadgeProps {
  price?: string;
  network?: string;
  endpoint?: string;
  compact?: boolean;
}

export default function X402Badge({
  price = '$0.001',
  network = 'Base Sepolia',
  endpoint = '/api/x402/deliver',
  compact = false,
}: X402BadgeProps) {
  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);

  async function fetchInfo() {
    setChecking(true);
    try {
      const res = await fetch(endpoint, { method: 'GET' });
      if (res.ok) setInfo(await res.json());
    } catch {}
    setChecking(false);
  }

  if (compact) {
    return (
      <span
        onClick={fetchInfo}
        title={`x402 payment gate — ${price} per request on ${network}`}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono font-semibold cursor-pointer select-none"
        style={{ background: '#0052ff18', color: '#0052ff', border: '1px solid #0052ff44' }}
      >
        <span style={{ fontSize: '9px' }}>⚡</span>
        x402
        <span style={{ opacity: 0.7 }}>{price}</span>
      </span>
    );
  }

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-2"
      style={{ background: '#0052ff0d', border: '1px solid #0052ff33' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚡</span>
          <span className="font-semibold text-sm" style={{ color: '#0052ff' }}>
            x402 Payment Gate
          </span>
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded-full font-mono"
          style={{ background: '#0052ff22', color: '#0052ff' }}
        >
          ACTIVE
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono mt-1">
        <span className="opacity-50">Price</span>
        <span className="font-semibold">{price} USDC</span>
        <span className="opacity-50">Network</span>
        <span>{network}</span>
        <span className="opacity-50">Endpoint</span>
        <span className="truncate opacity-80">{endpoint}</span>
      </div>

      {info && (
        <div
          className="mt-2 rounded-lg p-2 text-xs font-mono"
          style={{ background: '#0052ff0d', border: '1px solid #0052ff22' }}
        >
          <div className="opacity-50 mb-1">Discovery info</div>
          <div>{String(info.description ?? '')}</div>
          <div className="opacity-60 mt-1">payTo: {String(info.payTo ?? '—')}</div>
        </div>
      )}

      <button
        onClick={fetchInfo}
        disabled={checking}
        className="mt-1 text-xs px-3 py-1 rounded-lg font-mono transition-opacity"
        style={{
          background: '#0052ff',
          color: '#fff',
          opacity: checking ? 0.5 : 1,
          cursor: checking ? 'not-allowed' : 'pointer',
          border: 'none',
        }}
      >
        {checking ? 'Checking…' : 'Verify endpoint'}
      </button>
    </div>
  );
}
