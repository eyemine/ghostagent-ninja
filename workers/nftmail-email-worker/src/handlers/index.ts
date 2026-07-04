/**
 * handlers/index.ts — dispatch registry for worker actions.
 *
 * Pattern: all NEW actions go into a handler file in this directory.
 * Old inline if-chain handlers in index.ts migrate here when touched for
 * other reasons — no big-bang rewrite required.
 *
 * Usage in index.ts (before the if-chain):
 *   import { handlers } from './handlers';
 *   const handler = handlers[email.action as string];
 *   if (handler) return handler(email as Record<string, unknown>, env as Record<string, unknown>, request, corsify);
 */

import type { HandlerFn } from './types';
import {
  sendTransmission,
  getDocumentTray,
  getTransmission,
  acknowledgeTransmission,
} from './transmission';
import {
  registerEciesKey,
  generateEciesKey,
  getEciesPublicKey,
} from './ecies-key';

export const handlers: Record<string, HandlerFn> = {
  // ── Transmission (NFTfax) ────────────────────────────────────────────────
  sendTransmission,
  getDocumentTray,
  getTransmission,
  acknowledgeTransmission,

  // ── ECIES key management ─────────────────────────────────────────────────
  registerEciesKey,
  generateEciesKey,
  getEciesPublicKey,
};

export type { HandlerFn };
