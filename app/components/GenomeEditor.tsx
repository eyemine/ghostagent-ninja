'use client';

/**
 * GenomeEditor — shared NFT metadata editor used in:
 *   1. Mint Agent page  (image + displayName + tagline only)
 *   2. Install Brain page (+ description, via AgentCapabilityForm extension)
 *
 * Emits GenomeMetadata on every change via onChange.
 * Image upload is optional — falls back to per-SLD placeholder SVG.
 */

import { useState } from 'react';
import {
  type SldKey,
  type GenomeMetadata,
  defaultGenomeMetadata,
  SLD_VISUAL,
} from '../services/genome-metadata';

interface GenomeEditorProps {
  agentName: string;
  sld: SldKey;
  value: GenomeMetadata | null;
  onChange: (meta: GenomeMetadata) => void;
  showDescription?: boolean;   // false on mint page, true on install-brain
  compact?: boolean;           // tighter layout when embedded inside a larger panel
}

const MAX_TAGLINE = 80;
const MAX_DESC = 500;

export function GenomeEditor({
  agentName,
  sld,
  value,
  onChange,
  showDescription = false,
  compact = false,
}: GenomeEditorProps) {
  const visual = SLD_VISUAL[sld];
  const meta = value ?? defaultGenomeMetadata(agentName, sld);

  const [imgTs, setImgTs] = useState(() => Date.now());
  const placeholderUrl = `/api/genome-image?sld=${sld}&name=${encodeURIComponent(agentName || 'agent')}`;

  // ── field helpers ──────────────────────────────────────────────────────────

  function update(patch: Partial<GenomeMetadata>) {
    onChange({ ...meta, ...patch, updatedAt: Date.now() });
  }

  return (
    <div className={`space-y-4 ${compact ? '' : 'rounded-xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] p-5'}`}>

      {!compact && (
        <div className="text-xs font-semibold tracking-[0.18em] text-[var(--muted)]">GENOME NFT METADATA</div>
      )}

      <div className={`flex gap-5 ${compact ? 'flex-col sm:flex-row' : 'flex-col sm:flex-row'}`}>

        {/* ── Image placeholder ─────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-2 shrink-0">
          <div
            className="relative h-32 w-32 overflow-hidden rounded-xl border border-[rgba(176,128,92,0.3)] bg-black/30"
            style={{ boxShadow: `0 0 18px ${visual.accentColor}22` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={imgTs}
              src={`${placeholderUrl}&_=${imgTs}`}
              alt={agentName}
              className="h-full w-full object-cover"
            />
            <span className="absolute bottom-1 right-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[8px] text-[var(--muted)]">
              placeholder
            </span>
          </div>
          <button
            type="button"
            onClick={() => { setImgTs(() => Date.now()); onChange(defaultGenomeMetadata(agentName, sld)); }}
            className="rounded-lg border border-[rgba(176,128,92,0.3)] bg-[rgba(176,128,92,0.08)] px-2.5 py-1 text-[10px] font-semibold text-[#b0805c] hover:bg-[rgba(176,128,92,0.14)] transition-colors"
          >
            Refresh preview
          </button>
          <p className="text-center text-[9px] text-[var(--muted)] max-w-[7.5rem]">
            Auto-generated from name + namespace
          </p>
        </div>

        {/* ── Text fields ────────────────────────────────────────────────── */}
        <div className="flex-1 space-y-3 min-w-0">

          {/* Display name */}
          <div className="space-y-1">
            <label className="block text-[10px] font-semibold tracking-[0.12em] text-[var(--muted)]">
              DISPLAY NAME
            </label>
            <input
              type="text"
              value={meta.displayName}
              onChange={e => update({ displayName: e.target.value })}
              placeholder={meta.fullName}
              maxLength={60}
              className="w-full rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/30 px-3 py-2 text-sm text-[#f2eee4] outline-none placeholder:text-[var(--muted)] focus:border-[rgba(176,128,92,0.45)] transition-colors"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="block text-[10px] font-semibold tracking-[0.12em] text-[var(--muted)]">
              DESCRIPTION <span className="font-normal normal-case">({meta.tagline.length}/{MAX_TAGLINE})</span>
            </label>
            <input
              type="text"
              value={meta.tagline}
              onChange={e => update({ tagline: e.target.value.slice(0, MAX_TAGLINE) })}
              placeholder="One-line description of your agent…"
              className="w-full rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/30 px-3 py-2 text-sm text-[#f2eee4] outline-none placeholder:text-[var(--muted)] focus:border-[rgba(176,128,92,0.45)] transition-colors"
            />
          </div>

          {/* Description — only shown on install-brain */}
          {showDescription && (
            <div className="space-y-1">
              <label className="block text-[10px] font-semibold tracking-[0.12em] text-[var(--muted)]">
                AGENT DESCRIPTION <span className="font-normal normal-case">({meta.description.length}/{MAX_DESC})</span>
              </label>
              <textarea
                value={meta.description}
                onChange={e => update({ description: e.target.value.slice(0, MAX_DESC) })}
                rows={4}
                placeholder="Describe what this agent does, its purpose, and any constraints…"
                className="w-full resize-none rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/30 px-3 py-2 text-sm text-[#f2eee4] outline-none placeholder:text-[var(--muted)] focus:border-[rgba(176,128,92,0.45)] transition-colors"
              />
            </div>
          )}

          {/* Metadata preview pill row */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <span className="inline-flex items-center rounded-full border border-[rgba(176,128,92,0.2)] bg-[rgba(176,128,92,0.06)] px-2.5 py-0.5 text-[9px] text-[var(--muted)]">
              {sld}.gno
            </span>
            <span className="inline-flex items-center rounded-full border border-[rgba(176,128,92,0.15)] bg-transparent px-2.5 py-0.5 text-[9px] text-[var(--muted)]">
              Placeholder image
            </span>
          </div>

        </div>
      </div>
    </div>
  );
}
