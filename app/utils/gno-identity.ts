import { type SldKey } from '../services/genome-metadata';

export const VALID_GNO_SLDS: SldKey[] = [
  'agent',
  'molt',
  'vault',
  'nftmail',
  'picoclaw',
  'openclaw',
];

function isValidGnoTld(value: string): boolean {
  const [sld, tld] = value.split('.');
  return tld === 'gno' && VALID_GNO_SLDS.includes(sld as SldKey);
}

export function normalizeGnoTld(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase();
  if (isValidGnoTld(raw)) return raw;

  if (!/^[a-z0-9+/]+={0,2}$/i.test(raw) || raw.length % 4 !== 0) return null;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8').trim().toLowerCase();
    return isValidGnoTld(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function sldFromGnoName(value: unknown): SldKey | null {
  if (typeof value !== 'string') return null;
  const sld = value.trim().toLowerCase().split('.').slice(-2)[0];
  return VALID_GNO_SLDS.includes(sld as SldKey) ? (sld as SldKey) : null;
}
