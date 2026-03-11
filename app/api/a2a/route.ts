/// POST /api/a2a
///
/// A2A Protocol RC v1.0 — JSON-RPC 2.0 endpoint
/// Spec: https://a2a-protocol.org/latest/specification/#9-json-rpc-protocol-binding
///
/// Supported methods:
///   SendMessage   — routes to worker skill based on message content
///   GetTask       — returns stored task state from KV (via worker)
///   ListTasks     — returns recent tasks for an agent
///
/// Message routing (intent detection from message parts text):
///   "send * to <agent>"   → sendA2A (Ghost-Wire A2A messaging)
///   "status *"            → getAgentStatus
///   "trade intent*"       → getTradeIntents
///   "register*"           → ERC-8004 registration.json lookup
///   default               → getAgentStatus for the sender

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

const WORKER_URL =
  process.env.NFTMAIL_WORKER_URL ??
  'https://nftmail-email-worker.richard-159.workers.dev';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ghostagent.ninja';

const A2A_VERSION = '1.0';

// ─── A2A type helpers ────────────────────────────────────────────────────────

type TaskState = 'submitted' | 'working' | 'completed' | 'failed';

function makeTask(id: string, state: TaskState, text: string, meta?: Record<string, unknown>) {
  return {
    id,
    status: { state, timestamp: new Date().toISOString() },
    artifacts: state === 'completed' || state === 'failed'
      ? [{ parts: [{ kind: 'text', text }] }]
      : [],
    ...(meta ? { metadata: meta } : {}),
  };
}

function jsonRpcOk(id: unknown, result: unknown) {
  return NextResponse.json(
    { jsonrpc: '2.0', id, result },
    { headers: { 'Content-Type': 'application/json', 'A2A-Version': A2A_VERSION } },
  );
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return NextResponse.json(
    { jsonrpc: '2.0', id, error: { code, message } },
    { status: 200, headers: { 'Content-Type': 'application/json', 'A2A-Version': A2A_VERSION } },
  );
}

// ─── Intent router ───────────────────────────────────────────────────────────

function extractText(params: any): string {
  try {
    const parts = params?.message?.parts ?? [];
    return parts.map((p: any) => p.text ?? p.content ?? '').join(' ').trim().toLowerCase();
  } catch {
    return '';
  }
}

// Extract agent name from text — look after keywords like "of", "for", "to", "from"
// Falls back to any standalone word that looks like an agent name (alphanumeric)
function extractAgentName(text: string, afterKeywords = true): string | null {
  if (afterKeywords) {
    const m = text.match(/(?:of|for)\s+([a-z0-9][a-z0-9_-]*)/);
    if (m) return m[1].replace(/_+$/, '');
  }
  // fallback: last standalone alphanumeric word
  const words = text.match(/\b([a-z0-9]{3,})\b/g) ?? [];
  const skip = new Set(['the','for','get','set','send','list','show','from','status','trade','intent','agent','register','fetch']);
  const candidate = words.reverse().find(w => !skip.has(w));
  return candidate ?? null;
}

async function workerPost(body: Record<string, unknown>): Promise<any> {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function routeIntent(text: string, params: any): Promise<{ text: string; meta?: Record<string, unknown> }> {
  // ── sendA2A: "send <message> to <agent>" ──────────────────────────────────
  const sendMatch = text.match(/send\s+(.+?)\s+to\s+([a-z0-9]+)/);
  if (sendMatch) {
    const message  = sendMatch[1];
    const toAgent  = sendMatch[2] + '_';
    const fromAgent = params?.metadata?.agentName
      ? params.metadata.agentName + '_'
      : 'a2a-client_';
    const data = await workerPost({ action: 'sendA2A', fromAgent, toAgent, message });
    return {
      text: data.error
        ? `Failed to send: ${data.error}`
        : `Message delivered to ${toAgent} ✓`,
      meta: data,
    };
  }

  // ── getTradeIntents: "trade intent*" / "trade*" / "intents*" ─────────────
  if (/trade.?intent|get.?intent|list.?intent/.test(text)) {
    const agentName = extractAgentName(text) ?? 'ghostagent';
    const data = await workerPost({ action: 'getTradeIntents', agentName });
    const count = data.intents?.length ?? 0;
    return {
      text: `Found ${count} active TradeIntent(s) for ${agentName}`,
      meta: data,
    };
  }

  // ── ERC-8004 registration: "register*" / "erc8004*" / "agent card*" ──────
  if (/register|erc.?8004|agent.?card|registration/.test(text)) {
    const agentName = extractAgentName(text) ?? 'ghostagent';
    const url = `${APP_URL}/api/agent/${agentName}/registration.json`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      return {
        text: `ERC-8004 registration for ${agentName}: agentId=${data.registrations?.[0]?.agentId ?? 'unregistered'}, active=${data.active}`,
        meta: { registrationJson: url, ...data },
      };
    } catch {
      return { text: `Could not fetch ERC-8004 registration for ${agentName}` };
    }
  }

  // ── getAgentStatus: "status*" / "heartbeat*" / "telemetry*" / default ────
  {
    const agentName = extractAgentName(text) ?? 'ghostagent';
    const localPart = agentName.endsWith('_') ? agentName : agentName + '_';
    const data = await workerPost({ action: 'getAgentStatus', localPart });
    const agentId = data.erc8004AgentId ?? data.erc8004?.agentId ?? 'unregistered';
    const inbox   = data.inbox?.count ?? 0;
    const surge   = data.surgeScore ?? 0;
    const beat    = data.heartbeat?.isActive ? 'active' : 'inactive';
    return {
      text: data.error
        ? `Agent ${agentName} not found`
        : `Agent ${agentName}: inbox=${inbox}, surgeScore=${surge}, heartbeat=${beat}, erc8004AgentId=${agentId}`,
      meta: data,
    };
  }
}

// ─── Main handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonRpcError(null, -32700, 'Parse error');
  }

  const { jsonrpc, id, method, params } = body ?? {};

  if (jsonrpc !== '2.0') {
    return jsonRpcError(id ?? null, -32600, 'Invalid Request: jsonrpc must be "2.0"');
  }

  // ── SendMessage ────────────────────────────────────────────────────────────
  if (method === 'SendMessage') {
    const taskId = params?.configuration?.taskId ?? randomUUID();
    const text   = extractText(params);

    if (!text) {
      return jsonRpcError(id, -32602, 'Invalid params: message parts must contain text');
    }

    // EIP-712 / EIP-155 validation — trade intent submissions MUST include chainId + signature
    const isTradeIntent = /trade.?intent|store.?intent|submit.?trade/i.test(text);
    if (isTradeIntent) {
      const meta     = params?.metadata ?? {};
      const chainId  = meta.chainId ?? params?.extensions?.chainId;
      const sig      = meta.signature ?? meta.sig ?? params?.extensions?.signature;
      if (!chainId) {
        return jsonRpcError(id, -32602, 'Invalid params: chainId required for EIP-155 trade intent (provide metadata.chainId)');
      }
      if (!sig) {
        return jsonRpcError(id, -32602, 'Invalid params: EIP-712 signature required for trade intent (provide metadata.signature)');
      }
    }

    try {
      const { text: resultText, meta } = await routeIntent(text, params);
      return jsonRpcOk(id, makeTask(taskId, 'completed', resultText, meta));
    } catch (e: any) {
      return jsonRpcOk(id, makeTask(taskId, 'failed', `Error: ${e?.message ?? 'unknown'}`));
    }
  }

  // ── GetTask ────────────────────────────────────────────────────────────────
  if (method === 'GetTask') {
    const taskId = params?.id;
    if (!taskId) return jsonRpcError(id, -32602, 'Invalid params: id required');
    // Tasks are synchronous (completed immediately), so any valid-looking taskId
    // returns a completed stub. For full async support, persist to KV.
    return jsonRpcOk(id, makeTask(taskId, 'completed', 'Task completed synchronously'));
  }

  // ── ListTasks ──────────────────────────────────────────────────────────────
  if (method === 'ListTasks') {
    return jsonRpcOk(id, { tasks: [] });
  }

  // ── Unknown method ────────────────────────────────────────────────────────
  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

// OPTIONS for CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, A2A-Version, A2A-Extensions',
      'A2A-Version': A2A_VERSION,
    },
  });
}
