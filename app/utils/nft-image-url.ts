/// Client-safe NFT image URL helpers.
/// Public IPFS gateways (ipfs.io, Lighthouse) are frequently rate-limited (429/402),
/// so IPFS images are tried via the Pinata gateway first, then the original URL.

const PINATA_GATEWAY = 'https://moccasin-useful-vole-840.mypinata.cloud/ipfs';
const PUBLIC_GATEWAY_HOSTS = [
  'ipfs.io',
  'gateway.lighthouse.storage',
  'dweb.link',
  'cloudflare-ipfs.com',
  'gateway.pinata.cloud',
  'nftstorage.link',
  'w3s.link',
];

function ipfsPath(url: string): string | null {
  if (url.startsWith('ipfs://')) return url.slice('ipfs://'.length).replace(/^ipfs\//, '');
  try {
    const u = new URL(url);
    if (!PUBLIC_GATEWAY_HOSTS.includes(u.hostname)) return null;
    const match = u.pathname.match(/^\/ipfs\/(.+)$/);
    return match ? match[1] + u.search : null;
  } catch {
    return null;
  }
}

/** Ordered, de-duplicated list of URLs to try for an NFT image. */
export function nftImageCandidates(primary: string | null | undefined, fallbacks: string[] = []): string[] {
  const out: string[] = [];
  const raw = primary?.trim();
  if (raw) {
    const path = ipfsPath(raw);
    if (path) out.push(`${PINATA_GATEWAY}/${path}`);
    if (!raw.startsWith('ipfs://')) out.push(raw);
  }
  out.push(...fallbacks);
  return Array.from(new Set(out.filter(Boolean)));
}
