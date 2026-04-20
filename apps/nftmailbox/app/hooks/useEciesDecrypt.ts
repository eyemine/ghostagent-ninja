'use client';

/// useEciesDecrypt — React hook for browser-side ECIES decryption of blind inbox messages.
///
/// Flow:
///   1. Owner connects wallet (Privy).
///   2. Hook checks localStorage for stored P-256 private key for this agent.
///   3. If no key: UI prompts to paste key or generate a new one + register pubkey with worker.
///   4. On key load: auto-decrypts all encrypted messages in the inbox (in-memory only).
///   5. Decrypted plaintext parsed as JSON { from, to, subject, body, timestamp }.
///
/// Key storage: localStorage key = `nftmail-ecies-privkey:{agentName}` (hex, 32 bytes)
/// Key is NEVER sent to any server. Decryption is entirely local.

import { useState, useCallback, useEffect } from 'react';
import {
  eciesDecrypt,
  generateEciesKeyPair,
  storePrivateKey,
  loadPrivateKey,
  clearPrivateKey,
  hasPrivateKey,
  type EncryptedEnvelope,
} from '../lib/ecies-browser';

const WORKER_URL = 'https://nftmail-email-worker.richard-159.workers.dev';

export interface DecryptedMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  timestamp: number;
  contentHash: string;
  receivedAt: number;
  ipfsCid?: string;
}

export interface BlindInboxMessage {
  id: string;
  type: string;
  encrypted: boolean;
  envelope?: EncryptedEnvelope;
  payload?: { from: string; to: string; subject: string; body: string; timestamp: number };
  plaintextHash?: string;
  recipient: string;
  receivedAt: number;
  ipfsCid?: string;
  warning?: string;
}

type KeyState = 'unknown' | 'missing' | 'loaded' | 'generating' | 'error';

interface UseEciesDecryptReturn {
  keyState: KeyState;
  hasKey: boolean;
  blindMessages: BlindInboxMessage[];
  decryptedMessages: DecryptedMessage[];
  decryptError: string | null;
  decryptingCount: number;
  loadBlindInbox: () => Promise<void>;
  loadKey: (privKeyHex: string) => void;
  generateAndRegisterKey: (agentName: string) => Promise<{ publicKey: string; privateKey: string } | null>;
  forgetKey: () => void;
  decryptAll: () => Promise<void>;
}

export function useEciesDecrypt(agentName: string | null): UseEciesDecryptReturn {
  const [keyState, setKeyState] = useState<KeyState>('unknown');
  const [privKey, setPrivKey] = useState<string | null>(null);
  const [blindMessages, setBlindMessages] = useState<BlindInboxMessage[]>([]);
  const [decryptedMessages, setDecryptedMessages] = useState<DecryptedMessage[]>([]);
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [decryptingCount, setDecryptingCount] = useState(0);

  // agentName may carry a trailing `_` to denote the agent inbox (e.g. ghostagent_).
  // Blind-inbox reads use the full name (distinct KV key from the human inbox),
  // but ECIES pub/priv keys are tied to the base on-chain identity (no trailing _).
  const baseName = agentName ? agentName.replace(/_+$/, '') : null;

  // On mount / agentName change: check localStorage for existing key
  useEffect(() => {
    if (!baseName) { setKeyState('missing'); return; }
    const stored = loadPrivateKey(baseName);
    if (stored) {
      setPrivKey(stored);
      setKeyState('loaded');
    } else {
      setKeyState('missing');
    }
  }, [agentName]);

  // Fetch all blind envelopes from worker KV
  const loadBlindInbox = useCallback(async () => {
    if (!agentName) return;
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getBlindInbox', localPart: agentName }),
      });
      if (!res.ok) return;
      const data = await res.json() as { messages: BlindInboxMessage[] };
      setBlindMessages(data.messages || []);
    } catch {}
  }, [agentName]);

  // Decrypt all encrypted envelopes in-memory
  const decryptAll = useCallback(async () => {
    if (!privKey || blindMessages.length === 0) return;
    setDecryptError(null);

    const encrypted = blindMessages.filter(m => m.encrypted && m.envelope);
    const cleartext = blindMessages.filter(m => !m.encrypted && m.payload);

    setDecryptingCount(encrypted.length);

    const results: DecryptedMessage[] = [];

    // Add cleartext messages (no key needed)
    for (const m of cleartext) {
      if (m.payload) {
        results.push({
          id: m.id,
          from: m.payload.from,
          to: m.payload.to,
          subject: m.payload.subject,
          body: m.payload.body,
          timestamp: m.payload.timestamp,
          contentHash: m.plaintextHash || '',
          receivedAt: m.receivedAt,
          ipfsCid: m.ipfsCid,
        });
      }
    }

    // Decrypt ECIES envelopes
    let errCount = 0;
    await Promise.all(
      encrypted.map(async (m) => {
        try {
          const plaintext = await eciesDecrypt(m.envelope!, privKey);
          const parsed = JSON.parse(plaintext) as {
            from: string; to: string; subject: string; body: string; timestamp: number;
          };
          results.push({
            id: m.id,
            from: parsed.from,
            to: parsed.to,
            subject: parsed.subject,
            body: parsed.body,
            timestamp: parsed.timestamp,
            contentHash: m.plaintextHash || '',
            receivedAt: m.receivedAt,
            ipfsCid: m.ipfsCid,
          });
        } catch {
          errCount++;
        }
      })
    );

    results.sort((a, b) => b.receivedAt - a.receivedAt);
    setDecryptedMessages(results);
    setDecryptingCount(0);
    if (errCount > 0) {
      setDecryptError(`${errCount} message${errCount > 1 ? 's' : ''} could not be decrypted — wrong key?`);
    }
  }, [privKey, blindMessages]);

  // Auto-decrypt whenever key or blind messages update
  useEffect(() => {
    if (keyState === 'loaded' && blindMessages.length > 0) {
      decryptAll();
    }
  }, [keyState, blindMessages, decryptAll]);

  // Load a key from hex string (user pastes it in)
  const loadKey = useCallback((privKeyHex: string) => {
    if (!baseName) return;
    const clean = privKeyHex.trim().replace(/^0x/, '');
    if (clean.length !== 64) {
      setDecryptError('Invalid private key — expected 32-byte hex (64 chars)');
      setKeyState('error');
      return;
    }
    storePrivateKey(baseName, clean);
    setPrivKey(clean);
    setKeyState('loaded');
    setDecryptError(null);
  }, [baseName]);

  // Generate a fresh P-256 key pair, store private key locally, register public key with worker
  const generateAndRegisterKey = useCallback(async (agent: string) => {
    if (!agent) return null;
    // ECIES keys are tied to the base on-chain identity (strip any trailing _).
    const base = agent.replace(/_+$/, '');
    setKeyState('generating');
    try {
      const kp = await generateEciesKeyPair();
      storePrivateKey(base, kp.privateKey);
      setPrivKey(kp.privateKey);

      // Register public key with the worker KV under the base identity
      await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'registerEciesKey',
          localPart: base,
          eciesPublicKey: kp.publicKey,
        }),
      });

      setKeyState('loaded');
      return kp;
    } catch (err: any) {
      setDecryptError(err?.message || 'Key generation failed');
      setKeyState('error');
      return null;
    }
  }, []);

  // Remove key from localStorage
  const forgetKey = useCallback(() => {
    if (!baseName) return;
    clearPrivateKey(baseName);
    setPrivKey(null);
    setKeyState('missing');
    setDecryptedMessages([]);
  }, [baseName]);

  return {
    keyState,
    hasKey: keyState === 'loaded',
    blindMessages,
    decryptedMessages,
    decryptError,
    decryptingCount,
    loadBlindInbox,
    loadKey,
    generateAndRegisterKey,
    forgetKey,
    decryptAll,
  };
}
