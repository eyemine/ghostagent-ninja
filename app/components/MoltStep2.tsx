'use client';

import { useState } from 'react';

const BLOCKED_TLDS = ['picoclaw.gno'];

const SLD_IMAGES: Record<string, string> = {
  'molt.gno': 'https://cloudflare-ipfs.com/ipfs/bafkreicyrwnh4oxk4e53kly7kzmlpb345pqr5gd2v5acf4kcyl75e4hjdy',
  'agent.gno': 'https://cloudflare-ipfs.com/ipfs/bafkreihdpulp5riv3dkhtomi2iurgeypvplhdsi3nnkumzmvx725xc4yly',
  'openclaw.gno': 'https://cloudflare-ipfs.com/ipfs/bafkreigyk2c7gg5ijwvg4v6pyopcioatdjsfffvnkplgqyc2t3jowe3t7e',
  'vault.gno': 'https://cloudflare-ipfs.com/ipfs/bafkreibxujpkkylek6uznnl2d2d4vmpxi3aiowxyx2ydf5xo4xexcnksau',
};

const PRESET_IDENTITIES = [
  { id: 'molt', label: 'Molt', tld: 'molt.gno', description: 'Glass-box identity with full history', image: SLD_IMAGES['molt.gno'] },
  { id: 'agent', label: 'Agent', tld: 'agent.gno', description: 'Black-box autonomous agent', image: SLD_IMAGES['agent.gno'] },
  { id: 'openclaw', label: 'OpenClaw', tld: 'openclaw.gno', description: 'Transparent governance agent', image: SLD_IMAGES['openclaw.gno'] },
  { id: 'vault', label: 'Vault', tld: 'vault.gno', description: 'Terminal Safe-locked identity', image: SLD_IMAGES['vault.gno'] },
  { id: 'imago', label: 'Imago', tld: '', description: 'Pupa → Imago tier upgrade (any SLD)', icon: '🦋' },
];

export interface TargetIdentity {
  name: string;
  tld: string;
  fullName: string;
  isPreset: boolean;
}

interface MoltStep2Props {
  sourceAgentName: string;
  onSelect: (identity: TargetIdentity) => void;
  onBack: () => void;
}

export function MoltStep2({ sourceAgentName, onSelect, onBack }: MoltStep2Props) {
  const [selected, setSelected] = useState<string>('');
  const [customName, setCustomName] = useState('');
  const [customTld, setCustomTld] = useState('molt.gno');
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preset = PRESET_IDENTITIES.find(p => p.id === selected);
  const isCustom = selected === 'imago';
  const targetName = isCustom ? customName : (selected || '');
  const targetTld = isCustom ? customTld : (preset?.tld ?? '');
  const fullTarget = targetName ? `${targetName}.${targetTld}` : '';
  const isBlocked = BLOCKED_TLDS.includes(targetTld);

  async function checkAvailability() {
    if (!targetName || !targetTld) return;
    setChecking(true);
    setAvailable(null);
    setError(null);
    try {
      const res = await fetch(`/api/check-name?name=${encodeURIComponent(targetName)}&tld=${encodeURIComponent(targetTld)}`);
      const data = await res.json() as any;
      setAvailable(data.available ?? false);
    } catch {
      setError('Could not check availability');
    } finally {
      setChecking(false);
    }
  }

  function handleContinue() {
    if (!targetName || !targetTld || isBlocked) return;
    onSelect({
      name: targetName,
      tld: targetTld,
      fullName: fullTarget,
      isPreset: !isCustom,
    });
  }

  const canContinue = targetName.trim().length > 0 && !isBlocked && targetName !== sourceAgentName;

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--muted)]">
        Choose the identity <span className="text-white font-medium">{sourceAgentName}_</span> will molt into. Your email address never changes — only the identity overlay.
      </p>

      {/* Preset options */}
      <div className="grid grid-cols-2 gap-2">
        {PRESET_IDENTITIES.map((opt) => {
          const blocked = BLOCKED_TLDS.includes(opt.tld) && opt.id !== 'custom';
          return (
            <button
              key={opt.id}
              onClick={() => { setSelected(opt.id); setAvailable(null); setError(null); }}
              disabled={blocked}
              className={`rounded-xl border px-3 py-3 text-left transition ${
                selected === opt.id
                  ? 'border-amber-500/40 bg-amber-500/10'
                  : blocked
                  ? 'border-[var(--border)] bg-black/10 opacity-40 cursor-not-allowed'
                  : 'border-[var(--border)] bg-black/20 hover:border-amber-500/20'
              }`}
            >
              <div className="flex items-center gap-2">
                {opt.image ? (
                  <img src={opt.image} alt={opt.label} className="h-8 w-8 rounded object-cover" />
                ) : opt.icon ? (
                  <span className="text-4xl">{opt.icon}</span>
                ) : null}
                <div>
                  <div className="text-xs font-semibold text-white">{opt.label}</div>
                  <div className="text-[9px] text-[var(--muted)]">{opt.description}</div>
                </div>
              </div>
              {opt.tld && opt.id !== 'imago' && (
                <div className="mt-1.5 font-mono text-[9px] text-amber-400/60">.{opt.tld}</div>
              )}
              {blocked && (
                <div className="mt-1 text-[9px] text-red-400">🔒 Blocked</div>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-6 space-y-1 text-center text-[10px] text-[var(--muted)]">
        <div>✓ Email unchanged</div>
        <div>✓ Safe preserved</div>
        <div>✓ TBA unchanged</div>
        <div>✓ picoclaw.gno blocked</div>
        <div className="pt-2 text-[9px]">molts are logged onchain · primary email never changes · fee non-refundable</div>
      </div>

      {/* Custom input */}
      {isCustom && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={customName}
              onChange={(e) => { setCustomName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setAvailable(null); }}
              placeholder="identity name"
              className="flex-1 rounded-xl border border-[var(--border)] bg-black/40 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-amber-500/40"
            />
            <select
              value={customTld}
              onChange={(e) => { setCustomTld(e.target.value); setAvailable(null); }}
              className="rounded-xl border border-[var(--border)] bg-black/40 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500/40"
            >
              <option value="molt.gno">.molt.gno</option>
              <option value="agent.gno">.agent.gno</option>
            </select>
          </div>
          <button
            onClick={checkAvailability}
            disabled={!customName || checking}
            className="w-full rounded-xl border border-[var(--border)] bg-black/20 px-4 py-2 text-xs text-[var(--muted)] transition hover:text-white disabled:opacity-40"
          >
            {checking ? 'Checking...' : 'Check availability'}
          </button>
          {available === true && (
            <div className="text-xs text-emerald-400">✓ {fullTarget} is available</div>
          )}
          {available === false && (
            <div className="text-xs text-red-400">✗ {fullTarget} is taken</div>
          )}
        </div>
      )}

      {/* Non-custom full name preview */}
      {selected && !isCustom && (
        <div className="rounded-xl border border-[rgba(176,128,92,0.15)] bg-black/20 px-4 py-2.5">
          <span className="text-[10px] text-[var(--muted)]">Target: </span>
          <span className="font-mono text-sm text-amber-300">{sourceAgentName}.{targetTld}</span>
        </div>
      )}

      {isBlocked && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-400">
          🔒 vault.gno is reserved and cannot be used as a molt target
        </div>
      )}

      {error && (
        <div className="text-xs text-red-400">{error}</div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onBack}
          className="flex-1 rounded-xl border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-[var(--muted)] transition hover:text-white"
        >
          ← Back
        </button>
        <button
          onClick={handleContinue}
          disabled={!canContinue}
          className="flex-1 rounded-xl bg-amber-500/20 px-4 py-3 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Preview Molt →
        </button>
      </div>
    </div>
  );
}
