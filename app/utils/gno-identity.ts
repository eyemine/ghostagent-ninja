import { type SldKey } from '../services/genome-metadata';

export const VALID_GNO_SLDS: SldKey[] = [
  'agent',
  'molt',
  'vault',
  'nftmail',
  'picoclaw',
  'openclaw',
];

const PLAIN_TLD = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

function isValidGnoTld(value: string): boolean {
  const [sld, tld] = value.split('.');
  return tld === 'gno' && VALID_GNO_SLDS.includes(sld as SldKey);
}

/** Decode a stored TLD value: plain ("molt.gno", "fakenormie") or legacy base64 ("bW9sdC5nbm8="). */
export function decodeStoredTld(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw === 'null') return null;
  if (PLAIN_TLD.test(raw)) return raw;
  if (!/^[a-z0-9+/]+={0,2}$/i.test(raw) || raw.length % 4 !== 0) return null;
  try {
    const decoded = atob(raw).trim().toLowerCase();
    return PLAIN_TLD.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function normalizeGnoTld(value: unknown): string | null {
  const decoded = decodeStoredTld(value)?.toLowerCase() ?? null;
  return decoded && isValidGnoTld(decoded) ? decoded : null;
}

export function sldFromGnoName(value: unknown): SldKey | null {
  if (typeof value !== 'string') return null;
  const parts = value.trim().toLowerCase().split('.');
  if (parts[parts.length - 1] !== 'gno') return null;
  const sld = parts[parts.length - 2];
  return VALID_GNO_SLDS.includes(sld as SldKey) ? (sld as SldKey) : null;
}
