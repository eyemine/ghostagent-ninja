/// arweave-upload.ts
///
/// Reusable Arweave upload service.
///
/// Strategy (hybrid, in priority order):
///   1. ar.io Turbo  — free for payloads ≤ 100 KB, no key required
///      POST https://turbo.ardrive.io/tx
///   2. Irys public node — free for payloads ≤ 1 KB, no key required
///      POST https://uploader.irys.xyz/upload
///   3. Irys funded node — requires IRYS_PRIVATE_KEY env var (ETH on Arbitrum)
///      POST https://uploader.irys.xyz/upload  with x-arweave-key header
///   4. Arweave JWK — requires ARWEAVE_KEY_JWK env var (native AR wallet)
///      POST https://arweave.net/tx
///
/// For hackathon certificates and Glass Box declarations (< 10 KB each),
/// ar.io Turbo free tier handles everything with no credentials.
///
/// Returns: { txId, url, method, sizeBytes }
/// The permanent URL is: https://arweave.net/<txId>

export interface ArweaveUploadResult {
  txId:      string;   // Arweave transaction ID
  url:       string;   // https://arweave.net/<txId>  (permanent)
  arUrl:     string;   // ar://<txId>
  method:    'turbo-free' | 'irys-free' | 'irys-funded' | 'arweave-jwk';
  sizeBytes: number;
}

export interface ArweaveUploadOptions {
  contentType?: string;              // default: 'application/json'
  tags?:        { name: string; value: string }[];  // optional Arweave tags
  forceMethod?: ArweaveUploadResult['method'];
}

const TURBO_URL   = 'https://turbo.ardrive.io';
const IRYS_URL    = 'https://uploader.irys.xyz';
const ARWEAVE_URL = 'https://arweave.net';

const FREE_LIMIT_TURBO_BYTES = 100 * 1024;  // 100 KB
const FREE_LIMIT_IRYS_BYTES  = 1024;        // 1 KB

// ─── Main upload entry point ──────────────────────────────────────────────────

/**
 * Upload any JSON-serialisable object to Arweave permanently.
 * Selects the cheapest/simplest method automatically.
 */
export async function uploadToArweave(
  data: unknown,
  opts: ArweaveUploadOptions = {},
): Promise<ArweaveUploadResult> {
  const contentType = opts.contentType ?? 'application/json';
  const bodyStr     = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const sizeBytes   = new TextEncoder().encode(bodyStr).length;

  if (opts.forceMethod) {
    return uploadWithMethod(opts.forceMethod, bodyStr, sizeBytes, contentType, opts.tags ?? []);
  }

  // Auto-select: prefer free tiers
  if (sizeBytes <= FREE_LIMIT_TURBO_BYTES) {
    try {
      return await uploadWithMethod('turbo-free', bodyStr, sizeBytes, contentType, opts.tags ?? []);
    } catch (e: any) {
      console.warn('[arweave] turbo-free failed, trying irys-free:', e?.message);
    }
  }

  if (sizeBytes <= FREE_LIMIT_IRYS_BYTES) {
    try {
      return await uploadWithMethod('irys-free', bodyStr, sizeBytes, contentType, opts.tags ?? []);
    } catch (e: any) {
      console.warn('[arweave] irys-free failed, trying funded:', e?.message);
    }
  }

  // Funded fallbacks
  if (process.env.IRYS_PRIVATE_KEY) {
    return uploadWithMethod('irys-funded', bodyStr, sizeBytes, contentType, opts.tags ?? []);
  }
  if (process.env.ARWEAVE_KEY_JWK) {
    return uploadWithMethod('arweave-jwk', bodyStr, sizeBytes, contentType, opts.tags ?? []);
  }

  throw new Error(
    `[arweave] Payload is ${sizeBytes} bytes — exceeds free tier limits. ` +
    `Set IRYS_PRIVATE_KEY (ETH on Arbitrum) or ARWEAVE_KEY_JWK to upload larger payloads.`,
  );
}

// ─── Upload methods ───────────────────────────────────────────────────────────

async function uploadWithMethod(
  method: ArweaveUploadResult['method'],
  body: string,
  sizeBytes: number,
  contentType: string,
  tags: { name: string; value: string }[],
): Promise<ArweaveUploadResult> {
  switch (method) {
    case 'turbo-free':   return uploadViaTurbo(body, sizeBytes, contentType, tags);
    case 'irys-free':    return uploadViaIrys(body, sizeBytes, contentType, tags, null);
    case 'irys-funded':  return uploadViaIrys(body, sizeBytes, contentType, tags, process.env.IRYS_PRIVATE_KEY ?? null);
    case 'arweave-jwk':  return uploadViaJwk(body, sizeBytes, contentType, tags);
    default: throw new Error(`Unknown upload method: ${method}`);
  }
}

// ── ar.io Turbo (free ≤ 100 KB) ──────────────────────────────────────────────

async function uploadViaTurbo(
  body: string,
  sizeBytes: number,
  contentType: string,
  tags: { name: string; value: string }[],
): Promise<ArweaveUploadResult> {
  const allTags = [
    { name: 'Content-Type', value: contentType },
    { name: 'App-Name',     value: 'GhostAgent' },
    { name: 'App-Version',  value: '1.0.0' },
    ...tags,
  ];

  // Turbo DataItem format: JSON envelope
  const res = await fetch(`${TURBO_URL}/tx`, {
    method:  'POST',
    headers: {
      'Content-Type': contentType,
      'x-custom-tags': JSON.stringify(allTags),
    },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Turbo upload failed (${res.status}): ${err}`);
  }

  const data = await res.json() as { id?: string; dataCaches?: string[] };
  if (!data.id) throw new Error('Turbo: no id in response');

  return { txId: data.id, url: `${ARWEAVE_URL}/${data.id}`, arUrl: `ar://${data.id}`, method: 'turbo-free', sizeBytes };
}

// ── Irys (free ≤ 1 KB, or funded) ────────────────────────────────────────────

async function uploadViaIrys(
  body: string,
  sizeBytes: number,
  contentType: string,
  tags: { name: string; value: string }[],
  privateKey: string | null,
): Promise<ArweaveUploadResult> {
  const allTags = [
    { name: 'Content-Type', value: contentType },
    { name: 'App-Name',     value: 'GhostAgent' },
    ...tags,
  ];

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'x-content-tags': JSON.stringify(allTags),
  };

  if (privateKey) {
    headers['x-arweave-key'] = privateKey;
  }

  const res = await fetch(`${IRYS_URL}/upload`, {
    method: 'POST',
    headers,
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Irys upload failed (${res.status}): ${err}`);
  }

  const data = await res.json() as { id?: string };
  if (!data.id) throw new Error('Irys: no id in response');

  return { txId: data.id, url: `${ARWEAVE_URL}/${data.id}`, arUrl: `ar://${data.id}`, method: privateKey ? 'irys-funded' : 'irys-free', sizeBytes };
}

// ── Native Arweave JWK ────────────────────────────────────────────────────────

async function uploadViaJwk(
  body: string,
  sizeBytes: number,
  contentType: string,
  tags: { name: string; value: string }[],
): Promise<ArweaveUploadResult> {
  const keyJwk = process.env.ARWEAVE_KEY_JWK;
  if (!keyJwk) throw new Error('ARWEAVE_KEY_JWK not set');

  const allTags = [
    { name: 'Content-Type', value: contentType },
    { name: 'App-Name',     value: 'GhostAgent' },
    ...tags,
  ].map(t => ({ name: Buffer.from(t.name).toString('base64url'), value: Buffer.from(t.value).toString('base64url') }));

  const tx = {
    format:    2,
    data:      Buffer.from(body).toString('base64url'),
    quantity:  '0',
    reward:    '0',
    target:    '',
    last_tx:   '',
    tags:      allTags,
    data_size: sizeBytes.toString(),
  };

  const res = await fetch(`${ARWEAVE_URL}/tx`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-arweave-key': keyJwk },
    body:    JSON.stringify(tx),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Arweave JWK upload failed (${res.status}): ${err}`);
  }

  const data = await res.json() as { id?: string };
  if (!data.id) throw new Error('Arweave: no id in response');

  return { txId: data.id, url: `${ARWEAVE_URL}/${data.id}`, arUrl: `ar://${data.id}`, method: 'arweave-jwk', sizeBytes };
}

// ─── Convenience: build standard GhostAgent tags ─────────────────────────────

export function ghostAgentTags(opts: {
  type:      string;   // e.g. 'handshake-certificate' | 'glass-box' | 'trade-intent'
  agentId?:  number;
  agentName?: string;
  chainId?:  number;
}): { name: string; value: string }[] {
  const tags: { name: string; value: string }[] = [
    { name: 'Protocol',   value: 'GhostAgent' },
    { name: 'Type',       value: opts.type },
  ];
  if (opts.agentId  != null) tags.push({ name: 'Agent-Id',   value: String(opts.agentId) });
  if (opts.agentName)        tags.push({ name: 'Agent-Name', value: opts.agentName });
  if (opts.chainId   != null) tags.push({ name: 'Chain-Id',  value: String(opts.chainId) });
  return tags;
}
