'use client';

/**
 * HITLDeployPanel
 *
 * Checks if a Gnosis Safe already has a HumanInTheLoopModule deployed via
 * the HITLModuleFactory. If not, lets the agent owner deploy one in one tx.
 *
 * After deployment it shows the "Add Module" deeplink to Safe UI.
 *
 * Factory address: NEXT_PUBLIC_HITL_FACTORY_ADDRESS env var
 * (falls back to the ghostagent reference deployment)
 */

import { useState, useEffect, useCallback } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { createPublicClient, http, parseAbi, parseEther, formatEther, encodeAbiParameters, parseAbiParameters } from 'viem';
import { gnosis } from 'viem/chains';

const FACTORY_ADDRESS = (
  process.env.NEXT_PUBLIC_HITL_FACTORY_ADDRESS ?? ''
) as `0x${string}`;

const FACTORY_ABI = parseAbi([
  'function getModule(address safeAddress) view returns (address)',
  'function totalModules() view returns (uint256)',
  'function createModule(address safeAddress, uint256 thresholdWei, uint256 approvalTtlSecs) returns (address module)',
  'event ModuleDeployed(address indexed safe, address indexed module, uint256 threshold, uint256 approvalTtl, address deployedBy)',
]);

const publicClient = createPublicClient({
  chain: gnosis,
  transport: http('https://rpc.gnosischain.com'),
});

const THRESHOLD_PRESETS = [
  { label: '0.1 xDAI', value: '0.1' },
  { label: '0.5 xDAI', value: '0.5' },
  { label: '1 xDAI',   value: '1'   },
  { label: '5 xDAI',   value: '5'   },
  { label: '10 xDAI',  value: '10'  },
];

const TTL_PRESETS = [
  { label: '1 hour',  value: 3600    },
  { label: '6 hours', value: 21600   },
  { label: '24 hours',value: 86400   },
  { label: '48 hours',value: 172800  },
];

interface Props {
  safeAddress: string;
}

export default function HITLDeployPanel({ safeAddress }: Props) {
  const { wallets } = useWallets();
  const connectedWallet = wallets[0]?.address ?? null;

  const [existingModule, setExistingModule] = useState<string | null>(null);
  const [totalModules, setTotalModules]     = useState<number>(0);
  const [checking, setChecking]             = useState(true);
  const [checkError, setCheckError]         = useState<string | null>(null);

  const [thresholdXdai, setThresholdXdai]   = useState('1');
  const [customThreshold, setCustomThreshold] = useState('');
  const [ttlSecs, setTtlSecs]               = useState(86400);

  const [deploying, setDeploying]           = useState(false);
  const [deployedAt, setDeployedAt]         = useState<string | null>(null);
  const [deployTx, setDeployTx]             = useState<string | null>(null);
  const [deployError, setDeployError]       = useState<string | null>(null);

  const factoryReady = FACTORY_ADDRESS.startsWith('0x') && FACTORY_ADDRESS.length === 42;

  const checkExisting = useCallback(async () => {
    if (!factoryReady || !safeAddress) return;
    setChecking(true);
    setCheckError(null);
    try {
      const [mod, total] = await Promise.all([
        publicClient.readContract({
          address: FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: 'getModule',
          args: [safeAddress as `0x${string}`],
        }),
        publicClient.readContract({
          address: FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: 'totalModules',
        }),
      ]);
      setExistingModule(mod === '0x0000000000000000000000000000000000000000' ? null : mod);
      setTotalModules(Number(total));
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : 'RPC error');
    } finally {
      setChecking(false);
    }
  }, [factoryReady, safeAddress]);

  useEffect(() => { checkExisting(); }, [checkExisting]);

  async function handleDeploy() {
    if (!connectedWallet || !factoryReady) return;
    setDeploying(true);
    setDeployError(null);
    setDeployedAt(null);
    setDeployTx(null);

    try {
      const threshStr = customThreshold || thresholdXdai;
      const threshWei = parseEther(threshStr);

      const calldata = encodeAbiParameters(
        parseAbiParameters('address safeAddress, uint256 thresholdWei, uint256 approvalTtlSecs'),
        [safeAddress as `0x${string}`, threshWei, BigInt(ttlSecs)]
      );
      const selector = '0x...'; // createModule(address,uint256,uint256)
      // selector for createModule(address,uint256,uint256) = 0x3b5e2f0e
      const data = ('0x3b5e2f0e' + calldata.slice(2)) as `0x${string}`;

      const wallet = wallets[0];
      const provider = await wallet.getEthereumProvider();

      const txHash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          from:  connectedWallet,
          to:    FACTORY_ADDRESS,
          data,
          value: '0x0',
        }],
      }) as string;

      setDeployTx(txHash);

      // Poll for receipt to get the deployed module address from logs
      let receipt = null;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
          if (receipt) break;
        } catch { /* still pending */ }
      }

      if (receipt) {
        // Re-read factory to get module address
        await checkExisting();
        const mod = await publicClient.readContract({
          address: FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: 'getModule',
          args: [safeAddress as `0x${string}`],
        });
        if (mod && mod !== '0x0000000000000000000000000000000000000000') {
          setDeployedAt(mod);
          setExistingModule(mod);
        }
      }
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : 'Transaction rejected');
    } finally {
      setDeploying(false);
    }
  }

  const safeModulesUrl = `https://app.safe.global/settings/modules?safe=gno:${safeAddress}`;
  const effectiveThreshold = customThreshold || thresholdXdai;

  if (!factoryReady) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-2">
        <div className="text-xs font-semibold text-amber-300">Factory not yet deployed</div>
        <p className="text-[11px] text-[var(--muted)] leading-relaxed">
          The HITLModuleFactory needs to be deployed to Gnosis mainnet first.
          Run the Foundry deploy script, then set{' '}
          <code className="text-amber-300">NEXT_PUBLIC_HITL_FACTORY_ADDRESS</code> in env vars.
        </p>
        <div className="rounded-lg bg-black/40 px-3 py-2 font-mono text-[10px] text-zinc-400">
          forge script script/DeployHITLFactory.s.sol \<br />
          &nbsp;&nbsp;--rpc-url https://rpc.gnosischain.com \<br />
          &nbsp;&nbsp;--broadcast --verify --verifier sourcify \<br />
          &nbsp;&nbsp;--private-key $DEPLOYER_PK
        </div>
      </div>
    );
  }

  if (checking) {
    return (
      <div className="rounded-xl border border-zinc-700/30 bg-zinc-800/10 p-4 text-center text-[11px] text-zinc-500 animate-pulse">
        Checking factory registry…
      </div>
    );
  }

  if (checkError) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-xs text-red-300 space-y-2">
        <div>Factory read error: {checkError}</div>
        <button onClick={checkExisting} className="underline hover:text-white text-[11px]">retry</button>
      </div>
    );
  }

  // Already has a module
  if (existingModule) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 text-base">✓</span>
            <span className="text-sm font-semibold text-emerald-300">HITL Module deployed</span>
          </div>
          <div className="space-y-1 text-[11px]">
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Module address</span>
              <a
                href={`https://gnosisscan.io/address/${existingModule}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[#b0805c] hover:underline"
              >
                {existingModule.slice(0, 10)}…{existingModule.slice(-6)} ↗
              </a>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Factory total deployments</span>
              <span className="text-zinc-300">{totalModules}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-2">
          <div className="text-xs font-semibold text-violet-300">Next: enable on Safe</div>
          <p className="text-[11px] text-[var(--muted)]">
            The module is deployed but must be added to the Safe before it can gate transactions.
          </p>
          <div className="rounded-lg bg-black/30 px-3 py-1.5 font-mono text-[10px] text-zinc-400 break-all">
            {existingModule}
          </div>
          <a
            href={safeModulesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-[11px] text-violet-300 hover:bg-violet-500/10 transition"
          >
            <span>Open Safe → Settings → Modules ↗</span>
            <span className="text-[9px] text-zinc-500">Add Module → paste address</span>
          </a>
        </div>

        <button
          onClick={checkExisting}
          className="text-[10px] text-zinc-600 hover:text-zinc-400 transition"
        >
          ↻ Refresh
        </button>
      </div>
    );
  }

  // No module yet — show deploy form
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-[rgba(176,128,92,0.04)] p-4 space-y-1">
        <div className="text-xs font-semibold text-[#b0805c]">No HITL module found for this Safe</div>
        <p className="text-[11px] text-[var(--muted)]">
          Deploy one now. Takes ~10 seconds and costs a few cents in gas.
          {totalModules > 0 && (
            <span className="ml-1 text-zinc-500">({totalModules} other agent{totalModules !== 1 ? 's' : ''} already deployed via this factory)</span>
          )}
        </p>
      </div>

      {/* Threshold picker */}
      <div className="space-y-2">
        <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">APPROVAL THRESHOLD</div>
        <div className="flex gap-2 flex-wrap">
          {THRESHOLD_PRESETS.map(p => (
            <button
              key={p.value}
              onClick={() => { setThresholdXdai(p.value); setCustomThreshold(''); }}
              className={`rounded-lg border px-3 py-1.5 text-[11px] font-medium transition ${
                thresholdXdai === p.value && !customThreshold
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                  : 'border-zinc-700/40 bg-zinc-800/20 text-zinc-400 hover:border-amber-500/30 hover:text-amber-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            placeholder="Custom amount in xDAI…"
            value={customThreshold}
            onChange={e => setCustomThreshold(e.target.value)}
            className="flex-1 rounded-lg border border-zinc-700/40 bg-zinc-800/30 px-3 py-1.5 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/40"
          />
          <span className="text-[10px] text-zinc-500">xDAI</span>
        </div>
        <p className="text-[10px] text-zinc-600">
          Transactions ≤ <span className="text-amber-300">{effectiveThreshold} xDAI</span> execute immediately.
          Above this → queued for Safe approval.
        </p>
      </div>

      {/* TTL picker */}
      <div className="space-y-2">
        <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">APPROVAL WINDOW (TTL)</div>
        <div className="flex gap-2 flex-wrap">
          {TTL_PRESETS.map(p => (
            <button
              key={p.value}
              onClick={() => setTtlSecs(p.value)}
              className={`rounded-lg border px-3 py-1.5 text-[11px] font-medium transition ${
                ttlSecs === p.value
                  ? 'border-violet-500/40 bg-violet-500/15 text-violet-200'
                  : 'border-zinc-700/40 bg-zinc-800/20 text-zinc-400 hover:border-violet-500/30 hover:text-violet-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-zinc-600">
          Queued txs expire after <span className="text-violet-300">{ttlSecs / 3600}h</span> if not approved.
        </p>
      </div>

      {/* Summary */}
      <div className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-3 space-y-1 text-[11px]">
        <div className="flex justify-between">
          <span className="text-zinc-500">Safe</span>
          <span className="font-mono text-zinc-300">{safeAddress.slice(0, 10)}…{safeAddress.slice(-6)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Threshold</span>
          <span className="text-amber-300">{effectiveThreshold} xDAI ({formatEther(parseEther(effectiveThreshold || '0'))} wei)</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Approval TTL</span>
          <span className="text-violet-300">{ttlSecs / 3600}h</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Factory</span>
          <a
            href={`https://gnosisscan.io/address/${FACTORY_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[#b0805c] hover:underline text-[10px]"
          >
            {FACTORY_ADDRESS.slice(0, 10)}…{FACTORY_ADDRESS.slice(-6)} ↗
          </a>
        </div>
      </div>

      <button
        onClick={handleDeploy}
        disabled={deploying || !connectedWallet}
        className="w-full rounded-xl border border-[rgba(176,128,92,0.4)] bg-[rgba(176,128,92,0.1)] px-4 py-3 text-sm font-semibold text-[#f2eee4] transition hover:bg-[rgba(176,128,92,0.2)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {deploying
          ? 'Deploying…'
          : !connectedWallet
            ? 'Connect wallet to deploy'
            : '🚀 Deploy HITL Module for this Safe'}
      </button>

      {deployTx && !deployedAt && (
        <div className="text-[11px] text-center space-y-1">
          <a
            href={`https://gnosisscan.io/tx/${deployTx}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-400 hover:underline"
          >
            ✓ Tx submitted — waiting for confirmation… ↗
          </a>
        </div>
      )}

      {deployedAt && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
          <div className="text-sm font-semibold text-emerald-300">🎉 Module deployed!</div>
          <div className="font-mono text-[10px] text-zinc-300 break-all">{deployedAt}</div>
          <a
            href={safeModulesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-300 hover:bg-emerald-500/10 transition"
          >
            <span>Now: Open Safe → Add Module ↗</span>
            <span className="text-[9px] text-zinc-500">one more step</span>
          </a>
        </div>
      )}

      {deployError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-300">
          {deployError}
        </div>
      )}
    </div>
  );
}
