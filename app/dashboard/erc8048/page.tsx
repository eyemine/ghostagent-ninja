'use client';

import { useState, useEffect } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import Link from 'next/link';
import type { Abi } from 'viem';
import {
  KNOWN_KEYS,
  REGISTRY_ABI,
  buildPublishPlan,
  encodeStringValue,
} from '../../services/erc8048-publisher';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';

// Address populated after GhostAgentMetadataRegistry is deployed
const REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_ERC8048_REGISTRY ?? '';

export default function Erc8048Page() {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();

  const [agentName, setAgentName] = useState('');
  const [agentId, setAgentId] = useState<number | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Read agentName from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const name = params.get('agent') ?? '';
    setAgentName(name);
    if (name) fetchAgentId(name);
  }, []);

  async function fetchAgentId(name: string) {
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getAgentIdentity', agentName: name }),
      });
      const data = await res.json() as { erc8004?: { gnosis?: { agentId?: number } } };
      const id = data?.erc8004?.gnosis?.agentId;
      if (id) setAgentId(id);
    } catch { /* non-fatal */ }
  }

  async function handlePublish() {
    if (!agentId) { setErrorMsg('Agent ID not found — ensure this agent is registered on Gnosis.'); return; }
    if (!REGISTRY_ADDRESS) { setErrorMsg('NEXT_PUBLIC_ERC8048_REGISTRY not set — deploy the contract first.'); return; }

    const wallet = wallets[0];
    if (!wallet) { setErrorMsg('Connect your wallet first.'); return; }

    const entries = Object.entries(values).filter(([, v]) => v.trim());
    if (!entries.length) { setErrorMsg('Enter at least one metadata value.'); return; }

    setStatus('loading');
    setErrorMsg(null);
    setTxHash(null);

    try {
      const provider = await wallet.getEthereumProvider();
      const plan = buildPublishPlan({
        registryAddress: REGISTRY_ADDRESS,
        agentId,
        a2aEndpoint: values['endpoint[a2a]'],
        mcpServer:   values['endpoint[mcp]'],
        primarySkill: values['skills/primary'],
        tools:       values['skills/tools'],
      });

      // Import viem dynamically to keep bundle lean
      const { encodeFunctionData } = await import('viem');

      const keys   = plan.entries.map(e => e.key);
      const encoded = plan.entries.map(e => encodeStringValue(e.value));

      const calldata = encodeFunctionData({
        abi: REGISTRY_ABI as unknown as Abi,
        functionName: 'setMetadataBatch',
        args: [plan.tokenId, keys, encoded],
      });

      const accounts = await provider.request({ method: 'eth_accounts' });
      const from = (accounts as string[])[0];

      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ from, to: REGISTRY_ADDRESS, data: calldata }],
      });

      setTxHash(hash as string);
      setStatus('success');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Transaction failed');
      setStatus('error');
    }
  }

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-black text-zinc-100 p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link href="/dashboard" className="text-xs text-zinc-500 hover:text-zinc-300">← Dashboard</Link>
        <h1 className="mt-3 text-2xl font-bold text-white">Publish ERC-8048 Metadata</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Write endpoint and skill metadata on-chain for{' '}
          <span className="text-fuchsia-400 font-mono">{agentName || '—'}</span>
          {agentId ? <span className="ml-2 text-zinc-500">(agentId #{agentId})</span> : null}
        </p>
      </div>

      {!REGISTRY_ADDRESS && (
        <div className="mb-4 rounded border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          Registry contract not deployed yet. Set <code className="font-mono text-xs">NEXT_PUBLIC_ERC8048_REGISTRY</code> after deployment.
        </div>
      )}

      <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        {KNOWN_KEYS.map(({ key, label, hint }) => (
          <div key={key}>
            <label className="block text-xs font-medium text-zinc-400 mb-1">{label}</label>
            <input
              type="text"
              placeholder={hint}
              value={values[key] ?? ''}
              onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-fuchsia-500 focus:outline-none"
            />
            <p className="mt-0.5 text-[10px] text-zinc-600 font-mono">key: {key}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={handlePublish}
          disabled={status === 'loading' || !authenticated}
          className="rounded border border-fuchsia-500/40 bg-fuchsia-500/15 px-5 py-2.5 text-sm font-semibold text-fuchsia-300 hover:bg-fuchsia-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {status === 'loading' ? 'Publishing…' : 'Publish On-Chain'}
        </button>
        {!authenticated && (
          <span className="text-xs text-zinc-500">Connect wallet to publish</span>
        )}
      </div>

      {errorMsg && (
        <div className="mt-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {errorMsg}
        </div>
      )}

      {status === 'success' && txHash && (
        <div className="mt-4 rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          Published!{' '}
          <a
            href={`https://gnosisscan.io/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-mono text-xs"
          >
            {txHash.slice(0, 18)}…
          </a>
        </div>
      )}

      <div className="mt-8 rounded border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-xs text-zinc-500">
        <p className="font-semibold text-zinc-400 mb-1">How this works</p>
        <p>Calls <code className="font-mono">setMetadataBatch(agentId, keys[], values[])</code> on the GhostAgentMetadataRegistry sidecar. The Safe operator address must match your wallet. Any ERC-8048-compatible resolver can read these values universally.</p>
      </div>
    </div>
  );
}
