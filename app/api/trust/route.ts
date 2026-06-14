/**
 * GET /api/trust?check=resolve&chain=gnosis&agentId=3199
 * GET /api/trust?check=a2a&url=https://ghostagent.ninja
 * GET /api/trust?check=mcp&url=https://ghostagent.ninja
 *
 * Server-side proxy to the notapaperclip.red trust oracle. Keeps the browser
 * same-origin (notapaperclip.red endpoints do not send CORS headers) and lets
 * the /normies trust panel call the independent verifier without leaking the
 * upstream base URL into the client bundle.
 */

import { NextRequest, NextResponse } from 'next/server';

const PAPERCLIP_API = process.env.NEXT_PUBLIC_PAPERCLIP_API ?? 'https://notapaperclip.red/api';

const ENDPOINTS: Record<string, string> = {
  resolve: '/erc8004/resolve',
  a2a: '/a2a/validate',
  mcp: '/mcp/probe',
};

export async function GET(req: NextRequest) {
  const check = req.nextUrl.searchParams.get('check') ?? '';
  const endpoint = ENDPOINTS[check];
  if (!endpoint) {
    return NextResponse.json(
      { error: `Unknown check "${check}". Supported: ${Object.keys(ENDPOINTS).join(', ')}` },
      { status: 400 },
    );
  }

  // Forward every param except our own `check` switch.
  const upstream = new URL(`${PAPERCLIP_API}${endpoint}`);
  req.nextUrl.searchParams.forEach((value, key) => {
    if (key !== 'check') upstream.searchParams.set(key, value);
  });

  try {
    const res = await fetch(upstream.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
      next: { revalidate: 30 },
    });
    const data = (await res.json()) as unknown;
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Trust oracle unreachable' }, { status: 502 });
  }
}
