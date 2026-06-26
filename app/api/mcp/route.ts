import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const WORKER_SECRET = process.env.WORKER_SECRET || '';

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Worker-Secret',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const res = await fetch(`${WORKER_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': WORKER_SECRET,
      },
      body,
    });
    
    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Worker-Secret',
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'MCP proxy error';
    return NextResponse.json({ error: msg }, {
      status: 502,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}

export async function GET(req: NextRequest) {
  // If a simple browser request comes in, return a helpful response
  return NextResponse.json({
    status: 'ok',
    message: 'GhostAgent MCP Server endpoint. Use POST with JSON-RPC 2.0 to access resources/list, resources/read, and tools/list.',
    endpoints: {
      mcp: '/api/mcp'
    }
  }, {
    headers: {
      'Access-Control-Allow-Origin': '*',
    }
  });
}
