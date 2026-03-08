'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePrivy, useWallets } from '@privy-io/react-auth';

// ─── Bonding curve math ───────────────────────────────────────────────────────
const BASE_PRICE = 0.000001;
const SLOPE = 0.000000000002;
const TOTAL_SUPPLY_CAP = 1_000_000_000;
const LAUNCH_SUPPLY = 1_000;

function curvePrice(supply: number) { return BASE_PRICE + SLOPE * supply; }
function buyCost(s0: number, amt: number) {
  const s1 = s0 + amt;
  return BASE_PRICE * amt + SLOPE * (s1 * s1 - s0 * s0) / 2;
}
function sellProceeds(s0: number, amt: number) {
  const sb = s0 - amt;
  return BASE_PRICE * amt + SLOPE * (s0 * s0 - sb * sb) / 2;
}
function ethReserve(supply: number) {
  return BASE_PRICE * supply + SLOPE * supply * supply / 2;
}
function fmtEth(v: number) {
  if (v >= 1) return v.toFixed(4) + ' ETH';
  if (v >= 0.001) return (v * 1000).toFixed(3) + ' mETH';
  return (v * 1e6).toFixed(2) + ' μETH';
}
function fmtH(v: number) {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
  return v.toFixed(0);
}

// ─── Staking tiers ────────────────────────────────────────────────────────────
const STAKE_TIERS = [
  { label: 'None',   minStake: 0,       score: '+0',   boost: 'No boost',                               color: 'text-[var(--muted)]',  border: 'border-white/10' },
  { label: 'Scout',  minStake: 1_000,   score: '+5',   boost: 'Marketplace priority listing',           color: 'text-amber-300',       border: 'border-amber-500/30' },
  { label: 'Agent',  minStake: 10_000,  score: '+20',  boost: 'Pro tier access + IP registry',          color: 'text-violet-300',      border: 'border-violet-500/30' },
  { label: 'Ghost',  minStake: 50_000,  score: '+60',  boost: 'Full Ghost tier + reduced fees',         color: 'text-fuchsia-300',     border: 'border-fuchsia-500/30' },
  { label: 'Wraith', minStake: 200_000, score: '+100', boost: 'Governance votes + whitelist namespaces', color: 'text-cyan-300',       border: 'border-cyan-500/30' },
];

const UTILITY_ITEMS = [
  { icon: '⚗️', title: 'Mint Agent Body',    desc: 'Burn 500 HOST → waive the xDAI mint fee on any .gno namespace.' },
  { icon: '🧠', title: 'Install Brain',       desc: 'Staked HOST unlocks pro brain types (Safe Module, multi-chain execution).' },
  { icon: '📋', title: 'Marketplace Listing', desc: 'Stake 1K HOST to list. Higher stake = higher search rank.' },
  { icon: '🔥', title: 'Buyback & Burn',      desc: '5% of all marketplace employment fees buy + burn HOST from the SURGE curve.' },
  { icon: '🗳️', title: 'Governance',          desc: '200K staked HOST = governance proposal rights: new namespaces, fee params, treasury.' },
  { icon: '🌐', title: 'IP Revenue Share',    desc: 'Story Protocol royalties distributed to HOST stakers pro-rata.' },
];

// ─── Mini curve SVG ───────────────────────────────────────────────────────────
function MiniCurve({ currentSupply }: { currentSupply: number }) {
  const W = 340, H = 110;
  const pts = Array.from({ length: 61 }, (_, i) => ({
    supply: (i / 60) * TOTAL_SUPPLY_CAP,
    price: curvePrice((i / 60) * TOTAL_SUPPLY_CAP),
  }));
  const maxP = curvePrice(TOTAL_SUPPLY_CAP);
  const tx = (s: number) => (s / TOTAL_SUPPLY_CAP) * W;
  const ty = (p: number) => H - (p / maxP) * H;
  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${tx(p.supply).toFixed(1)},${ty(p.price).toFixed(1)}`).join(' ');
  const fillD = pathD + ` L${W},${H} L0,${H} Z`;
  const cx = tx(currentSupply), cy = ty(curvePrice(currentSupply));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 110 }}>
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#b0805c" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#b0805c" stopOpacity="0.03" />
        </linearGradient>
      </defs>
      <path d={fillD} fill="url(#cg)" />
      <path d={pathD} fill="none" stroke="#b0805c" strokeWidth="1.5" />
      <line x1={cx} y1={0} x2={cx} y2={H} stroke="rgba(176,128,92,0.4)" strokeWidth="1" strokeDasharray="3,3" />
      <circle cx={cx} cy={cy} r="4" fill="#b0805c" />
    </svg>
  );
}

// ─── SURGE Agent Launch flow ──────────────────────────────────────────────────
type LaunchStep = 'idle' | 'step-info' | 'step-wallet' | 'step-fund' | 'step-launch' | 'done' | 'error';

interface StepLog {
  step: string;
  status: 'pending' | 'running' | 'ok' | 'error';
  request?: Record<string, any>;
  response?: Record<string, any>;
  error?: string;
}

const HOST_LOGO = 'https://gateway.lighthouse.storage/ipfs/bafkreidjzydt46azr2ib5hcx2mfp4cvmgpiclpxqygief7kspaed6qyuzy';

function AgentLaunchPanel() {
  const { authenticated, login } = usePrivy();
  const [launchStep, setLaunchStep] = useState<LaunchStep>('idle');
  const [apiKey, setApiKey] = useState('');
  const [chainInfo, setChainInfo] = useState<any>(null);
  const [walletData, setWalletData] = useState<any>(null);
  const [fundData, setFundData] = useState<any>(null);
  const [launchResult, setLaunchResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<StepLog[]>([]);
  const [activeLog, setActiveLog] = useState<number | null>(null);

  const [form, setForm] = useState({
    name: '$HOST',
    ticker: 'HOST',
    description: 'GhostAgent.ninja utility token. Stake to boost agent tier. Burn to mint. Earn from marketplace fees. Launched by a GhostAgent via A2A email instruction.',
    ethAmount: '0.001',
    category: 'ai',
    websiteLink: 'https://ghostagent.ninja',
    xLink: 'https://x.com/ghostagent_ninja',
    githubLink: 'https://github.com/SURGE-xyz/skills',
  });

  function addLog(log: StepLog) {
    setLogs(prev => [...prev, log]);
    setActiveLog(null);
  }
  function updateLastLog(patch: Partial<StepLog>) {
    setLogs(prev => prev.map((l, i) => i === prev.length - 1 ? { ...l, ...patch } : l));
  }

  async function callSurge(action: string, extra: Record<string, any> = {}): Promise<any> {
    const res = await fetch('/api/surge/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, apiKey, ...extra }),
    });
    const data = await res.json() as any;
    if (!res.ok) throw new Error(data?.error || `${action} failed (${res.status})`);
    return data;
  }

  async function runFullLaunch() {
    if (!authenticated) { login(); return; }
    setError('');
    setLogs([]);
    setLaunchStep('step-info');

    try {
      // ── Step 1: launch-info ──
      addLog({ step: 'GET /openclaw/launch-info', status: 'running', request: { 'X-API-Key': 'sk-surge-••••' } });
      const info = await callSurge('launch-info');
      updateLastLog({ status: 'ok', response: info });
      setChainInfo(info);

      // SURGE uses internal chainId (e.g. "1" for Base). Match by networkId or chainName.
      const baseChain = info.chains?.find((c: any) => c.networkId === '8453' || c.networkId === 8453)
        ?? info.chains?.find((c: any) => c.chainName === 'Base')
        ?? info.chains?.[0];
      const resolvedChainId = String(baseChain?.chainId ?? '1');

      // ── Step 2: create wallet ──
      setLaunchStep('step-wallet');
      addLog({ step: 'POST /openclaw/wallet/create', status: 'running', request: { 'X-API-Key': 'sk-surge-••••' } });
      const wallet = await callSurge('create-wallet');
      updateLastLog({ status: 'ok', response: wallet });
      setWalletData(wallet);

      // ── Step 3: fund wallet ──
      setLaunchStep('step-fund');
      addLog({ step: `POST /openclaw/wallet/${wallet.walletId}/fund`, status: 'running', request: { walletId: wallet.walletId } });
      const fund = await callSurge('fund-wallet', { walletId: wallet.walletId });
      updateLastLog({ status: 'ok', response: fund });
      setFundData(fund);

      // Check balance — free funding only covers gas; use minBalance as floor for ethAmount
      const bal = await callSurge('check-balance', { walletId: wallet.walletId });
      const baseBalance = bal.balances?.find((b: any) => b.chainId === '8453' || b.chain === 'Base');
      const minBalance = parseFloat(baseChain?.minBalance ?? '0.001');
      const walletEth = parseFloat(baseBalance?.balance ?? '0');
      // Use min of requested amount and what the wallet can afford (keeping some for gas)
      const requestedEth = parseFloat(form.ethAmount) || 0.001;
      const totalNeeded = minBalance + requestedEth;
      if (walletEth < totalNeeded) {
        throw new Error(
          `Wallet needs ${(totalNeeded - walletEth).toFixed(6)} more ETH on Base.\n` +
          `Fund: ${wallet.address}\n` +
          `Have: ${walletEth.toFixed(6)} ETH · Need: ${totalNeeded.toFixed(6)} ETH (gas + buy)`
        );
      }
      const safeEthAmount = String(requestedEth);

      // ── Step 4: launch — call SURGE directly from browser to avoid Netlify 30s timeout ──
      setLaunchStep('step-launch');
      const launchPayload = {
        walletId: wallet.walletId,
        name: form.name,
        ticker: form.ticker,
        description: form.description,
        logoUrl: HOST_LOGO,
        chainId: resolvedChainId,
        ethAmount: safeEthAmount,
        category: form.category,
        websiteLink: form.websiteLink,
        xLink: form.xLink,
        githubLink: form.githubLink,
      };
      addLog({
        step: 'POST /openclaw/launch',
        status: 'running',
        request: { ...launchPayload, 'X-API-Key': 'sk-surge-••••' },
      });
      const launch = await callSurge('launch', launchPayload);
      updateLastLog({ status: 'ok', response: launch });
      setLaunchResult(launch);
      setLaunchStep('done');

    } catch (err: any) {
      setError(err?.message || 'Launch failed');
      updateLastLog({ status: 'error', error: err?.message });
      setLaunchStep('error');
    }
  }

  const FLOW_STEPS = [
    { key: 'step-info',   label: 'Fetch chain config',    endpoint: 'GET /openclaw/launch-info' },
    { key: 'step-wallet', label: 'Create server wallet',  endpoint: 'POST /openclaw/wallet/create' },
    { key: 'step-fund',   label: 'Fund wallet (free)',    endpoint: 'POST /openclaw/wallet/{id}/fund' },
    { key: 'step-launch', label: 'Launch token on Base',  endpoint: 'POST /openclaw/launch' },
  ];

  const currentFlowIdx = FLOW_STEPS.findIndex(s => s.key === launchStep);

  if (launchStep === 'idle') {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-[rgba(176,128,92,0.25)] p-4 text-xs leading-relaxed" style={{ background: '#0f0703' }}>
          <p className="font-semibold mb-2" style={{ color: '#f2eee5' }}>How the agent flow works</p>
          <div className="space-y-1.5 text-[var(--muted)]">
            {[
              ['1', 'Email', 'launch $HOST token on Base', ' to ghostagent_@nftmail.box'],
              ['2', 'Agent brain', 'polls inbox every 5 min', ' via Cloudflare Worker cron'],
              ['3', 'Agent calls', 'SURGE Skills API', ': wallet → fund → launch'],
              ['4', 'Token deploys', 'on Base bonding curve', ', agent replies with Basescan link'],
              ['5', 'Agent posts', 'launch announcement to Moltbook + Farcaster', ''],
            ].map(([n, a, b, c]) => (
              <div key={n} className="flex gap-2">
                <span className="shrink-0 h-4 w-4 rounded-full text-center text-[10px] font-bold" style={{ background: 'rgba(176,128,92,0.2)', color: '#b0805c', lineHeight: '16px' }}>{n}</span>
                <span><span style={{ color: '#f2eee5' }}>{a}</span>{' '}<span style={{ color: '#b0805c' }}>{b}</span>{c}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">TOKEN PARAMETERS</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { key: 'name', label: 'NAME' },
              { key: 'ticker', label: 'TICKER' },
            ].map(f => (
              <div key={f.key} className="space-y-1">
                <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">{f.label}</label>
                <input
                  value={(form as any)[f.key]}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/30 px-3 py-2 text-xs outline-none focus:border-[rgba(176,128,92,0.5)]"
                  style={{ color: '#f2eee5' }}
                />
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">DESCRIPTION</label>
            <textarea
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              rows={2}
              className="w-full rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/30 px-3 py-2 text-xs outline-none resize-none focus:border-[rgba(176,128,92,0.5)]"
              style={{ color: '#f2eee5' }}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">INITIAL BUY (ETH)</label>
              <input
                type="number"
                value={form.ethAmount}
                onChange={e => setForm(p => ({ ...p, ethAmount: e.target.value }))}
                className="w-full rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/30 px-3 py-2 text-xs outline-none"
                style={{ color: '#f2eee5' }}
              />
              <p className="text-[10px] text-[var(--muted)]">Set to <code>0</code> to launch with no initial buy (free SURGE wallet covers gas only).</p>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">CATEGORY</label>
              <select
                value={form.category}
                onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                className="w-full rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/30 px-3 py-2 text-xs outline-none"
                style={{ color: '#f2eee5' }}
              >
                {['ai','infrastructure','meme','rwa','defi','privacy','robotics','depin','socialfi'].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">SURGE API KEY</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-surge-… (from app.surge.xyz → Profile → API Keys)"
            className="w-full rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/30 px-3 py-2 text-xs outline-none focus:border-[rgba(176,128,92,0.5)]"
            style={{ color: '#f2eee5', borderColor: 'rgba(176,128,92,0.2)' }}
          />
          <p className="text-[10px] text-[var(--muted)]">
            No key yet?{' '}
            <a href="https://app.surge.xyz" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: '#b0805c' }}>
              app.surge.xyz → Profile → API Keys
            </a>
            {' '}— or add <code className="text-[10px]">SURGE_API_KEY</code> to Netlify env vars to skip this field.
          </p>
        </div>

        <button
          onClick={runFullLaunch}
          disabled={!form.name || !form.ticker}
          className="w-full rounded-xl border py-3 text-sm font-bold transition disabled:opacity-40"
          style={{ color: '#b0805c', borderColor: 'rgba(176,128,92,0.45)', background: 'rgba(176,128,92,0.12)' }}
        >
          {authenticated ? '⚡ Agent: Launch $HOST via SURGE' : 'Connect to Launch'}
        </button>
      </div>
    );
  }

  if (launchStep === 'done' && launchResult) {
    const tokenAddr = launchResult.tokenAddress || launchResult.contractAddress || '';
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 p-4 text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20">
            <svg className="h-5 w-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <p className="text-sm font-bold" style={{ color: '#f2eee5' }}>$HOST launched on Base 🎉</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{launchResult.summary}</p>
        </div>
        <div className="space-y-2 text-xs">
          {tokenAddr && (
            <a href={`https://app.surge.xyz/trade/${tokenAddr}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-between rounded-xl border p-3 transition hover:border-[rgba(176,128,92,0.4)]"
              style={{ borderColor: 'var(--border)' }}
            >
              <span style={{ color: '#f2eee5' }}>View on SURGE ↗</span>
              <span className="text-[var(--muted)] truncate ml-2">{tokenAddr.slice(0, 14)}…</span>
            </a>
          )}
          {launchResult.explorerUrl && (
            <a href={launchResult.explorerUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-between rounded-xl border p-3 transition hover:border-[rgba(0,163,255,0.3)]"
              style={{ borderColor: 'var(--border)' }}
            >
              <span style={{ color: 'rgb(160,220,255)' }}>Basescan tx ↗</span>
              <span className="text-[var(--muted)] truncate ml-2">{launchResult.txHash?.slice(0, 14)}…</span>
            </a>
          )}
        </div>
        <div className="rounded-xl p-3 text-xs text-[var(--muted)]" style={{ background: '#0f0703' }}>
          <span className="font-semibold" style={{ color: '#f2eee5' }}>What happens next: </span>
          The agent replies to the original email with the SURGE trade link, posts the launch to Moltbook + Farcaster, and begins routing 5% of marketplace fees to buy + burn HOST from the curve.
        </div>
        <button onClick={() => { setLaunchStep('idle'); setLogs([]); setLaunchResult(null); setWalletData(null); setFundData(null); setChainInfo(null); }}
          className="w-full rounded-xl border border-[rgba(176,128,92,0.2)] py-2 text-xs text-[var(--muted)] hover:text-white transition">
          Launch another token
        </button>
      </div>
    );
  }

  // ── In-progress / error state ──
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {FLOW_STEPS.map((s, i) => {
          const done = currentFlowIdx > i || launchStep === 'done';
          const active = currentFlowIdx === i && launchStep !== 'error' && launchStep !== 'done';
          const errored = launchStep === 'error' && currentFlowIdx === i;
          return (
            <div key={s.key} className="flex items-center gap-3 rounded-xl border px-4 py-3 text-xs"
              style={{ borderColor: done ? 'rgba(52,211,153,0.3)' : active ? 'rgba(176,128,92,0.4)' : 'var(--border)', background: active ? 'rgba(176,128,92,0.05)' : 'transparent' }}
            >
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                style={{ background: done ? 'rgba(52,211,153,0.2)' : active ? 'rgba(176,128,92,0.2)' : 'rgba(255,255,255,0.05)' }}
              >
                {done && <svg className="h-3 w-3 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                {active && <svg className="h-3 w-3 animate-spin" style={{ color: '#b0805c' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4" /></svg>}
                {errored && <span className="text-red-400 text-[10px]">✕</span>}
                {!done && !active && !errored && <span className="text-[10px] text-[var(--muted)]">{i + 1}</span>}
              </div>
              <div className="flex-1">
                <span style={{ color: done ? 'rgb(52,211,153)' : active ? '#b0805c' : 'var(--muted)' }}>{s.label}</span>
                <span className="ml-2 opacity-50 font-mono">{s.endpoint}</span>
              </div>
            </div>
          );
        })}
      </div>

      {logs.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">LIVE API CALLS</p>
          {logs.map((log, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border overflow-hidden text-xs cursor-pointer"
              style={{ borderColor: log.status === 'ok' ? 'rgba(52,211,153,0.25)' : log.status === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(176,128,92,0.3)' }}
              onClick={() => setActiveLog(activeLog === i ? null : i)}
            >
              <div className="flex items-center justify-between px-3 py-2"
                style={{ background: log.status === 'ok' ? 'rgba(52,211,153,0.05)' : log.status === 'error' ? 'rgba(239,68,68,0.05)' : 'rgba(176,128,92,0.07)' }}
              >
                <span className="font-mono" style={{ color: log.status === 'ok' ? 'rgb(52,211,153)' : log.status === 'error' ? 'rgb(239,68,68)' : '#b0805c' }}>
                  {log.status === 'running' ? '⟳ ' : log.status === 'ok' ? '✓ ' : '✕ '}{log.step}
                </span>
                <span className="text-[var(--muted)]">{activeLog === i ? '▲' : '▼'}</span>
              </div>
              <AnimatePresence>
                {activeLog === i && (
                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                    <div className="px-3 py-2 space-y-2 border-t border-[rgba(176,128,92,0.2)]" style={{ background: '#0f0703' }}>
                      {log.request && (
                        <div>
                          <p className="text-[10px] font-semibold text-[var(--muted)] mb-1">REQUEST</p>
                          <pre className="text-[10px] text-emerald-300 overflow-x-auto">{JSON.stringify(log.request, null, 2)}</pre>
                        </div>
                      )}
                      {log.response && (
                        <div>
                          <p className="text-[10px] font-semibold text-[var(--muted)] mb-1">RESPONSE</p>
                          <pre className="text-[10px] text-[rgb(160,220,255)] overflow-x-auto">{JSON.stringify(log.response, null, 2)}</pre>
                        </div>
                      )}
                      {log.error && <p className="text-[10px] text-red-400">{log.error}</p>}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      )}

      {launchStep === 'error' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-red-500/30 bg-red-500/8 px-4 py-3 text-xs text-red-400">{error}</div>
          <button onClick={() => { setLaunchStep('idle'); setLogs([]); }} className="w-full rounded-xl border border-[rgba(176,128,92,0.2)] py-2 text-xs text-[var(--muted)] hover:text-white transition">
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function HostTokenPage() {
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();

  const [supply, setSupply] = useState(LAUNCH_SUPPLY);
  const [buyAmt, setBuyAmt] = useState('10000');
  const [sellAmt, setSellAmt] = useState('5000');
  const [stakeAmt, setStakeAmt] = useState('10000');
  const [userBal, setUserBal] = useState(0);
  const [userStaked, setUserStaked] = useState(0);
  const [simLog, setSimLog] = useState<{ type: string; detail: string }[]>([]);
  const [tab, setTab] = useState<'buy' | 'sell' | 'stake'>('buy');
  const [simming, setSimming] = useState(false);
  const [pageTab, setPageTab] = useState<'launch' | 'sim'>('launch');

  const bq = Math.max(0, parseInt(buyAmt) || 0);
  const sq = Math.max(0, Math.min(userBal, parseInt(sellAmt) || 0));
  const stq = Math.max(0, Math.min(userBal - userStaked, parseInt(stakeAmt) || 0));
  const bCost = useMemo(() => buyCost(supply, bq), [supply, bq]);
  const sProc = useMemo(() => sellProceeds(supply, sq), [supply, sq]);

  const curTier = useMemo(() => [...STAKE_TIERS].reverse().find(t => userStaked >= t.minStake) ?? STAKE_TIERS[0], [userStaked]);
  const nxtTier = useMemo(() => STAKE_TIERS.find(t => t.minStake > userStaked), [userStaked]);

  function addSim(type: string, detail: string) {
    setSimLog(prev => [{ type, detail }, ...prev].slice(0, 8));
  }

  function simBuy() {
    if (!authenticated) { login(); return; }
    if (bq <= 0) return;
    setSimming(true);
    setTimeout(() => { setSupply(s => s + bq); setUserBal(b => b + bq); addSim('BUY', `+${fmtH(bq)} HOST for ${fmtEth(bCost)}`); setSimming(false); }, 500);
  }
  function simSell() {
    if (!authenticated) { login(); return; }
    if (sq <= 0) return;
    setSimming(true);
    setTimeout(() => { setSupply(s => s - sq); setUserBal(b => b - sq); addSim('SELL', `-${fmtH(sq)} HOST → ${fmtEth(sProc)}`); setSimming(false); }, 500);
  }
  function simStake() {
    if (!authenticated) { login(); return; }
    if (stq <= 0) return;
    setSimming(true);
    setTimeout(() => { setUserStaked(s => s + stq); addSim('STAKE', `Locked ${fmtH(stq)} HOST`); setSimming(false); }, 500);
  }
  function simUnstake() {
    setSimming(true);
    setTimeout(() => { addSim('UNSTAKE', `Unlocked ${fmtH(userStaked)} HOST`); setUserStaked(0); setSimming(false); }, 500);
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3 flex items-start gap-3">
        <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <p className="text-xs text-amber-300">
          <strong>Hackathon Integration Demo</strong> — The Agent Launch tab calls the live <strong>SURGE Skills API</strong> to deploy a real token on Base. Provide a SURGE API key to execute. The Curve Simulator tab shows tokenomics without deploying.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)]" style={{ boxShadow: '0 0 20px rgba(176,128,92,0.2)' }}>
            <img src={HOST_LOGO} alt="$HOST token" className="h-full w-full object-cover" />
          </div>
          <div>
            <h1 className="text-3xl font-bold" style={{ color: '#f2eee5' }}>$HOST Token</h1>
            <p className="mt-0.5 text-sm text-[var(--muted)]">GhostAgent.ninja utility token — bonding curve on Base via SURGE. Agent-launched. Agent-governed.</p>
          </div>
        </div>
        <a
          href="https://nftmail.box/"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg border border-[rgba(176,128,92,0.3)] bg-[rgba(176,128,92,0.08)] px-4 py-1.5 text-xs font-semibold transition hover:bg-[rgba(176,128,92,0.14)]"
          style={{ fontFamily: "Ayuthaya, 'Courier New', monospace", color: '#d9d9d8' }}
        >
          NFTmail.box ↗
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'PRICE (SIM)', value: fmtEth(curvePrice(supply)), sub: 'marginal price on curve' },
          { label: 'CIRCULATING', value: fmtH(supply), sub: `of ${fmtH(TOTAL_SUPPLY_CAP)} cap` },
          { label: 'ETH RESERVE', value: fmtEth(ethReserve(supply)), sub: 'ETH locked in curve' },
          { label: 'YOUR BALANCE', value: fmtH(userBal), sub: `${fmtH(userStaked)} staked` },
        ].map(s => (
          <div key={s.label} className="rounded-2xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] px-4 py-3">
            <div className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">{s.label}</div>
            <div className="mt-1 text-base font-bold" style={{ color: '#f2eee5' }}>{s.value}</div>
            <div className="text-[10px] text-[var(--muted)]">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">

        <div className="space-y-6">

          <div className="flex gap-1 rounded-xl border border-[rgba(176,128,92,0.25)] p-1" style={{ background: '#0f0703' }}>
            {(['launch', 'sim'] as const).map(t => (
              <button key={t} onClick={() => setPageTab(t)}
                className="flex-1 rounded-lg py-2 text-xs font-semibold tracking-wide transition"
                style={{
                  color: pageTab === t ? '#b0805c' : 'var(--muted)',
                  background: pageTab === t ? 'rgba(176,128,92,0.15)' : 'transparent',
                }}
              >
                {t === 'launch' ? '⚡ Agent Launch (SURGE API)' : '📈 Curve Simulator'}
              </button>
            ))}
          </div>

          {pageTab === 'launch' && (
            <div className="rounded-2xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] p-5">
              <div className="mb-4 flex items-center gap-2">
                <h2 className="text-sm font-semibold" style={{ color: '#f2eee5' }}>Agent Token Launch</h2>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">LIVE API</span>
                <a href="https://github.com/SURGE-xyz/skills" target="_blank" rel="noopener noreferrer"
                  className="ml-auto text-[10px] text-[var(--muted)] hover:text-white transition">
                  SURGE Skills →
                </a>
              </div>
              <AgentLaunchPanel />
            </div>
          )}

          {pageTab === 'sim' && (
            <>
              <div className="rounded-xl border border-[rgba(176,128,92,0.2)] px-4 py-3 text-xs leading-relaxed space-y-2" style={{ background: '#0f0703' }}>
                <p className="font-semibold" style={{ color: '#f2eee5' }}>How the bonding curve works</p>
                <p className="text-[var(--muted)]">
                  <span style={{ color: '#b0805c' }}>Price rises automatically</span> as more $HOST is bought — no market makers needed.
                  The curve formula sets the price at every point. Early buyers get cheaper tokens; later buyers pay more.
                </p>
                <p className="text-[var(--muted)]">
                  <span style={{ color: '#b0805c' }}>ETH reserve</span> = actual ETH locked in the contract backing all circulating tokens.
                  Sell at any time and you get back ETH from the reserve at the current curve price.
                </p>
                <p className="text-[var(--muted)]">
                  <span style={{ color: '#b0805c' }}>At launch</span> the token had 0.001 ETH initial buy, minting ~1,000 HOST at ~0.000001 ETH ($0.0025) each.
                  The sim starts there. Use Buy/Sell to explore what happens as demand grows.
                </p>
              </div>
              <div className="rounded-2xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold" style={{ color: '#f2eee5' }}>Bonding Curve</h2>
                  <span className="text-[10px] text-[var(--muted)]">price = {BASE_PRICE} + {SLOPE} × supply (ETH)</span>
                </div>
                <MiniCurve currentSupply={supply} />
                <div className="mt-3 grid grid-cols-3 gap-3 text-xs text-[var(--muted)]">
                  {[
                    ['At launch', fmtEth(BASE_PRICE), 'text-[var(--muted)]'],
                    ['Now (sim)', fmtEth(curvePrice(supply)), 'text-[#b0805c]'],
                    ['At cap', fmtEth(curvePrice(TOTAL_SUPPLY_CAP)), 'text-[var(--muted)]'],
                  ].map(([l, v, c]) => (
                    <div key={l} className="rounded-lg p-2" style={{ background: '#0f0703' }}>
                      <div className={`font-semibold mb-0.5 ${c}`}>{l}</div>
                      {v} / HOST
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] p-5">
                <h2 className="mb-4 text-sm font-semibold" style={{ color: '#f2eee5' }}>Token Utility</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {UTILITY_ITEMS.map(item => (
                    <div key={item.title} className="rounded-xl p-3 text-xs" style={{ background: '#0f0703' }}>
                      <div className="mb-1 flex items-center gap-2">
                        <span>{item.icon}</span>
                        <span className="font-semibold" style={{ color: '#f2eee5' }}>{item.title}</span>
                      </div>
                      <p className="text-[var(--muted)] leading-relaxed">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] p-5">
                <h2 className="mb-4 text-sm font-semibold" style={{ color: '#f2eee5' }}>Staking Tiers</h2>
                <div className="space-y-2">
                  {STAKE_TIERS.map(tier => {
                    const isActive = curTier.label === tier.label && userStaked >= tier.minStake;
                    return (
                      <div key={tier.label} className={`flex items-center justify-between rounded-xl border px-4 py-3 ${tier.border} ${isActive ? 'bg-white/[0.03]' : ''}`}>
                        <div className="flex items-center gap-3">
                          <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-transparent'}`} />
                          <div>
                            <span className={`text-xs font-bold ${tier.color}`}>{tier.label}</span>
                            <span className="ml-2 text-[10px] text-[var(--muted)]">≥ {fmtH(tier.minStake)} HOST</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-semibold" style={{ color: '#f2eee5' }}>{tier.score} score</div>
                          <div className="text-[10px] text-[var(--muted)]">{tier.boost}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] overflow-hidden">
            <div className="flex border-b border-[rgba(176,128,92,0.2)]">
              {(['buy', 'sell', 'stake'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className="flex-1 py-3 text-xs font-semibold uppercase tracking-wider transition"
                  style={{
                    color: tab === t ? '#b0805c' : 'var(--muted)',
                    background: tab === t ? 'rgba(176,128,92,0.1)' : 'transparent',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="p-4 space-y-4">
              {tab === 'buy' && (
                <>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">AMOUNT (HOST)</label>
                    <input type="number" value={buyAmt} onChange={e => setBuyAmt(e.target.value)}
                      className="w-full rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/30 px-3 py-2 text-xs outline-none"
                      style={{ color: '#f2eee5' }} />
                  </div>
                  <div className="rounded-lg p-3 text-xs" style={{ background: '#0f0703' }}>
                    <div className="flex justify-between mb-1">
                      <span className="text-[var(--muted)]">Cost</span>
                      <span style={{ color: '#f2eee5' }}>{fmtEth(bCost)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--muted)]">New price</span>
                      <span style={{ color: '#b0805c' }}>{fmtEth(curvePrice(supply + bq))} / HOST</span>
                    </div>
                  </div>
                  <button onClick={simBuy} disabled={simming || bq <= 0}
                    className="w-full rounded-xl py-2.5 text-xs font-bold transition disabled:opacity-40"
                    style={{ background: 'rgba(176,128,92,0.2)', color: '#b0805c', border: '1px solid rgba(176,128,92,0.3)' }}>
                    {simming ? 'Simulating…' : 'Simulate Buy'}
                  </button>
                </>
              )}

              {tab === 'sell' && (
                <>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">AMOUNT (HOST)</label>
                    <input type="number" value={sellAmt} onChange={e => setSellAmt(e.target.value)}
                      className="w-full rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/30 px-3 py-2 text-xs outline-none"
                      style={{ color: '#f2eee5' }} />
                  </div>
                  <div className="rounded-lg p-3 text-xs" style={{ background: '#0f0703' }}>
                    <div className="flex justify-between mb-1">
                      <span className="text-[var(--muted)]">You receive</span>
                      <span style={{ color: '#f2eee5' }}>{fmtEth(sProc)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--muted)]">Balance</span>
                      <span style={{ color: '#b0805c' }}>{fmtH(userBal)} HOST</span>
                    </div>
                  </div>
                  <button onClick={simSell} disabled={simming || sq <= 0}
                    className="w-full rounded-xl py-2.5 text-xs font-bold transition disabled:opacity-40"
                    style={{ background: 'rgba(239,68,68,0.1)', color: 'rgb(239,68,68)', border: '1px solid rgba(239,68,68,0.2)' }}>
                    {simming ? 'Simulating…' : 'Simulate Sell'}
                  </button>
                </>
              )}

              {tab === 'stake' && (
                <>
                  <div className="rounded-lg p-3 text-xs space-y-1" style={{ background: '#0f0703' }}>
                    <div className="flex justify-between">
                      <span className="text-[var(--muted)]">Current tier</span>
                      <span className={`font-bold ${curTier.color}`}>{curTier.label}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--muted)]">Staked</span>
                      <span style={{ color: '#f2eee5' }}>{fmtH(userStaked)} HOST</span>
                    </div>
                    {nxtTier && (
                      <div className="flex justify-between">
                        <span className="text-[var(--muted)]">Next tier</span>
                        <span className={nxtTier.color}>{nxtTier.label} @ {fmtH(nxtTier.minStake)}</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">STAKE AMOUNT</label>
                    <input type="number" value={stakeAmt} onChange={e => setStakeAmt(e.target.value)}
                      className="w-full rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/30 px-3 py-2 text-xs outline-none"
                      style={{ color: '#f2eee5' }} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={simStake} disabled={simming || stq <= 0}
                      className="flex-1 rounded-xl py-2.5 text-xs font-bold transition disabled:opacity-40"
                      style={{ background: 'rgba(139,92,246,0.15)', color: 'rgb(196,181,253)', border: '1px solid rgba(139,92,246,0.25)' }}>
                      Stake
                    </button>
                    <button onClick={simUnstake} disabled={simming || userStaked <= 0}
                      className="flex-1 rounded-xl py-2.5 text-xs font-bold transition disabled:opacity-40"
                      style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--muted)', border: '1px solid rgba(176,128,92,0.2)' }}>
                      Unstake
                    </button>
                  </div>
                </>
              )}

              {simLog.length > 0 && (
                <div className="space-y-1 pt-1 border-t border-[rgba(176,128,92,0.2)]">
                  <p className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">SIM LOG</p>
                  {simLog.map((l, i) => (
                    <div key={i} className="flex justify-between text-[10px]">
                      <span className="font-mono" style={{ color: l.type === 'BUY' ? '#b0805c' : l.type === 'SELL' ? 'rgb(239,68,68)' : 'rgb(196,181,253)' }}>{l.type}</span>
                      <span className="text-[var(--muted)]">{l.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] p-4 text-xs space-y-2">
            <p className="font-semibold text-[10px] tracking-wider text-[var(--muted)]">TRY IT: EMAIL THE AGENT</p>
            <div className="rounded-lg p-3 font-mono" style={{ background: '#0f0703', color: '#b0805c' }}>
              ghostagent_@nftmail.box
            </div>
            <p className="text-[var(--muted)]">Send: <span style={{ color: '#f2eee5' }}>"launch [name] token on Base"</span></p>
            <p className="text-[var(--muted)]">Agent replies with Basescan tx + SURGE trade link within ~5 min.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
