'use client';

/**
 * GenomeEditor — shared NFT metadata editor used in:
 *   1. Mint Agent page  (image + displayName + tagline only)
 *   2. Install Brain page (+ description, via AgentCapabilityForm extension)
 *
 * Emits GenomeMetadata on every change via onChange.
 * Image upload is optional — falls back to per-SLD placeholder SVG.
 */

import { useState, useRef, useCallback } from 'react';
import {
  type SldKey,
  type GenomeMetadata,
  generatePlaceholderSvg,
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
const ACCEPTED_IMAGE = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

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

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    meta.imageCid ? meta.imageUri : null,
  );

  const placeholderSvg = generatePlaceholderSvg(agentName || 'agent', sld);

  // ── field helpers ──────────────────────────────────────────────────────────

  function update(patch: Partial<GenomeMetadata>) {
    onChange({ ...meta, ...patch, updatedAt: Date.now() });
  }

  // ── image upload → IPFS via /api/genome-image ─────────────────────────────

  const handleImageFile = useCallback(async (file: File) => {
    if (!file) return;
    setUploadError(null);
    setUploading(true);

    // Local preview immediately
    const reader = new FileReader();
    reader.onload = e => setPreviewUrl(e.target?.result as string);
    reader.readAsDataURL(file);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('agentName', agentName);
      formData.append('sld', sld);

      const res = await fetch('/api/genome-image', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json() as { cid?: string; url?: string; error?: string };

      if (!res.ok || data.error) {
        setUploadError(data.error ?? 'Upload failed');
        setPreviewUrl(null);
        return;
      }

      update({ imageUri: data.url!, imageCid: data.cid! });
    } catch (err: any) {
      setUploadError(err?.message ?? 'Upload error');
      setPreviewUrl(null);
    } finally {
      setUploading(false);
    }
  }, [agentName, sld, meta]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  }

  function clearImage() {
    setPreviewUrl(null);
    update({ imageUri: placeholderSvg, imageCid: null });
    if (fileRef.current) fileRef.current.value = '';
  }

  // ─────────────────────────────────────────────────────────────────────────

  const displayedImage = previewUrl ?? placeholderSvg;
  const hasCustomImage = !!previewUrl || !!meta.imageCid;

  return (
    <div className={`space-y-4 ${compact ? '' : 'rounded-xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] p-5'}`}>

      {!compact && (
        <div className="text-xs font-semibold tracking-[0.18em] text-[var(--muted)]">GENOME NFT METADATA</div>
      )}

      <div className={`flex gap-5 ${compact ? 'flex-col sm:flex-row' : 'flex-col sm:flex-row'}`}>

        {/* ── Image panel ────────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-2 shrink-0">
          {/* Preview */}
          <div
            className="relative h-32 w-32 overflow-hidden rounded-xl border border-[rgba(176,128,92,0.3)] bg-black/30 cursor-pointer group"
            style={{ boxShadow: `0 0 18px ${visual.accentColor}22` }}
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayedImage}
              alt={agentName}
              className="h-full w-full object-cover transition-opacity group-hover:opacity-70"
            />
            {/* Hover overlay */}
            <div className="absolute inset-0 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 rounded-xl">
              <svg className="h-6 w-6 text-[#f2eee4] mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
              <span className="text-[10px] text-[#f2eee4]">{uploading ? 'Uploading…' : 'Upload'}</span>
            </div>
            {/* Upload spinner */}
            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-xl">
                <svg className="h-6 w-6 animate-spin text-[#f2eee4]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4"/>
                </svg>
              </div>
            )}
            {/* Placeholder badge */}
            {!hasCustomImage && (
              <span className="absolute bottom-1 right-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[8px] text-[var(--muted)]">
                placeholder
              </span>
            )}
          </div>

          {/* Hidden file input */}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_IMAGE}
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); }}
          />

          {/* Actions */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-[rgba(176,128,92,0.3)] bg-[rgba(176,128,92,0.08)] px-2.5 py-1 text-[10px] font-semibold text-[#b0805c] hover:bg-[rgba(176,128,92,0.14)] transition-colors"
            >
              {hasCustomImage ? 'Replace' : 'Upload'}
            </button>
            {hasCustomImage && (
              <button
                type="button"
                onClick={clearImage}
                className="rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-1 text-[10px] font-semibold text-red-400 hover:bg-red-500/10 transition-colors"
              >
                Reset
              </button>
            )}
          </div>

          {/* Upload hint */}
          <p className="text-center text-[9px] text-[var(--muted)] max-w-[7.5rem]">
            PNG / JPG / SVG<br />drag-drop or click<br />pinned to IPFS
          </p>

          {/* Upload error */}
          {uploadError && (
            <p className="text-[9px] text-red-400 text-center max-w-[7.5rem]">{uploadError}</p>
          )}
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

          {/* Tagline */}
          <div className="space-y-1">
            <label className="block text-[10px] font-semibold tracking-[0.12em] text-[var(--muted)]">
              TAGLINE <span className="font-normal normal-case">({meta.tagline.length}/{MAX_TAGLINE})</span>
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
            <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(176,128,92,0.2)] bg-[rgba(176,128,92,0.06)] px-2.5 py-0.5 text-[9px] text-[var(--muted)]">
              <span style={{ color: visual.primaryColor }}>{visual.emoji}</span>
              {sld}.gno
            </span>
            {hasCustomImage ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-0.5 text-[9px] text-emerald-300">
                ✓ Custom image pinned
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(176,128,92,0.15)] bg-transparent px-2.5 py-0.5 text-[9px] text-[var(--muted)]">
                Placeholder image
              </span>
            )}
            {meta.imageCid && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(176,128,92,0.15)] bg-transparent px-2.5 py-0.5 text-[9px] font-mono text-[var(--muted)]">
                {meta.imageCid.slice(0, 12)}…
              </span>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
