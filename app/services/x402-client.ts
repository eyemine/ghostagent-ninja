/// x402 buyer/client — wraps fetch to auto-pay 402 responses
/// Used by GhostAgents to call x402-gated endpoints (A2A delivery, data APIs, etc.)
///
/// Usage:
///   const fetchWithPayment = createX402Fetch(process.env.AGENT_PRIVATE_KEY!);
///   const res = await fetchWithPayment('https://nftmail.box/api/x402/deliver', { ... });

import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';
import { createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a fetch wrapper that automatically handles x402 payment challenges.
 * Pass the agent's EVM private key (hex string with 0x prefix).
 *
 * The returned fetch is a drop-in replacement for the global fetch.
 * On a 402 response it will sign + submit the USDC payment on Base Sepolia,
 * then retry the original request automatically.
 */
export function createX402Fetch(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);
  // toClientEvmSigner composes account + publicClient to satisfy ClientEvmSigner.readContract
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });
  const signer = toClientEvmSigner(account, publicClient);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer });
  return wrapFetchWithPayment(fetch, client);
}

// ─── Singleton for server-side agent actions ──────────────────────────────────

let _agentFetch: ReturnType<typeof wrapFetchWithPayment> | null = null;

/**
 * Get the singleton x402-enabled fetch for server-side usage.
 * Uses AGENT_PRIVATE_KEY env var (falls back to TREASURY_PRIVATE_KEY).
 * Returns plain fetch if no key is configured (endpoints without payment gate still work).
 */
export function getAgentFetch(): typeof fetch {
  if (_agentFetch) return _agentFetch as unknown as typeof fetch;

  const key =
    (process.env.AGENT_PRIVATE_KEY ?? process.env.TREASURY_PRIVATE_KEY) as
    `0x${string}` | undefined;

  if (!key) {
    return fetch;
  }

  _agentFetch = createX402Fetch(key);
  return _agentFetch as unknown as typeof fetch;
}

// ─── Helper: A2A message delivery via x402 ───────────────────────────────────

export interface A2ADeliveryPayload {
  fromAgent:  string;
  toAgent:    string;
  subject:    string;
  body:       string;
  agentId?:   number;
}

/**
 * Send an A2A message to another GhostAgent's x402-gated inbox.
 * The sending agent pays $0.001 USDC per delivery automatically.
 */
export async function deliverA2AMessage(
  payload: A2ADeliveryPayload,
  baseUrl = 'https://nftmail.box',
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const agentFetch = getAgentFetch();

  try {
    const res = await agentFetch(`${baseUrl}/api/x402/deliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      return { success: true, txHash: data.txHash as string | undefined };
    }

    const err = await res.json().catch(() => ({ error: res.statusText })) as Record<string, unknown>;
    return { success: false, error: String(err.error ?? res.status) };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Network error' };
  }
}
