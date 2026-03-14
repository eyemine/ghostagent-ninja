/**
 * POST /api/trade/execute
 *
 * Agent-initiated DEX trade execution via CoW Protocol on Gnosis mainnet.
 *
 * Actions:
 *   quote   — get a CoW price quote for a token pair
 *   execute — submit a CoW order (presign scheme — Safe signs on-chain)
 *   status  — poll order status by CoW orderUid
 *   price   — get current xDAI price for a token
 *
 * Security: trades are only submitted after verifying the TradeIntent
 * signature is stored in KV (i.e. the agent signed before calling execute).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getCowQuote,
  executeTrade,
  getCowOrderStatus,
  getTokenPriceInXdai,
  tokenByAddress,
  GNOSIS_TOKENS,
  type ExecuteTradeParams,
} from '../../../services/cow-dex';
import type { Address, Hex } from 'viem';

const WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return err('Invalid JSON');

  const { action } = body;

  // ── quote ────────────────────────────────────────────────────────────────────
  if (action === 'quote') {
    const { sellToken, buyToken, from, sellAmount, kind } = body;
    if (!sellToken || !buyToken || !from || !sellAmount) {
      return err('Missing sellToken, buyToken, from, or sellAmount');
    }

    try {
      const quote = await getCowQuote({
        sellToken:           sellToken as Address,
        buyToken:            buyToken  as Address,
        from:                from      as Address,
        receiver:            (body.receiver ?? from) as Address,
        sellAmountBeforeFee: sellAmount,
        kind:                kind ?? 'sell',
      });

      const inTok  = tokenByAddress(sellToken);
      const outTok = tokenByAddress(buyToken);

      return NextResponse.json({
        ok:      true,
        quote,
        display: {
          sellSymbol: inTok?.symbol  ?? sellToken,
          buySymbol:  outTok?.symbol ?? buyToken,
          sellAmount: (Number(quote.quote.sellAmount) / 10 ** (inTok?.decimals  ?? 18)).toFixed(6),
          buyAmount:  (Number(quote.quote.buyAmount)  / 10 ** (outTok?.decimals ?? 18)).toFixed(6),
          feeAmount:  (Number(quote.quote.feeAmount)  / 10 ** (inTok?.decimals  ?? 18)).toFixed(6),
          validTo:    new Date(quote.quote.validTo * 1000).toISOString(),
          explorerBase: 'https://explorer.cow.fi/gc',
        },
      });
    } catch (e) {
      return err(String(e), 502);
    }
  }

  // ── execute ───────────────────────────────────────────────────────────────────
  if (action === 'execute') {
    const { from, sellToken, buyToken, sellAmount, minBuyAmount, tradeIntentSig, intentHash, agentName } = body;

    if (!from || !sellToken || !buyToken || !sellAmount) {
      return err('Missing from, sellToken, buyToken, or sellAmount');
    }
    if (!tradeIntentSig) {
      return err('Missing tradeIntentSig — agent must sign a TradeIntent before executing');
    }

    // Verify the TradeIntent signature is on record (agent authorised this trade)
    if (intentHash && agentName) {
      const verifyRes = await fetch(WORKER_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getTradeIntent', intentHash, agentName }),
      }).catch(() => null);

      if (!verifyRes?.ok) {
        return err('Could not verify TradeIntent — worker unavailable', 502);
      }
      const verifyData = await verifyRes.json() as { ok: boolean };
      if (!verifyData.ok) {
        return err('TradeIntent not found — sign the intent before executing', 403);
      }
    }

    const params: ExecuteTradeParams = {
      from:           from as Address,
      receiver:       (body.receiver ?? from) as Address,
      sellToken:      sellToken  as Address,
      buyToken:       buyToken   as Address,
      sellAmount,
      minBuyAmount:   minBuyAmount,
      tradeIntentSig: tradeIntentSig as Hex,
      kind:           body.kind ?? 'sell',
    };

    const result = await executeTrade(params);

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }

    // Log to Glass Box via worker
    if (agentName && result.orderUid) {
      await fetch(WORKER_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:    'kvPut',
          ownerAddress: from,
          key:       `coworder:${agentName}:${result.orderUid}`,
          value: {
            orderUid:    result.orderUid,
            agentName,
            from,
            sellToken,
            buyToken,
            sellAmount,
            intentHash:  intentHash ?? null,
            submittedAt: Date.now(),
            explorerUrl: result.explorerUrl,
          },
        }),
      }).catch(() => {});
    }

    return NextResponse.json({
      ok:          true,
      orderUid:    result.orderUid,
      explorerUrl: result.explorerUrl,
      quote:       result.quote,
    });
  }

  // ── status ────────────────────────────────────────────────────────────────────
  if (action === 'status') {
    const { orderUid } = body;
    if (!orderUid) return err('Missing orderUid');

    try {
      const status = await getCowOrderStatus(orderUid);
      return NextResponse.json({
        ok: true,
        ...status,
        explorerUrl: `https://explorer.cow.fi/gc/orders/${orderUid}`,
      });
    } catch (e) {
      return err(String(e), 502);
    }
  }

  // ── price ──────────────────────────────────────────────────────────────────────
  if (action === 'price') {
    const { tokenAddress, safeAddress } = body;
    if (!tokenAddress || !safeAddress) return err('Missing tokenAddress or safeAddress');

    try {
      const price = await getTokenPriceInXdai(tokenAddress as Address, safeAddress as Address);
      const tok   = tokenByAddress(tokenAddress);
      return NextResponse.json({ ok: true, token: tok?.symbol ?? tokenAddress, priceInXdai: price });
    } catch (e) {
      return err(String(e), 502);
    }
  }

  // ── tokens ────────────────────────────────────────────────────────────────────
  if (action === 'tokens') {
    return NextResponse.json({ ok: true, tokens: Object.values(GNOSIS_TOKENS) });
  }

  return err(`Unknown action: ${action}`);
}
