/**
 * One-shot script: inserts the 3 ERC-8004 pending-transfer KV handlers
 * into workers/nftmail-email-worker/src/index.ts immediately after the
 * existing setErc8004AgentId block.
 * Safe to re-run — exits early if handlers already present.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = resolve(__dirname, '../workers/nftmail-email-worker/src/index.ts');

let c = readFileSync(path, 'utf8');

if (c.includes("action === 'setErc8004PendingTransfer'")) {
  console.log('Handlers already present — nothing to do.');
  process.exit(0);
}

const MARKER = `        // ERC-8004 TradeIntent: store EIP-712 signed trade intent for A2A discovery`;

if (!c.includes(MARKER)) {
  console.error('ERROR: marker not found in index.ts');
  process.exit(1);
}

const INSERTION = `        // ERC-8004 failsafe: pending-transfer checkpoint
        // Written immediately after register() mint; cleared after successful transferFrom().
        // Enables --recover mode to retry any stuck pending transfers without re-minting.
        if (email.action === 'setErc8004PendingTransfer') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          const pending   = (email as any).pendingTransfer;
          if (!agentName || !pending) {
            return corsify(Response.json({ error: 'Missing agentName or pendingTransfer' }, { status: 400 }), request);
          }
          await env.INBOX_KV.put('erc8004:pending:' + agentName, JSON.stringify({ ...pending, savedAt: Date.now() }));
          return corsify(Response.json({ status: 'checkpoint_saved', agentName }), request);
        }

        if (email.action === 'clearErc8004PendingTransfer') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          await env.INBOX_KV.delete('erc8004:pending:' + agentName);
          return corsify(Response.json({ status: 'checkpoint_cleared', agentName }), request);
        }

        if (email.action === 'getErc8004PendingTransfers') {
          const listed = await env.INBOX_KV.list({ prefix: 'erc8004:pending:' });
          const pendingTransfers: any[] = [];
          for (const key of listed.keys) {
            const raw = await env.INBOX_KV.get(key.name);
            if (raw) { try { pendingTransfers.push(JSON.parse(raw)); } catch {} }
          }
          return corsify(Response.json({ pendingTransfers }), request);
        }

        // ERC-8004 TradeIntent: store EIP-712 signed trade intent for A2A discovery`;

writeFileSync(path, c.replace(MARKER, INSERTION));
console.log('OK — 3 ERC-8004 KV handlers inserted into index.ts');
