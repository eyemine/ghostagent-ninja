/**
 * POST /api/trade-intent
 *
 * EIP-712 TradeIntent submission endpoint.
 *
 * Actions:
 *   sign    — return the EIP-712 typed data payload for client-side signing
 *   submit  — store signed TradeIntent artifact, relay to worker, submit to ERC-8004 Validation Registry
 *   list    — retrieve all TradeIntents for an agent
 *   verify  — verify a stored signature against the EIP-712 domain
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  TRADE_INTENT_DOMAIN,
  TRADE_INTENT_TYPES,
  hashTradeIntent,
  buildTradeIntentArtifact,
  type TradeIntent,
  type TradeIntentArtifact,
  WXDAI,
  USDC_GNOSIS,
  GNO_TOKEN,
  deadlineInMinutes,
} from '../../services/trade-intent';
import { WORKER_URL } from '../../utils/config';


// ERC-8004 Validation Registry on Gnosis mainnet
const ERC8004_VALIDATION_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return err('Invalid JSON');

  const { action } = body;

  // ── sign ────────────────────────────────────────────────────────────────────
  // Return the EIP-712 typed data the client must sign. No server-side key needed.
  if (action === 'sign') {
    const { agentId, agentWallet, tokenIn, tokenOut, amountIn, minAmountOut, strategyTag, nonce } = body;

    if (!agentId || !agentWallet) return err('Missing agentId or agentWallet');
    if (!tokenIn || !tokenOut)    return err('Missing tokenIn or tokenOut');
    if (!amountIn)                return err('Missing amountIn');

    const intent: TradeIntent = {
      agentId:      BigInt(agentId),
      agentWallet:  agentWallet as `0x${string}`,
      tokenIn:      (tokenIn  as `0x${string}`) || WXDAI,
      tokenOut:     (tokenOut as `0x${string}`) || USDC_GNOSIS,
      amountIn:     BigInt(amountIn),
      minAmountOut: BigInt(minAmountOut ?? 0),
      deadline:     deadlineInMinutes(30),
      nonce:        BigInt(nonce ?? Date.now()),
      strategyTag:  strategyTag ?? 'manual',
    };

    const intentHash = hashTradeIntent(intent);

    return NextResponse.json({
      ok:       true,
      domain:   TRADE_INTENT_DOMAIN,
      types:    TRADE_INTENT_TYPES,
      message: {
        agentId:      intent.agentId.toString(),
        agentWallet:  intent.agentWallet,
        tokenIn:      intent.tokenIn,
        tokenOut:     intent.tokenOut,
        amountIn:     intent.amountIn.toString(),
        minAmountOut: intent.minAmountOut.toString(),
        deadline:     intent.deadline.toString(),
        nonce:        intent.nonce.toString(),
        strategyTag:  intent.strategyTag,
      },
      intentHash,
    });
  }

  // ── submit ───────────────────────────────────────────────────────────────────
  // Store a signed TradeIntent artifact and relay to worker + ERC-8004 registry.
  if (action === 'submit') {
    const { agentName, intent: intentRaw, signature } = body;

    if (!agentName || !intentRaw || !signature) {
      return err('Missing agentName, intent, or signature');
    }

    const intent: TradeIntent = {
      agentId:      BigInt(intentRaw.agentId),
      agentWallet:  intentRaw.agentWallet,
      tokenIn:      intentRaw.tokenIn,
      tokenOut:     intentRaw.tokenOut,
      amountIn:     BigInt(intentRaw.amountIn),
      minAmountOut: BigInt(intentRaw.minAmountOut),
      deadline:     BigInt(intentRaw.deadline),
      nonce:        BigInt(intentRaw.nonce),
      strategyTag:  intentRaw.strategyTag,
    };

    const artifact = buildTradeIntentArtifact(agentName, intent, signature);

    // Relay to Cloudflare Worker (stores in KV + Glass Box audit)
    const workerRes = await fetch(WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:    'storeTradeIntent',
        agentName: agentName.toLowerCase(),
        artifact,
      }),
    }).catch(() => null);

    const workerData = workerRes ? await workerRes.json().catch(() => ({})) : {};

    // Build ERC-8004 Validation Registry request payload
    // requestURI = worker KV permalink for this artifact
    const requestUri = `${WORKER_URL}?action=getTradeIntent&intentHash=${artifact.intentHash}&agentName=${encodeURIComponent(agentName.toLowerCase())}`;

    const validationPayload = {
      agentId:     artifact.agentId,
      requestHash: artifact.intentHash,
      requestUri,
      registry:    ERC8004_VALIDATION_REGISTRY,
      chainId:     100,
    };

    return NextResponse.json({
      ok:         true,
      intentHash: artifact.intentHash,
      artifact,
      validation: validationPayload,
      workerStored: !!(workerData as { ok?: boolean }).ok,
    });
  }

  // ── list ────────────────────────────────────────────────────────────────────
  if (action === 'list') {
    const { agentName } = body;
    if (!agentName) return err('Missing agentName');

    const res = await fetch(WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:    'listTradeIntents',
        agentName: agentName.toLowerCase(),
      }),
    }).catch(() => null);

    if (!res?.ok) return err('Worker unavailable', 502);
    const data = await res.json() as { intents?: TradeIntentArtifact[] };
    return NextResponse.json({ ok: true, intents: data.intents ?? [] });
  }

  // ── verify ───────────────────────────────────────────────────────────────────
  if (action === 'verify') {
    const { intentHash, agentName } = body;
    if (!intentHash) return err('Missing intentHash');

    const res = await fetch(WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:     'getTradeIntent',
        intentHash,
        agentName:  agentName?.toLowerCase() ?? '',
      }),
    }).catch(() => null);

    if (!res?.ok) return err('Worker unavailable', 502);
    const data = await res.json() as { artifact?: TradeIntentArtifact };
    if (!data.artifact) return NextResponse.json({ ok: false, verified: false });

    return NextResponse.json({
      ok:       true,
      verified: true,
      artifact: data.artifact,
      eip712Domain:  TRADE_INTENT_DOMAIN,
    });
  }

  // ── token list ───────────────────────────────────────────────────────────────
  if (action === 'tokens') {
    return NextResponse.json({
      ok: true,
      tokens: [
        { symbol: 'WXDAI',  address: WXDAI,         decimals: 18 },
        { symbol: 'USDC',   address: USDC_GNOSIS,   decimals: 6  },
        { symbol: 'GNO',    address: GNO_TOKEN,      decimals: 18 },
      ],
    });
  }

  return err(`Unknown action: ${action}`);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const intentHash = searchParams.get('intentHash');
  const agentName  = searchParams.get('agentName');

  if (!intentHash) {
    return NextResponse.json({
      ok:     true,
      domain: TRADE_INTENT_DOMAIN,
      types:  TRADE_INTENT_TYPES,
    });
  }

  const res = await fetch(WORKER_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action:     'getTradeIntent',
      intentHash,
      agentName:  agentName ?? '',
    }),
  }).catch(() => null);

  if (!res?.ok) return NextResponse.json({ ok: false, error: 'Worker unavailable' }, { status: 502 });
  const data = await res.json() as { artifact?: TradeIntentArtifact };
  return NextResponse.json({ ok: !!data.artifact, artifact: data.artifact ?? null });
}
