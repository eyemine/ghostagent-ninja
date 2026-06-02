'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { fetchSovereignSidecarMatrix, fetchTokenIdsForWallet } from '../../services/envio';
import { encodeStringValue, KNOWN_KEYS } from '../../services/erc8048-publisher';
import type { TokenSidecarState } from '../../types/indexer';

const BASE_CHONK_CONTRACT = (process.env.NEXT_PUBLIC_BASE_CHONK_CONTRACT ?? '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9') as `0x${string}`;
const REGISTRY = process.env.NEXT_PUBLIC_ERC8048_REGISTRY ?? '0x0106341056a8790f4b924c380ed5B81B2a062bCE';

function short(v: string, l = 10, r = 6) {
  return v.length <= l + r + 3 ? v : `${v.slice(0, l)}...${v.slice(-r)}`;
}

export default function Erc8048Dashboard() {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [sidecars, setSidecars] = useState<TokenSidecarState[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [contractInput, setContractInput] = useState(BASE_CHONK_CONTRACT as string);
  const [tokenIdInput, setTokenIdInput] = useState('');
  const [metaKey, setMetaKey] = useState<string>(KNOWN_KEYS[0].key);
  const [metaValue, setMetaValue] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const userAddress = useMemo(() => wallets[0]?.address ?? '', [wallets]);

  const loadMatrix = useCallback(async () => {
    if (!userAddress) return;
    setLoading(true);
    setLoadError(null);
    try {
      const ids = await fetchTokenIdsForWallet(userAddress, contractInput);
      if (ids.length === 0) {
        setSidecars([]);
      } else {
        const matrix = await fetchSovereignSidecarMatrix(contractInput as `0x${string}`, ids);
        setSidecars(matrix);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load sidecar matrix');
    } finally {
      setLoading(false);
    }
  }, [userAddress, contractInput]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void loadMatrix();
  }, [ready, authenticated, loadMatrix]);

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenIdInput || !metaKey || !metaValue) return;
    setPublishing(true);
    setPublishStatus(null);
    setPublishError(null);
    try {
      const provider = (window as unknown as { ethereum?: unknown }).ethereum;
      if (!provider) throw new Error('No wallet provider found');
      const { createWalletClient, custom, encodeFunctionData } = await import('viem');
      const { gnosis } = await import('viem/chains');
      const walletClient = createWalletClient({ chain: gnosis, transport: custom(provider as Parameters<typeof custom>[0]) });
      const [account] = await walletClient.requestAddresses();
      const data = encodeFunctionData({
        abi: [{
          name: 'setMetadata',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'key', type: 'string' }, { name: 'value', type: 'bytes' }],
          outputs: [],
        }] as const,
        functionName: 'setMetadata',
        args: [BigInt(tokenIdInput), metaKey, encodeStringValue(metaValue) as `0x${string}`],
      });
      const txHash = await walletClient.sendTransaction({ account, to: REGISTRY as `0x${string}`, data, chain: gnosis });
      setPublishStatus(`Broadcast: ${txHash}`);
      void loadMatrix();
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setPublishing(false);
    }
  }

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-white lg:p-8">
      <header className="mb-6">
        <Link href="/dashboard" className="text-xs text-slate-500 transition hover:text-slate-300">← Dashboard</Link>
        <h1 className="mt-2 text-xl font-bold tracking-tight">Sovereign Sidecar Matrix (ERC-8048)</h1>
        <p className="mt-0.5 font-mono text-xs text-slate-400">On-Chain Extension Metadata Infrastructure · GhostAgentMetadataRegistry</p>
      </header>

      {!authenticated ? (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-6">
          <p className="text-sm text-indigo-100">Connect your wallet to inspect sidecar state and publish metadata keys.</p>
          <button onClick={login} className="mt-4 rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500">
            Connect Wallet
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

          {/* ── Left: Sidecar Matrix Viewer ── */}
          <div className="space-y-4 lg:col-span-2">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="mb-1 block font-mono text-xs text-slate-400">NFT Contract Address</label>
                <input
                  value={contractInput}
                  onChange={e => setContractInput(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white outline-none focus:border-indigo-500"
                  placeholder="0x..."
                />
              </div>
              <button onClick={() => void loadMatrix()} disabled={loading} className="rounded border border-slate-700 bg-slate-800 px-4 py-2 font-mono text-xs text-slate-300 transition hover:bg-slate-700 disabled:opacity-50">
                {loading ? 'Scanning...' : 'Refresh'}
              </button>
            </div>

            {loadError && (
              <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 font-mono text-xs text-red-300">{loadError}</div>
            )}

            {!loading && !loadError && sidecars.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-800 p-6 font-mono text-xs text-slate-500">
                No sidecar metadata indexed for your tokens on this contract.<br />
                <span className="text-slate-600">Use the toolkit → to initialise a sidecar key.</span>
              </div>
            )}

            {sidecars.length > 0 && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {sidecars.map((sc) => (
                  <div key={sc.tokenId} className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 font-mono text-xs">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-bold text-slate-200">{sc.name}</span>
                      {sc.hasSidecarState
                        ? <span className="rounded bg-emerald-900/60 px-2 py-0.5 text-emerald-400">indexed</span>
                        : <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-500">empty</span>}
                    </div>
                    <div className="space-y-1 text-slate-400">
                      <div><span className="text-indigo-400">story[ip_id]:</span> {sc.storyIpId ? short(sc.storyIpId) : 'None'}</div>
                      <div><span className="text-indigo-400">story[license_id]:</span> {sc.storyLicenseId ?? 'None'}</div>
                      <div><span className="text-indigo-400">cdr[vault_id]:</span> {sc.cdrVaultId ?? 'None'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Right: Publish Toolkit ── */}
          <div className="h-fit rounded-xl border border-slate-800 bg-slate-900/60 p-5 font-mono text-xs">
            <h2 className="mb-4 border-b border-slate-800 pb-3 text-sm font-bold text-slate-200">Sidecar Registry Toolkit</h2>
            <form onSubmit={(e) => void handlePublish(e)} className="space-y-4">
              <div>
                <label className="mb-1 block text-slate-400">Token ID</label>
                <input
                  type="number"
                  value={tokenIdInput}
                  onChange={e => setTokenIdInput(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-indigo-500"
                  placeholder="e.g. 42"
                />
              </div>
              <div>
                <label className="mb-1 block text-slate-400">Metadata Key</label>
                <select
                  value={metaKey}
                  onChange={e => setMetaKey(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-indigo-500"
                >
                  {KNOWN_KEYS.map(k => (
                    <option key={k.key} value={k.key}>{k.key} — {k.label}</option>
                  ))}
                  <option value="story[ip_id]">story[ip_id] — Story IPA</option>
                  <option value="story[license_id]">story[license_id] — License</option>
                  <option value="cdr[vault_id]">cdr[vault_id] — Data Rail</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-slate-400">Value</label>
                <input
                  type="text"
                  value={metaValue}
                  onChange={e => setMetaValue(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-indigo-500"
                  placeholder={KNOWN_KEYS.find(k => k.key === metaKey)?.hint ?? 'Enter value'}
                />
              </div>
              <div className="border-t border-slate-800 pt-3 font-mono text-xs text-slate-500">
                <div>Registry: <span className="text-slate-400">{short(REGISTRY, 10, 6)}</span></div>
                <div>Chain: <span className="text-slate-400">Gnosis (100)</span></div>
              </div>
              <button
                type="submit"
                disabled={publishing || !tokenIdInput || !metaValue}
                className="w-full rounded bg-indigo-600 py-2 font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {publishing ? 'Broadcasting...' : 'Commit Sidecar Key'}
              </button>
            </form>

            {publishStatus && (
              <div className="mt-3 break-all rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-300">{publishStatus}</div>
            )}
            {publishError && (
              <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300">{publishError}</div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
