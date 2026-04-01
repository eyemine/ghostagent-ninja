'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createWalletClient, custom, parseEther } from 'viem';
import { gnosis } from '../../utils/chains';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useSafeAuth } from '../../hooks/useSafeAuth';

const GNOSIS_TREASURY = '0xeD0B0694953158dd54D0c36D320b391f44cd67f3' as const;
const MOLT_FEE = parseEther('2');

const COLLECTIONS = [
  {
    id: 'chonk',
    name: 'Chonk',
    icon: '🦀',
    chain: 'Base',
    chainId: 8453,
    description: 'Chonk NFT on Base — the original ghost agent overlay',
    aliasExample: 'CHONK_123_@nftmail.box',
    accentFrom: 'from-fuchsia-600',
    accentTo: 'to-violet-600',
    accentBorder: 'border-fuchsia-500/30',
    accentBg: 'bg-fuchsia-500/8',
    accentText: 'text-fuchsia-300',
  },
  {
    id: 'pownft',
    name: 'POWNFT',
    icon: '💥',
    chain: 'Ethereum',
    chainId: 1,
    description: 'On-chain generative art on Ethereum',
    aliasExample: 'ATOM_42_@nftmail.box',
    accentFrom: 'from-yellow-500',
    accentTo: 'to-orange-500',
    accentBorder: 'border-yellow-500/30',
    accentBg: 'bg-yellow-500/8',
    accentText: 'text-yellow-300',
  },
  {
    id: 'punks',
    name: 'CryptoPunks',
    icon: '👾',
    chain: 'Ethereum',
    chainId: 1,
    description: 'The OG NFT collection — 10,000 unique punks',
    aliasExample: 'PUNK_7804_@nftmail.box',
    accentFrom: 'from-cyan-500',
    accentTo: 'to-sky-600',
    accentBorder: 'border-cyan-500/30',
    accentBg: 'bg-cyan-500/8',
    accentText: 'text-cyan-300',
  },
  {
    id: 'normies',
    name: 'Normies',
    icon: '🙂',
    chain: 'Base',
    chainId: 8453,
    description: 'Normies NFT collection on Base',
    aliasExample: 'NORMIE_1_@nftmail.box',
    accentFrom: 'from-green-500',
    accentTo: 'to-emerald-600',
    accentBorder: 'border-green-500/30',
    accentBg: 'bg-green-500/8',
    accentText: 'text-green-300',
  },
];

type Step = 'select' | 'details' | 'paying' | 'molting' | 'done' | 'error';

interface MoltResult {
  collection: string;
  primaryEmail: string;
  aliasEmail: string;
  beaconNft: string;
  beaconTxHash: string;
  message: string;
}

export default function CollectionMoltPage() {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { isSafeAuth, safeAddress } = useSafeAuth();

  const connectedWallet = isSafeAuth ? safeAddress : wallets[0]?.address ?? '';
  const isConnected = authenticated || isSafeAuth;

  const [step, setStep] = useState<Step>('select');
  const [selectedCollection, setSelectedCollection] = useState<typeof COLLECTIONS[0] | null>(null);
  const [primaryName, setPrimaryName] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [ownerWallet, setOwnerWallet] = useState(connectedWallet ?? '');
  const [verifying, setVerifying] = useState(false);
  const [ownershipOk, setOwnershipOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<MoltResult | null>(null);

  function addLog(msg: string) {
    setLogs(prev => [...prev, `${new Date().toLocaleTimeString()} — ${msg}`]);
  }

  async function handleVerifyOwnership() {
    if (!selectedCollection || !tokenId || !ownerWallet) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch('/api/molt/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: primaryName || '_check',
          callerWallet: ownerWallet,
          targetName: `${selectedCollection.id}${tokenId}`,
          targetTld: 'molt.gno',
        }),
      });
      // Also verify NFT ownership directly
      const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');
      // Use punk-specific selector for CryptoPunks
      const selector = selectedCollection.id === 'punks' ? '0x58178168' : '0x6352211e';
      const rpcUrl = selectedCollection.chainId === 1
        ? (process.env.NEXT_PUBLIC_ETH_RPC || 'https://ethereum.publicnode.com')
        : 'https://mainnet.base.org';

      // Fetch the collection contract from client-side
      const contracts: Record<string, string> = {
        chonk:   '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9',
        pownft:  '0x3B3ee1931Dc30C1957379FAc9aba94D1C48a5405',
        punks:   '0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB',
        normies: '0x7Bc1C072742D8391817EB4Eb2317F98dc72C61dB',
      };
      const contract = contracts[selectedCollection.id];

      const ownerRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'eth_call',
          params: [{ to: contract, data: selector + tokenIdHex }, 'latest'],
        }),
      });
      const ownerData = await ownerRes.json() as { result?: string };
      if (!ownerData.result || ownerData.result === '0x') {
        setError(`${selectedCollection.name} #${tokenId} not found`);
        return;
      }
      const actualOwner = ('0x' + ownerData.result.slice(26)).toLowerCase();
      if (actualOwner !== ownerWallet.toLowerCase()) {
        setError(`#${tokenId} is owned by ${actualOwner.slice(0, 8)}…, not your wallet`);
        return;
      }
      setOwnershipOk(true);
    } catch {
      setError('Could not verify ownership — check connection');
    } finally {
      setVerifying(false);
    }
  }

  async function handleExecute() {
    if (!selectedCollection) return;
    setStep('paying');
    setError(null);
    try {
      const provider = (window as any).ethereum;
      if (!provider) throw new Error('No wallet provider found');
      const walletClient = createWalletClient({ chain: gnosis, transport: custom(provider) });
      const [account] = await walletClient.requestAddresses();

      addLog('Sending 2 xDAI fee to treasury on Gnosis...');
      const txHash = await walletClient.sendTransaction({
        account,
        to: GNOSIS_TREASURY,
        value: MOLT_FEE,
        chain: gnosis,
      });

      setStep('molting');
      addLog(`Fee tx: ${txHash.slice(0, 18)}…`);
      addLog(`Verifying ${selectedCollection.name} #${tokenId} ownership...`);
      addLog('Minting beacon NFT...');
      addLog('Registering alias...');

      const res = await fetch('/api/molt/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionId: selectedCollection.id,
          primaryName,
          tokenId,
          ownerWallet,
          paymentTxHash: txHash,
        }),
      });
      const data = await res.json() as any;
      if (!res.ok || data.status === 'error') {
        throw new Error(data.error ?? 'Molt failed');
      }

      addLog(`✓ ${selectedCollection.name} Molt Complete`);
      setResult(data as MoltResult);
      setStep('done');
    } catch (err: any) {
      setError(err?.shortMessage ?? err?.message ?? 'Molt failed');
      setStep('error');
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(124,77,255,0.12),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(176,128,92,0.1),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-10 md:px-6">

        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎭</span>
            <div className="text-xs font-semibold tracking-[0.18em] text-violet-300">COLLECTION MOLT</div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/byo-molt" className="rounded-full border border-[var(--border)] bg-black/20 px-3.3 py-1.5 text-[11px] text-[var(--muted)] transition hover:text-white">
              Chonk Classic
            </Link>
            <Link href="/molt" className="rounded-full border border-[var(--border)] bg-black/20 px-3 py-1.5 text-[11px] text-[var(--muted)] transition hover:text-white">
              Identity Molt
            </Link>
            <Link href="/dashboard" className="rounded-full border border-[var(--border)] bg-black/20 px-3 py-1.5 text-[11px] text-[var(--muted)] transition hover:text-white">
              Dashboard
            </Link>
          </div>
        </header>

        {/* Hero */}
        <section className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-white">NFT Collection Molt</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
            Overlay your NFT identity on your GhostAgent email. Primary email preserved. Alias created. Beacon NFT minted. 2 xDAI fee.
          </p>
        </section>

        {/* Step: Select Collection */}
        {(step === 'select' || step === 'details') && !selectedCollection && (
          <div className="space-y-3">
            <div className="text-[10px] font-semibold tracking-[0.15em] text-[var(--muted)]">SELECT COLLECTION</div>
            <div className="grid grid-cols-2 gap-3">
              {COLLECTIONS.map((col) => (
                <button
                  key={col.id}
                  onClick={() => { setSelectedCollection(col); setStep('details'); setOwnershipOk(false); setError(null); }}
                  className={`rounded-2xl border ${col.accentBorder} ${col.accentBg} p-4 text-left transition hover:scale-[1.02] hover:shadow-lg`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">{col.icon}</span>
                    <div>
                      <div className={`text-sm font-bold ${col.accentText}`}>{col.name}</div>
                      <div className="text-[9px] text-[var(--muted)]">{col.chain}</div>
                    </div>
                  </div>
                  <p className="text-[10px] text-[var(--muted)] mb-2">{col.description}</p>
                  <div className={`font-mono text-[9px] ${col.accentText} opacity-70`}>{col.aliasExample}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step: Enter Details */}
        {step === 'details' && selectedCollection && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">{selectedCollection.icon}</span>
                <div className={`text-sm font-bold ${selectedCollection.accentText}`}>{selectedCollection.name} Molt</div>
              </div>
              <button
                onClick={() => { setSelectedCollection(null); setOwnershipOk(false); setError(null); }}
                className="text-[11px] text-[var(--muted)] hover:text-white"
              >
                ← Change
              </button>
            </div>

            {/* What happens */}
            <div className={`rounded-xl border ${selectedCollection.accentBorder} bg-black/20 px-4 py-3 space-y-1 text-[11px] text-[var(--muted)]`}>
              <div className="text-xs font-semibold text-white mb-1">What happens</div>
              <div>✓ Primary email <span className="font-mono text-white">{primaryName ? `${primaryName}_@nftmail.box` : 'agent_@nftmail.box'}</span> preserved</div>
              <div>✓ Alias <span className={`font-mono ${selectedCollection.accentText}`}>{selectedCollection.id.toUpperCase()}_{tokenId || '?'}_@nftmail.box</span> created</div>
              <div>✓ Beacon NFT <span className="font-mono text-sky-300">{selectedCollection.id}.{tokenId || '?'}.nftmail.gno</span> minted</div>
              <div>✓ Zero lock-in — reverse molt restores original identity</div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-1">YOUR AGENT NAME (no underscore)</label>
                <input
                  className="w-full rounded-xl border border-[var(--border)] bg-black/40 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-violet-500/40"
                  placeholder="e.g. ghostagent"
                  value={primaryName}
                  onChange={e => { setPrimaryName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setOwnershipOk(false); }}
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-1">{selectedCollection.name.toUpperCase()} TOKEN ID</label>
                <input
                  className="w-full rounded-xl border border-[var(--border)] bg-black/40 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-violet-500/40"
                  placeholder="e.g. 1234"
                  value={tokenId}
                  onChange={e => { setTokenId(e.target.value.replace(/[^0-9]/g, '')); setOwnershipOk(false); }}
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-1">OWNER WALLET (must hold NFT)</label>
                <input
                  className="w-full rounded-xl border border-[var(--border)] bg-black/40 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-violet-500/40"
                  placeholder="0x…"
                  value={ownerWallet}
                  onChange={e => { setOwnerWallet(e.target.value); setOwnershipOk(false); }}
                />
              </div>
            </div>

            {error && <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-400">{error}</div>}

            {ownershipOk ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 flex items-center justify-between">
                  <span className="text-xs text-emerald-400">✓ Ownership verified</span>
                  <span className="text-xs text-[var(--muted)]">Fee: <strong className="text-amber-300">2 xDAI</strong> on Gnosis</span>
                </div>
                <button
                  onClick={handleExecute}
                  className={`w-full rounded-xl bg-gradient-to-r ${selectedCollection.accentFrom} ${selectedCollection.accentTo} py-3 text-sm font-bold text-white transition hover:opacity-90`}
                >
                  Pay 2 xDAI & Execute {selectedCollection.name} Molt
                </button>
              </div>
            ) : (
              <button
                onClick={handleVerifyOwnership}
                disabled={!primaryName || !tokenId || !ownerWallet || verifying}
                className={`w-full rounded-xl bg-gradient-to-r ${selectedCollection.accentFrom} ${selectedCollection.accentTo} py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-40`}
              >
                {verifying ? 'Verifying ownership...' : `Verify ${selectedCollection.name} #${tokenId || '?'} Ownership →`}
              </button>
            )}
          </div>
        )}

        {/* Step: Paying */}
        {step === 'paying' && selectedCollection && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 flex flex-col items-center gap-4">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-amber-500/20 border-t-amber-400" />
            <div className="text-sm font-medium text-amber-200">Awaiting payment signature...</div>
            <div className="text-[10px] text-[var(--muted)]">Sign the 2 xDAI transaction in your wallet on Gnosis</div>
          </div>
        )}

        {/* Step: Molting */}
        {step === 'molting' && selectedCollection && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 space-y-4">
            <div className="flex flex-col items-center gap-2 pb-2">
              <span className="text-3xl animate-pulse">{selectedCollection.icon}</span>
              <div className="text-sm font-semibold text-white">Executing {selectedCollection.name} Molt...</div>
            </div>
            <div className="space-y-1">
              {logs.map((log, i) => (
                <div key={i} className="font-mono text-[10px] text-[var(--muted)]">{log}</div>
              ))}
            </div>
          </div>
        )}

        {/* Step: Done */}
        {step === 'done' && result && selectedCollection && (
          <div className="rounded-2xl border border-emerald-500/20 bg-[var(--card)] p-6 space-y-4">
            <div className="flex flex-col items-center gap-2">
              <span className="text-4xl">🦋</span>
              <div className="text-xl font-bold text-white">{selectedCollection.name} Molt Complete</div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-black/30 p-4 space-y-2">
              {[
                { label: 'Primary email', value: result.primaryEmail },
                { label: 'New alias', value: result.aliasEmail },
                { label: 'Beacon NFT', value: result.beaconNft },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between text-xs">
                  <span className="text-[var(--muted)]">{label}</span>
                  <span className="font-mono text-white">{value}</span>
                </div>
              ))}
              <div className="flex justify-between text-xs">
                <span className="text-[var(--muted)]">Beacon tx</span>
                <a
                  href={`https://gnosisscan.io/tx/${result.beaconTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-sky-400 hover:underline"
                >
                  {result.beaconTxHash.slice(0, 18)}…
                </a>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setStep('select'); setSelectedCollection(null); setResult(null); setOwnershipOk(false); setPrimaryName(''); setTokenId(''); setLogs([]); }}
                className="flex-1 rounded-xl border border-[var(--border)] bg-black/20 px-4 py-2.5 text-sm text-[var(--muted)] transition hover:text-white"
              >
                Molt another
              </button>
              <Link
                href="/dashboard"
                className="flex-1 rounded-xl bg-emerald-500/15 px-4 py-2.5 text-center text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
              >
                Dashboard →
              </Link>
            </div>
          </div>
        )}

        {/* Step: Error */}
        {step === 'error' && (
          <div className="rounded-2xl border border-red-500/20 bg-[var(--card)] p-5 space-y-3">
            <div className="text-sm font-semibold text-red-400">Molt failed</div>
            <div className="text-xs text-red-300/80">{error}</div>
            {logs.length > 0 && (
              <div className="space-y-1">
                {logs.map((log, i) => (
                  <div key={i} className="font-mono text-[10px] text-[var(--muted)]">{log}</div>
                ))}
              </div>
            )}
            <button
              onClick={() => { setStep('details'); setError(null); }}
              className="w-full rounded-xl border border-[var(--border)] bg-black/20 px-4 py-2.5 text-sm text-[var(--muted)] transition hover:text-white"
            >
              ← Try again
            </button>
          </div>
        )}

        {/* Info strip */}
        <div className="rounded-xl border border-[var(--border)] bg-black/20 px-5 py-3">
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-[10px] text-[var(--muted)]">
            <span>✓ Primary email unchanged</span>
            <span>✓ Alias routes to same inbox</span>
            <span>✓ Beacon NFT on Gnosis</span>
            <span>✓ Zero lock-in</span>
            <span>✓ 2 xDAI fee</span>
          </div>
        </div>

        <footer className="text-center text-[10px] text-[var(--muted)]">
          Approved collections: Chonk · POWNFT · CryptoPunks · Normies
        </footer>
      </div>
    </div>
  );
}
