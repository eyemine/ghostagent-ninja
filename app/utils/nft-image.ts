/**
 * Fetch NFT image URL from on-chain tokenURI — no API key required.
 * Supports: data:application/json (URL-encoded or base64), https://, ipfs://
 */

const IPFS_GATEWAY = 'https://cloudflare-ipfs.com/ipfs/';

const RPC: Record<string, string> = {
  base:     'https://mainnet.base.org',
  mainnet:  'https://eth.llamarpc.com',
  gnosis:   'https://rpc.gnosischain.com',
};

// ABI-decode a single `string` return value from eth_call
function decodeAbiString(hex: string): string {
  const data = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (data.length < 128) return '';
  const offset    = parseInt(data.slice(0, 64), 16);      // byte offset to string
  const lenStart  = offset * 2;
  const length    = parseInt(data.slice(lenStart, lenStart + 64), 16);
  const strHex    = data.slice(lenStart + 64, lenStart + 64 + length * 2);
  return Buffer.from(strHex, 'hex').toString('utf-8');
}

async function resolveUri(uri: string): Promise<Record<string, unknown> | null> {
  try {
    if (uri.startsWith('data:application/json;base64,')) {
      const b64 = uri.split(',', 2)[1];
      return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
    }
    if (uri.startsWith('data:application/json,')) {
      return JSON.parse(decodeURIComponent(uri.split(',', 2)[1]));
    }
    const fetchUrl = uri.startsWith('ipfs://')
      ? IPFS_GATEWAY + uri.slice(7)
      : uri;
    const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveImage(image: unknown): string | null {
  if (typeof image !== 'string' || !image) return null;
  if (image.startsWith('ipfs://')) return IPFS_GATEWAY + image.slice(7);
  return image; // data URI or https
}

export interface NftTrait { trait_type: string; value: string | number }

export async function fetchNftTraitsOnChain(
  contract: string,
  tokenId: string,
  chain: 'base' | 'mainnet' | 'gnosis' = 'mainnet',
): Promise<NftTrait[]> {
  const rpc = RPC[chain];
  try {
    const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');
    const calldata   = '0xc87b56dd' + tokenIdHex; // tokenURI(uint256)
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: contract, data: calldata }, 'latest'],
      }),
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json() as { result?: string; error?: unknown };
    if (!json.result || json.result === '0x') return [];
    const uri  = decodeAbiString(json.result);
    const meta = await resolveUri(uri);
    if (!meta) return [];
    return Array.isArray(meta.attributes) ? (meta.attributes as NftTrait[]) : [];
  } catch {
    return [];
  }
}

export async function fetchNftImageOnChain(
  contract: string,
  tokenId: string,
  chain: 'base' | 'mainnet' | 'gnosis' = 'mainnet',
): Promise<{ name: string | null; imageUrl: string | null }> {
  const rpc = RPC[chain];
  try {
    const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');
    const calldata   = '0xc87b56dd' + tokenIdHex; // tokenURI(uint256)

    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: contract, data: calldata }, 'latest'],
      }),
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json() as { result?: string; error?: unknown };
    if (!json.result || json.result === '0x') return { name: null, imageUrl: null };

    const uri  = decodeAbiString(json.result);
    const meta = await resolveUri(uri);
    if (!meta) return { name: null, imageUrl: null };

    // POW NFT (and similar): `image` points to a video (/v/{id}), `poster` is the still PNG (/p/{id}).
    // Prefer `poster` when present; also fall back to it if `image` is clearly a video URL.
    const rawImage = typeof meta.image === 'string' ? meta.image : null;
    const rawPoster = typeof meta.poster === 'string' ? meta.poster : null;
    const isVideoUrl = rawImage ? /\/(v|video|mp4)\/|\.mp4$|\.webm$/.test(rawImage) : false;
    const imageUrl = resolveImage(rawPoster && (isVideoUrl || !rawImage) ? rawPoster : (rawImage ?? rawPoster));

    return {
      name:     typeof meta.name === 'string' ? meta.name : null,
      imageUrl,
    };
  } catch {
    return { name: null, imageUrl: null };
  }
}
