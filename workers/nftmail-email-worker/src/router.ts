/// <reference types="@cloudflare/workers-types" />
/**
 * @module router
 * Hono-based HTTP router for nftmail-email-worker.
 *
 * Anti-Panopticon Rule 1: Hono runs on Cloudflare Workers, Bun, Node, and Deno
 * with almost no changes. This file is the portable routing layer.
 *
 * The heavy business logic (handleMailgunPayload, action dispatch) remains in
 * index.ts — this file is purely routing + middleware: CORS, auth guard, and
 * delegation to the handlers already defined there.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './index';
import { AgentMemoryStore } from './memory';

// These are passed in from index.ts to avoid circular deps
export interface RouterHandlers {
  handlePublicAgent(agentName: string, env: Env, req: Request): Promise<Response>;
  handleMailgunWebhook(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  handleJsonPost(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
}

export function createApp(handlers: RouterHandlers) {
  const app = new Hono<{ Bindings: Env }>();

  // ── CORS ────────────────────────────────────────────────────────────────────
  app.use('*', cors({
    origin: (origin) => origin || '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Worker-Secret'],
    exposeHeaders: [],
    maxAge: 86400,
    credentials: false,
  }));

  // ── Auth middleware (highly secure, no global multipart bypasses) ────────────
  app.use('*', async (c, next) => {
    const path = c.req.path;
    const method = c.req.method;

    // 1. Bypass auth for public GET endpoints
    if (method === 'GET' && (path === '/health' || path.startsWith('/public/agent/'))) {
      await next();
      return;
    }

    // 2. Bypass WORKER_SECRET check for Mailgun direct webhooks on /mailgun
    if (method === 'POST' && path === '/mailgun') {
      await next();
      return;
    }

    // 3. Bypass WORKER_SECRET check for Mailgun fallback webhooks on POST /
    if (method === 'POST' && path === '/') {
      const contentType = c.req.header('content-type') || '';
      const isMultipart = contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded');
      if (isMultipart) {
        await next();
        return;
      }
    }

    // 4. Bypass auth for public agent lookup actions (resolveAddress, getBeacon, getMoltPath)
    // getAgentProfile is NOT public - it requires auth for mini app sign-in flow
    // kvGet is NOT public - it requires auth to prevent reading private inbox data
    if (method === 'POST' && path === '/') {
      try {
        const clonedReq = c.req.raw.clone();
        const body = await clonedReq.json().catch(() => ({})) as { action?: string };
        const publicActions = ['resolveAddress', 'getBeacon', 'getMoltPath'];
        if (body.action && publicActions.includes(body.action)) {
          await next();
          return;
        }
      } catch {
        // If JSON parse fails, continue to auth check
      }
    }

    // 5. For everything else (including POST /mcp, POST / with JSON, etc.), require WORKER_SECRET
    const workerSecret = c.env.WORKER_SECRET;
    if (workerSecret) {
      const provided = c.req.header('X-Worker-Secret');
      const authHeader = c.req.header('Authorization') || '';
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (provided !== workerSecret && bearerToken !== workerSecret) {
        return c.json(
          { error: 'Unauthorized - Invalid or missing X-Worker-Secret header' },
          401
        );
      }
    }
    await next();
  });

  // ── Public routes (no auth) ──────────────────────────────────────────────────
  // GET /public/agent/:name — read-only agent metadata for notapaperclip.red
  app.get('/public/agent/:name', async (c) => {
    const agentName = (c.req.param('name') || '').replace(/[^a-z0-9.-]/g, '');
    if (!agentName) {
      return c.json({ error: 'Missing agent name' }, 400);
    }
    return handlers.handlePublicAgent(agentName, c.env, c.req.raw);
  });

  // ── Mailgun inbound webhook ──────────────────────────────────────────────────
  // POST /mailgun — Mailgun store(notify=...) posts here
  app.post('/mailgun', async (c) => {
    // @ts-ignore
    return handlers.handleMailgunWebhook(c.req.raw, c.env, (c as any).executionCtx ?? { waitUntil: () => {} });
  });

  // ── Main action-dispatch endpoint ────────────────────────────────────────────
  // POST / — authenticated JSON actions, with multipart fallback for Mailgun
  // (Mailgun routes may POST to / instead of /mailgun — handle both)
  app.post('/', async (c) => {
    const contentType = c.req.header('content-type') || '';
    if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
      console.log('[router] multipart/urlencoded at POST / — delegating to mailgun handler');
      // @ts-ignore
      return handlers.handleMailgunWebhook(c.req.raw, c.env, (c as any).executionCtx ?? { waitUntil: () => {} });
    }
    // @ts-ignore ctx is available on Cloudflare but not in Hono's generic context
    return handlers.handleJsonPost(c.req.raw, c.env, (c as any).executionCtx ?? { waitUntil: () => {} });
  });

  // ── MCP resources (Anamnesis generic-mcp compatible) ─────────────────────────
  app.post('/mcp', async (c) => {
    if (!c.env.NFTMAIL_DB) return c.json({ error: 'NFTMAIL_DB is not configured' }, 503);
    const body = await c.req.json().catch(() => ({})) as { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
    const method = body.method || '';
    const params = body.params || {};
    const memoryStore = new AgentMemoryStore(c.env.NFTMAIL_DB);

    const isJsonRpc = body.jsonrpc === '2.0' || body.id !== undefined;
    const reqId = body.id !== undefined ? body.id : null;

    const sendResult = (result: any) => {
      if (isJsonRpc) {
        return c.json({ jsonrpc: '2.0', id: reqId, result });
      }
      return c.json(result);
    };

    const sendError = (code: number, message: string, status = 400) => {
      if (isJsonRpc) {
        return c.json({ jsonrpc: '2.0', id: reqId, error: { code, message } }, status);
      }
      return c.json({ error: message }, status);
    };

    if (method === 'resources/list') {
      const agent = params.agent || params.agentLabel ? String(params.agent || params.agentLabel).toLowerCase() : null;
      const records = await memoryStore.listRecords(agent, Number(params.limit || 50));
      return sendResult({ resources: records.map(r => ({
        uri: `ghostagent://memory/${encodeURIComponent(r.agent_label)}/${encodeURIComponent(r.id)}`,
        name: `${r.agent_label}:${r.source}:${r.id}`,
        description: `${r.kind || 'memory'} ${r.scope} memory from ${r.source}`,
        mimeType: 'application/json',
      })) });
    }

    if (method === 'resources/read') {
      const uri = String(params.uri || '');
      const match = uri.match(/^ghostagent:\/\/memory\/([^/]+)\/([^/]+)$/);
      if (!match) return sendError(-32602, 'Invalid or missing params.uri');
      const recordId = decodeURIComponent(match[2]);
      const record = await memoryStore.getRecord(recordId);
      if (!record) return sendError(-32603, 'Memory record not found', 404);
      const chunks = await memoryStore.getChunks(recordId);
      return sendResult({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ record, chunks }, null, 2) }] });
    }

    if (method === 'tools/list') {
      return sendResult({ tools: [{
        name: 'search_agent_memory',
        description: 'Search a GhostAgent long-term memory by full-text query',
        inputSchema: { type: 'object', properties: { agent_label: { type: 'string' }, query: { type: 'string' }, limit: { type: 'number' } }, required: ['agent_label', 'query'] },
      }] });
    }

    if (method === 'tools/call' && params.name === 'search_agent_memory') {
      const args = (params.arguments || {}) as Record<string, unknown>;
      const agent = String(args.agent_label || args.agentLabel || '').toLowerCase();
      const query = String(args.query || '');
      if (!agent || !query) return sendError(-32602, 'Missing agent_label or query');
      const rows = await memoryStore.search(agent, query, Number(args.limit || 10));
      return sendResult({ content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] });
    }

    return sendError(-32601, `Unsupported MCP method: ${method}`);
  });

  // ── Health / canary ───────────────────────────────────────────────────────────
  app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }));

  // ── 404 fallback ──────────────────────────────────────────────────────────────
  app.all('*', (c) => c.json({ error: 'Not found' }, 404));

  return app;
}
