'use client';

/**
 * AgentCapabilityForm — install-brain extension of GenomeEditor.
 *
 * Used exclusively on the Install Brain page.
 * Adds:
 *   - Capability multi-select (capability taxonomy)
 *   - Serverless compatibility checker (warns on CF Worker incompatibilities)
 *   - Auto-generated function schema preview (based on selected capabilities)
 *   - Brain-type-aware guidance
 */

import { useState, useEffect } from 'react';
import {
  CAPABILITIES,
  checkServerlessCompatibility,
  type CapabilityId,
  type GenomeMetadata,
  type AgentFunction,
} from '../services/genome-metadata';

interface AgentCapabilityFormProps {
  value: GenomeMetadata | null;
  brainType: 'cloudflare' | 'safe';
  onChange: (meta: GenomeMetadata) => void;
}

export function AgentCapabilityForm({
  value,
  brainType,
  onChange,
}: AgentCapabilityFormProps) {
  const [showSchema, setShowSchema] = useState(false);

  const capabilities: CapabilityId[] = value?.capabilities ?? [];

  const check = checkServerlessCompatibility(capabilities, brainType);

  function toggleCapability(id: CapabilityId) {
    if (!value) return;
    const next = capabilities.includes(id)
      ? capabilities.filter(c => c !== id)
      : [...capabilities, id];

    const functionSchema: AgentFunction[] = next
      .map(cid => CAPABILITIES.find(c => c.id === cid)?.functionTemplate)
      .filter(Boolean) as AgentFunction[];

    onChange({
      ...value,
      capabilities: next,
      functionSchema,
      serverlessCompatible: checkServerlessCompatibility(next, brainType).compatible,
      updatedAt: Date.now(),
    });
  }

  // Re-check compatibility when brainType changes
  useEffect(() => {
    if (!value || value.capabilities.length === 0) return;
    const compatible = checkServerlessCompatibility(value.capabilities, brainType).compatible;
    if (compatible !== value.serverlessCompatible) {
      onChange({ ...value, serverlessCompatible: compatible, updatedAt: Date.now() });
    }
  }, [brainType]); // eslint-disable-line react-hooks/exhaustive-deps

  const schemaJson = JSON.stringify(
    (value?.functionSchema ?? []).length > 0
      ? value!.functionSchema
      : CAPABILITIES.filter(c => capabilities.includes(c.id)).map(c => c.functionTemplate),
    null,
    2,
  );

  return (
    <div className="space-y-4">

      {/* ── Section header ── */}
      <div className="text-xs font-semibold tracking-[0.18em] text-[var(--muted)]">
        AGENT CAPABILITIES
      </div>

      {/* ── Brain-type context note ── */}
      <div className={`rounded-lg border px-3 py-2.5 text-xs ${
        brainType === 'cloudflare'
          ? 'border-[rgba(0,163,255,0.2)] bg-[rgba(0,163,255,0.05)] text-[rgb(160,220,255)]'
          : 'border-[rgba(176,128,92,0.2)] bg-[rgba(176,128,92,0.06)] text-[#b0805c]'
      }`}>
        {brainType === 'cloudflare' ? (
          <>
            <span className="font-semibold">Cloudflare Worker brain</span> — stateless, serverless,
            zero infrastructure. Runs at edge in &lt;1ms cold start. No filesystem, no GPU,
            no persistent local state. All storage via KV or external APIs.
          </>
        ) : (
          <>
            <span className="font-semibold">Safe Brain Module</span> — on-chain module installed
            into your Gnosis Safe. Executes synchronously on-chain. Best for high-value
            accountable actions. Async capabilities require an off-chain oracle relay.
          </>
        )}
      </div>

      {/* ── Capability grid ── */}
      <div className="grid gap-2 sm:grid-cols-2">
        {CAPABILITIES.map((cap) => {
          const selected = capabilities.includes(cap.id);
          const hasWarning = !!cap.serverlessWarning && brainType === 'cloudflare';

          return (
            <button
              key={cap.id}
              type="button"
              onClick={() => toggleCapability(cap.id)}
              className={`relative flex flex-col gap-0.5 rounded-xl border p-3 text-left transition-all ${
                selected
                  ? 'border-[rgba(176,128,92,0.5)] bg-[rgba(176,128,92,0.1)]'
                  : 'border-[rgba(176,128,92,0.15)] bg-[var(--card)] hover:border-[rgba(176,128,92,0.3)]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-semibold ${selected ? 'text-[#f2eee4]' : 'text-[var(--muted)]'}`}>
                  {cap.label}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  {hasWarning && (
                    <span className="text-[9px] text-amber-400" title={cap.serverlessWarning}>⚠</span>
                  )}
                  {/* Checkbox */}
                  <span className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] transition-all ${
                    selected
                      ? 'border-[#b0805c] bg-[rgba(176,128,92,0.3)] text-[#f2eee4]'
                      : 'border-[rgba(176,128,92,0.25)] text-transparent'
                  }`}>
                    ✓
                  </span>
                </div>
              </div>
              <span className="text-[10px] text-[var(--muted)] leading-relaxed">{cap.description}</span>
              {/* Trigger badges */}
              <div className="mt-1 flex flex-wrap gap-1">
                {cap.functionTemplate.triggers.map(t => (
                  <span
                    key={t}
                    className="rounded-full bg-white/[0.04] px-1.5 py-0.5 text-[8px] font-mono text-[var(--muted)] ring-1 ring-white/[0.07]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Compatibility result ── */}
      {capabilities.length > 0 && (
        <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/20 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${check.compatible ? 'text-emerald-300' : 'text-red-400'}`}>
              {check.compatible ? '✓ Serverless compatible' : '✗ Incompatible with serverless'}
            </span>
            <span className="text-[10px] text-[var(--muted)]">
              ({capabilities.length} {capabilities.length === 1 ? 'capability' : 'capabilities'} selected)
            </span>
          </div>

          {check.blockers.length > 0 && (
            <div className="space-y-1">
              {check.blockers.map((b, i) => (
                <p key={i} className="text-[10px] text-red-400">✗ {b}</p>
              ))}
            </div>
          )}

          {check.warnings.length > 0 && (
            <div className="space-y-1 border-t border-[rgba(176,128,92,0.1)] pt-2">
              <div className="text-[9px] font-semibold tracking-[0.1em] text-amber-400/60">NOTES</div>
              {check.warnings.map((w, i) => (
                <p key={i} className="text-[10px] text-amber-400/80 leading-relaxed">⚠ {w}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Function schema preview ── */}
      {capabilities.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowSchema(s => !s)}
            className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.12em] text-[var(--muted)] hover:text-[#f2eee4] transition-colors"
          >
            <svg
              className={`h-3 w-3 transition-transform ${showSchema ? 'rotate-90' : ''}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
            {showSchema ? 'HIDE' : 'VIEW'} AGENT FUNCTION SCHEMA
          </button>

          {showSchema && (
            <div className="relative rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/40 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-[rgba(176,128,92,0.15)]">
                <span className="text-[9px] font-semibold tracking-[0.15em] text-[var(--muted)]">
                  AUTO-GENERATED · {capabilities.length} FUNCTION{capabilities.length > 1 ? 'S' : ''}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(schemaJson);
                  }}
                  className="text-[9px] text-[var(--muted)] hover:text-[#f2eee4] transition-colors"
                >
                  Copy
                </button>
              </div>
              <pre className="overflow-x-auto px-4 py-3 text-[10px] font-mono text-[rgb(160,220,255)] leading-relaxed max-h-80">
                {schemaJson}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ── Empty state ── */}
      {capabilities.length === 0 && (
        <p className="text-xs text-[var(--muted)]">
          Select capabilities above to auto-generate your agent&apos;s function schema. The schema is stored in your Genome NFT metadata and visible to other agents for A2A protocol discovery.
        </p>
      )}

    </div>
  );
}
