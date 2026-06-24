/// x402 buyer/client — wraps fetch to auto-pay 402 responses
/// Used by GhostAgents to call x402-gated endpoints (A2A delivery, data APIs, etc.)
///
/// Usage:
///   const fetchWithPayment = createX402Fetch(process.env.AGENT_PRIVATE_KEY!);
///   const res = await fetchWithPayment('https://nftmail.box/api/x402/deliver', { ... });
///
/// Safe-aware usage (respects DailyBudgetModule + HumanInTheLoopModule on-chain):
///   const fetchWithPayment = createSafeAwareX402Fetch(process.env.AGENT_PRIVATE_KEY!, {
///     safeAddress:        '0x...',
///     dailyBudgetModule:  process.env.NEXT_PUBLIC_DAILY_BUDGET_MODULE as `0x${string}`,
///     hitlModule:         process.env.NEXT_PUBLIC_HITL_MODULE as `0x${string}`,
///   });

import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';
import { createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, gnosis } from 'viem/chains';
import { recordSpend } from './budget-tracker';
import { packSpendWitness, deriveSpendNonce, type SpendWitnessInputs } from './spend-witness';

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

// ─── Safe Module ABIs (minimal view-only) ────────────────────────────────────

const DAILY_BUDGET_ABI = [
  { name: 'remainingToday', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'dailyCap',       type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'paused',         type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool'    }] },
] as const;

const HITL_ABI = [
  { name: 'threshold',       type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'emergencyPaused', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool'    }] },
] as const;

// ─── Safe-aware pre-authorization ────────────────────────────────────────────

export interface SafeModuleConfig {
  safeAddress:       `0x${string}`;
  agentName?:        string;                // for KV spend recording after payment
  dailyBudgetModule?: `0x${string}`;       // DailyBudgetModule address (skip check if omitted)
  hitlModule?:        `0x${string}`;       // HumanInTheLoopModule address (skip check if omitted)
  cursorId?:          `0x${string}`;       // ERC-1833 cursor address (when deployed)
  agentPrivateKey?:   `0x${string}`;       // agent execution key for BIP-340 witness signing
  gnosisRpc?:         string;
}

export interface PreAuthResult {
  approved:      boolean;
  hitlRequired?: boolean;
  reason?:       string;
  remainingWei?: bigint;
  thresholdWei?: bigint;
}

/**
 * Read DailyBudgetModule.remainingToday() and HumanInTheLoopModule.threshold()
 * from Gnosis chain to determine whether a given spend (in wei) is auto-approvable.
 *
 * Non-fatal: on any RPC error returns { approved: true } so payments aren't
 * blocked by an unavailable RPC — log the warning and proceed.
 */
export async function readSafeModules(
  amountWei: bigint,
  config: SafeModuleConfig,
): Promise<PreAuthResult> {
  const rpc = config.gnosisRpc ?? process.env.NEXT_PUBLIC_GNOSIS_RPC ?? 'https://rpc.gnosischain.com';
  const gnosisClient = createPublicClient({ chain: gnosis, transport: http(rpc) });

  let remainingWei: bigint | undefined;
  let thresholdWei: bigint | undefined;
  let budgetPaused  = false;
  let hitlPaused    = false;

  try {
    if (config.dailyBudgetModule) {
      [remainingWei, budgetPaused] = await Promise.all([
        gnosisClient.readContract({ address: config.dailyBudgetModule, abi: DAILY_BUDGET_ABI, functionName: 'remainingToday' }),
        gnosisClient.readContract({ address: config.dailyBudgetModule, abi: DAILY_BUDGET_ABI, functionName: 'paused' }),
      ]);
    }
    if (config.hitlModule) {
      [thresholdWei, hitlPaused] = await Promise.all([
        gnosisClient.readContract({ address: config.hitlModule, abi: HITL_ABI, functionName: 'threshold' }),
        gnosisClient.readContract({ address: config.hitlModule, abi: HITL_ABI, functionName: 'emergencyPaused' }),
      ]);
    }
  } catch (err) {
    console.warn('[x402] Safe module read failed (non-fatal, allowing payment):', err);
    return { approved: true, remainingWei, thresholdWei };
  }

  // Emergency paused on either module → hard block
  if (budgetPaused)  return { approved: false, reason: 'DailyBudgetModule: agent paused — budget exhausted', remainingWei: 0n };
  if (hitlPaused)    return { approved: false, reason: 'HumanInTheLoopModule: emergency paused', thresholdWei };

  // Amount exceeds HITL threshold → queue for human approval
  if (thresholdWei !== undefined && amountWei > thresholdWei) {
    return { approved: false, hitlRequired: true, reason: `Payment (${amountWei} wei) exceeds HITL threshold (${thresholdWei} wei)`, thresholdWei, remainingWei };
  }

  // Amount exceeds daily remaining → block
  if (remainingWei !== undefined && amountWei > remainingWei) {
    return { approved: false, reason: `Payment (${amountWei} wei) exceeds DailyBudgetModule remaining (${remainingWei} wei)`, remainingWei, thresholdWei };
  }

  return { approved: true, remainingWei, thresholdWei };
}

/**
 * Safe-aware x402 fetch.
 *
 * Before auto-paying a 402, reads DailyBudgetModule.remainingToday() and
 * HumanInTheLoopModule.threshold() on Gnosis. If the payment is within budget
 * and below the HITL threshold, delegates to the standard x402 fetch.
 * If HITL is required, returns a 402 response with x-hitl-required: true header
 * for the caller to surface to the Safe owner.
 *
 * Amount detection: reads X-Payment-Amount header (xDAI wei) from the 402.
 * If the header is missing, falls back to 0 (module check runs with 0 wei,
 * which passes unless the module is paused).
 */
export function createSafeAwareX402Fetch(
  privateKey: `0x${string}`,
  safeConfig: SafeModuleConfig,
): typeof fetch {
  const baseX402Fetch = createX402Fetch(privateKey);

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;

    // Probe without payment to detect 402
    const probe = await fetch(url, init);
    if (probe.status !== 402) return probe;

    // Extract payment amount from 402 headers (wei)
    const amountHeader = probe.headers.get('x-payment-amount') ?? probe.headers.get('x-payment-required');
    let amountWei = 0n;
    try {
      if (amountHeader) amountWei = BigInt(amountHeader.includes('{') ? '0' : amountHeader);
    } catch { /* non-fatal: proceed with 0 */ }

    // Gate through Safe modules
    const preAuth = await readSafeModules(amountWei, safeConfig);

    if (!preAuth.approved) {
      if (preAuth.hitlRequired) {
        // Surface to caller — they must propose a Safe tx
        const headers = new Headers({ 'content-type': 'application/json', 'x-hitl-required': 'true' });
        if (preAuth.thresholdWei !== undefined) headers.set('x-hitl-threshold', preAuth.thresholdWei.toString());
        return new Response(JSON.stringify({ error: 'HITL_REQUIRED', reason: preAuth.reason, safeAddress: safeConfig.safeAddress }), { status: 402, headers });
      }
      return new Response(JSON.stringify({ error: 'BUDGET_EXCEEDED', reason: preAuth.reason, remaining: preAuth.remainingWei?.toString() }), { status: 402, headers: { 'content-type': 'application/json' } });
    }

    // Pre-auth passed — construct the spend witness for advanceCursor bundling.
    // When the ERC-1833 cursor is deployed, this calldata slots into the Safe tx bundle:
    //   [advanceCursor(witness), DailyBudgetModule.execTransaction(), actualPayment]
    if (safeConfig.cursorId && safeConfig.agentPrivateKey && amountWei > 0n) {
      try {
        const sessionId = probe.headers.get('x-payment-session') ?? Date.now().toString();
        const payeeAddr = probe.headers.get('x-payment-destination') ?? '0x0000000000000000000000000000000000000000';
        const nonce     = deriveSpendNonce(safeConfig.safeAddress, payeeAddr, amountWei.toString(), sessionId);
        const inputs: SpendWitnessInputs = {
          cursorId:    safeConfig.cursorId,
          safeAddress: safeConfig.safeAddress,
          payee:       payeeAddr,
          amountWei:   amountWei.toString(),
          nonce,
          chainId:     '100',
        };
        const witness = packSpendWitness(inputs, safeConfig.agentPrivateKey);
        console.log('[x402] spend witness ready for advanceCursor:', {
          artifactHash: witness.artifactHash,
          px:           witness.px,
          calldataLen:  witness.calldata.length,
        });
      } catch (err) {
        console.warn('[x402] witness construction failed (non-fatal):', err);
      }
    }

    // Delegate to x402 fetch (it will re-request and auto-pay)
    const result = await baseX402Fetch(input, init);

    // Post-payment: sync KV budget tracker so dashboard stays current
    if (result.ok && safeConfig.agentName && amountWei > 0n) {
      const amountXdai = Number(amountWei) / 1e18;
      recordSpend(safeConfig.agentName, amountXdai).catch(err =>
        console.warn('[x402] KV budget sync failed (non-fatal):', err),
      );
    }

    return result;
  };
}

// ─── Singleton for server-side agent actions ──────────────────────────────────

let _agentFetch: ReturnType<typeof wrapFetchWithPayment> | null = null;

/**
 * Get the singleton x402-enabled fetch for server-side usage.
 * Uses AGENT_PRIVATE_KEY env var (falls back to TREASURY_PRIVATE_KEY).
 * When AGENT_SAFE_ADDRESS is set, upgrades to Safe-aware mode: reads
 * DailyBudgetModule.remainingToday() and HumanInTheLoopModule.threshold()
 * before auto-paying any 402 response.
 * Returns plain fetch if no key is configured.
 */
export function getAgentFetch(): typeof fetch {
  if (_agentFetch) return _agentFetch as unknown as typeof fetch;

  const key =
    (process.env.AGENT_PRIVATE_KEY ?? process.env.TREASURY_PRIVATE_KEY) as
    `0x${string}` | undefined;

  if (!key) return fetch;

  const safeAddress = process.env.AGENT_SAFE_ADDRESS as `0x${string}` | undefined;
  const dailyBudgetModule = process.env.NEXT_PUBLIC_DAILY_BUDGET_MODULE as `0x${string}` | undefined;
  const hitlModule = process.env.NEXT_PUBLIC_HITL_MODULE as `0x${string}` | undefined;

  if (safeAddress && (dailyBudgetModule || hitlModule)) {
    // Safe-aware: gates payments through on-chain modules
    _agentFetch = createSafeAwareX402Fetch(key, {
      safeAddress,
      dailyBudgetModule,
      hitlModule,
      agentName: process.env.AGENT_NAME,
    }) as unknown as ReturnType<typeof wrapFetchWithPayment>;
    return _agentFetch as unknown as typeof fetch;
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
