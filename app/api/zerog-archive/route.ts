/**
 * /api/zerog-archive
 *
 * POST { AgentBundle } → uploads ECIES-encrypted bundle to 0G Storage
 *                      → returns { rootHash, txHash, size }
 *
 * GET  ?rootHash=<hash> → downloads bundle from 0G and returns it
 *
 * Protected by X-Webhook-Secret header.
 *
 * Environment variables required:
 *   ZEROG_PRIVATE_KEY   — wallet private key with 0G A0GI balance for gas
 *   ZEROG_RPC_URL       — 0G EVM RPC (e.g. https://evmrpc-testnet.0g.ai)
 *   ZEROG_INDEXER_URL   — 0G indexer RPC
 *   WEBHOOK_SECRET      — shared secret with the worker
 */

import { NextRequest, NextResponse } from 'next/server';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';
const ZEROG_PRIVATE_KEY = process.env.ZEROG_PRIVATE_KEY ?? '';
const ZEROG_RPC_URL = process.env.ZEROG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai';
const ZEROG_INDEXER_URL = process.env.ZEROG_INDEXER_URL ?? 'https://indexer-storage-testnet-turbo.0g.ai';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function missingConfig() {
  return NextResponse.json({ error: 'ZEROG_PRIVATE_KEY not configured' }, { status: 503 });
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get('X-Webhook-Secret') ?? '';
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) return unauthorized();
  if (!ZEROG_PRIVATE_KEY) return missingConfig();

  let bundle: unknown;
  try {
    bundle = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const bundleStr = JSON.stringify(bundle);
  const bundleBytes = new TextEncoder().encode(bundleStr);

  try {
    const { Indexer, MemData } = await import('@0glabs/0g-ts-sdk');
    const { ethers } = await import('ethers');

    const provider = new ethers.JsonRpcProvider(ZEROG_RPC_URL);
    const signer = new ethers.Wallet(ZEROG_PRIVATE_KEY, provider);

    const memData = new MemData(bundleBytes);
    const [tree, treeErr] = await memData.merkleTree();
    if (treeErr !== null) {
      return NextResponse.json({ error: `Merkle tree error: ${treeErr}` }, { status: 500 });
    }
    const rootHash = tree?.rootHash() ?? '';

    const indexer = new Indexer(ZEROG_INDEXER_URL);
    const [tx, uploadErr] = await indexer.upload(memData, ZEROG_RPC_URL, signer);
    if (uploadErr !== null) {
      return NextResponse.json({ error: `0G upload error: ${uploadErr}` }, { status: 502 });
    }

    const txHash = 'rootHash' in tx ? (tx as any).txHash : (tx as any).txHashes?.[0] ?? '';
    return NextResponse.json({ rootHash, txHash, size: bundleBytes.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Archive failed: ${msg}` }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const secret = request.headers.get('X-Webhook-Secret') ?? '';
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) return unauthorized();
  if (!ZEROG_PRIVATE_KEY) return missingConfig();

  const rootHash = request.nextUrl.searchParams.get('rootHash') ?? '';
  if (!rootHash) {
    return NextResponse.json({ error: 'Missing rootHash' }, { status: 400 });
  }

  try {
    const { Indexer } = await import('@0glabs/0g-ts-sdk');
    const indexer = new Indexer(ZEROG_INDEXER_URL);

    const chunks: Uint8Array[] = [];
    let seq = 0;
    while (true) {
      const [segment, err] = await (indexer as any).downloadSegmentByTxSeq(rootHash, seq);
      if (err !== null || !segment) break;
      chunks.push(segment);
      seq++;
    }

    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.length; }

    const bundleStr = new TextDecoder().decode(merged);
    const bundle = JSON.parse(bundleStr);
    return NextResponse.json({ bundle, rootHash });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Fetch failed: ${msg}` }, { status: 500 });
  }
}
