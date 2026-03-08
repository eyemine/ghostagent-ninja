/// x402 server-side payment gate helper for Next.js 14 route handlers
/// Since @x402/next requires Next 16+, we implement the 402 handshake
/// directly using @x402/core/server + @x402/evm/exact/server.
///
/// Usage in a route handler:
///   const gate = createX402Gate({ price: '$0.001', path: '/api/x402/deliver' });
///   const result = await gate.handle(request);
///   if (result.type === 'payment-required') return result.response;
///   // else proceed — result.type === 'paid'

import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { x402HTTPResourceServer } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { NextRequest, NextResponse } from 'next/server';

// ─── Config ───────────────────────────────────────────────────────────────────

// Treasury wallet that receives x402 payments (Base Sepolia testnet)
export const X402_PAY_TO =
  (process.env.X402_PAY_TO_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`;

// Base Sepolia — testnet; switch to 'eip155:8453' for mainnet Base
export const X402_NETWORK = (process.env.X402_NETWORK ?? 'eip155:84532') as string;

// Coinbase CDP facilitator (no signup needed for x402.org testnet)
export const X402_FACILITATOR_URL =
  process.env.X402_FACILITATOR_URL ?? 'https://x402.org/facilitator';

// USDC on Base Sepolia
export const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
// USDC on Base mainnet
export const USDC_BASE_MAINNET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// ─── Gate ─────────────────────────────────────────────────────────────────────

export interface X402GateConfig {
  price: string;       // e.g. '$0.001'
  path: string;        // route path, e.g. '/api/x402/deliver'
  method?: string;     // default 'POST'
  description?: string;
  mimeType?: string;
}

export type X402GateResult =
  | { type: 'payment-required'; response: NextResponse }
  | { type: 'paid' };

/**
 * Create a reusable x402 gate for a specific route + price.
 * Lazily initialises the x402HTTPResourceServer on first call.
 * Call gate.handle(request) in your route handler.
 */
export function createX402Gate(config: X402GateConfig) {
  const {
    price,
    path,
    method = 'POST',
    description = 'GhostAgent x402 gated endpoint',
    mimeType = 'application/json',
  } = config;

  const routeKey = `${method} ${path}`;
  const routesConfig = {
    [routeKey]: {
      accepts: [{
        scheme: 'exact' as const,
        price,
        network: X402_NETWORK,
        payTo: X402_PAY_TO,
      }],
      description,
      mimeType,
    },
  };

  // Lazily initialised — one per gate instance
  let _httpServer: x402HTTPResourceServer | null = null;
  let _initPromise: Promise<void> | null = null;

  async function getHttpServer(): Promise<x402HTTPResourceServer> {
    if (_httpServer) return _httpServer;
    if (!_initPromise) {
      _initPromise = (async () => {
        const facilitator = new HTTPFacilitatorClient({ url: X402_FACILITATOR_URL });
        const resourceServer = new x402ResourceServer(facilitator);
        resourceServer.register(X402_NETWORK as `${string}:${string}`, new ExactEvmScheme());
        _httpServer = new x402HTTPResourceServer(resourceServer, routesConfig as Record<string, any>);
        await _httpServer.initialize();
      })();
    }
    await _initPromise;
    return _httpServer!;
  }

  return {
    async handle(request: NextRequest): Promise<X402GateResult> {
      try {
        const httpServer = await getHttpServer();

        const adapter = {
          getHeader: (name: string) => request.headers.get(name) ?? undefined,
          getMethod: () => request.method,
          getPath: () => new URL(request.url).pathname,
          getUrl: () => request.url,
          getAcceptHeader: () => request.headers.get('Accept') ?? '*/*',
          getUserAgent: () => request.headers.get('User-Agent') ?? '',
        };

        const context = {
          adapter,
          path: new URL(request.url).pathname,
          method: request.method,
          paymentHeader:
            request.headers.get('X-PAYMENT') ??
            request.headers.get('PAYMENT-SIGNATURE') ??
            undefined,
        };

        const result = await httpServer.processHTTPRequest(context);

        if (result.type === 'payment-error') {
          const { status, headers, body } = result.response;
          return {
            type: 'payment-required',
            response: new NextResponse(
              body !== undefined ? JSON.stringify(body) : undefined,
              { status, headers: { 'Content-Type': 'application/json', ...headers } },
            ),
          };
        }

        // 'no-payment-required' or 'payment-verified' — both allow access
        return { type: 'paid' };
      } catch (err: any) {
        return {
          type: 'payment-required',
          response: NextResponse.json(
            { error: 'x402 gate error', detail: err?.message },
            { status: 402 },
          ),
        };
      }
    },
  };
}
