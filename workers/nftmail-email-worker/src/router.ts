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

  // ── Auth middleware (skip Mailgun multipart webhooks) ────────────────────────
  app.use('/mailgun', async (c, next) => {
    // Mailgun inbound webhooks are multipart — bypass secret check, they have HMAC
    await next();
  });

  app.use('*', async (c, next) => {
    const contentType = c.req.header('content-type') || '';
    const isMultipart = contentType.includes('multipart/form-data');
    if (isMultipart) {
      await next();
      return;
    }

    const workerSecret = c.env.WORKER_SECRET;
    if (workerSecret) {
      const provided = c.req.header('X-Worker-Secret');
      if (provided !== workerSecret) {
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

  // ── Health / canary ───────────────────────────────────────────────────────────
  app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }));

  // ── 404 fallback ──────────────────────────────────────────────────────────────
  app.all('*', (c) => c.json({ error: 'Not found' }, 404));

  return app;
}
