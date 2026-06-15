import { NextRequest, NextResponse } from 'next/server';
import {
  buildEvolutionRecord,
  buildEvolutionAuditEntry,
  agentEmailAddress,
  humanInboxKey,
  agentBlindIndexKey,
  VAULT_EVOLUTION_COST_XDAI,
  type VaultEvolutionRecord,
} from '../../../services/vault-evolution';
import { WORKER_URL } from '../../../utils/config';


const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || '';
const WORKER_SECRET = process.env.WORKER_SECRET || process.env.WEBHOOK_SECRET || '';

/**
 * GET /api/evolve/vault?name=acme
 * Returns existing evolution record if present.
 */
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name');
  if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 });

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WORKER_SECRET },
      body: JSON.stringify({ action: 'getVaultEvolution', clientName: name.toLowerCase() }),
    });
    if (res.status === 404) {
      return NextResponse.json({
        exists: false,
        clientName: name,
        humanEmail: `swarm.${name.toLowerCase()}@nftmail.box`,
        agentEmail:  agentEmailAddress(name),
        costXdai:    VAULT_EVOLUTION_COST_XDAI,
      });
    }
    const data = await res.json() as Record<string, unknown>;
    return NextResponse.json({ exists: true, ...data });
  } catch {
    return NextResponse.json({ error: 'Worker unavailable' }, { status: 502 });
  }
}

/**
 * POST /api/evolve/vault
 * Body: {
 *   action: 'begin' | 'confirm-mint' | 'confirm-safe' | 'migrate-email'
 *   clientName, ownerAddress,
 *   safeAddress?, tbaAddress?, txHash?
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      action: 'begin' | 'confirm-mint' | 'confirm-safe' | 'migrate-email';
      clientName: string;
      ownerAddress: string;
      safeAddress?: string;
      tbaAddress?: string;
      txHash?: string;
    };

    const { action, clientName, ownerAddress } = body;
    if (!action || !clientName || !ownerAddress) {
      return NextResponse.json({ error: 'Missing action, clientName, or ownerAddress' }, { status: 400 });
    }

    const name = clientName.toLowerCase();

    // ── begin: create evolution record, set status=minting ──────────────────
    if (action === 'begin') {
      const record = buildEvolutionRecord({ clientName: name, ownerAddress });
      record.status = 'minting';

      await kvPut(`vault-evo:${name}`, record);

      const audit = buildEvolutionAuditEntry(record);
      await appendGlassBox(name, audit);

      return NextResponse.json({
        status: 'ok',
        evolution: record,
        costXdai: VAULT_EVOLUTION_COST_XDAI,
        message: `Minting vault.gno NFT for ${record.agentEmail}…`,
      });
    }

    // ── Load existing record for all subsequent steps ────────────────────────
    const existing = await kvGet<VaultEvolutionRecord>(`vault-evo:${name}`);
    if (!existing) {
      return NextResponse.json({ error: 'Evolution not started — call begin first' }, { status: 404 });
    }

    // ── confirm-mint: NFT minted on-chain, now deploying Safe ────────────────
    if (action === 'confirm-mint') {
      if (!body.tbaAddress) return NextResponse.json({ error: 'Missing tbaAddress' }, { status: 400 });
      const updated: VaultEvolutionRecord = {
        ...existing,
        tbaAddress: body.tbaAddress,
        txHash:     body.txHash ?? existing.txHash,
        status:     'deploying-safe',
      };
      await kvPut(`vault-evo:${name}`, updated);
      return NextResponse.json({ status: 'ok', evolution: updated });
    }

    // ── confirm-safe: Safe deployed, update agent-tier in worker ─────────────
    if (action === 'confirm-safe') {
      if (!body.safeAddress) return NextResponse.json({ error: 'Missing safeAddress' }, { status: 400 });
      const updated: VaultEvolutionRecord = {
        ...existing,
        safeAddress: body.safeAddress,
        status:      'migrating-email',
      };
      await kvPut(`vault-evo:${name}`, updated);

      // Register vault agent inbox in worker (agent tier = lite, 30-day)
      await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WORKER_SECRET },
        body: JSON.stringify({
          action:   'upgradeTier',
          secret:   WEBHOOK_SECRET,
          name:     `swarm.${name}_`,
          tier:     'lite',
          safe:     body.safeAddress,
          retention:'30-day',
        }),
      });

      return NextResponse.json({ status: 'ok', evolution: updated });
    }

    // ── migrate-email: copy messages + contacts, complete evolution ───────────
    if (action === 'migrate-email') {
      // Fetch messages from human inbox key
      const humanKey  = humanInboxKey(name);
      const agentKey  = agentBlindIndexKey(name);

      let migratedMessages = 0;
      let migratedContacts = 0;

      try {
        const msgsRes = await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WORKER_SECRET },
          body: JSON.stringify({ action: 'kvGet', key: humanKey }),
        });
        const msgsData = await msgsRes.json() as { value?: string };

        if (msgsData.value) {
          // Copy messages to agent blind index key
          await fetch(WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WORKER_SECRET },
            body: JSON.stringify({
              action: 'kvPut',
              key:    agentKey,
              value:  msgsData.value,
              ownerAddress: ownerAddress.toLowerCase(),
            }),
          });
          try {
            const msgs = JSON.parse(msgsData.value);
            migratedMessages = Array.isArray(msgs) ? msgs.length : 1;
          } catch { migratedMessages = 1; }
        }

        // Migrate contacts list if present
        const contactsRes = await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WORKER_SECRET },
          body: JSON.stringify({ action: 'kvGet', key: `contacts:swarm.${name}` }),
        });
        const contactsData = await contactsRes.json() as { value?: string };
        if (contactsData.value) {
          await fetch(WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WORKER_SECRET },
            body: JSON.stringify({
              action: 'kvPut',
              key:    `contacts:swarm.${name}_`,
              value:  contactsData.value,
              ownerAddress: ownerAddress.toLowerCase(),
            }),
          });
          try {
            const contacts = JSON.parse(contactsData.value);
            migratedContacts = Array.isArray(contacts) ? contacts.length : 1;
          } catch { migratedContacts = 1; }
        }
      } catch {
        // Non-fatal — migration attempted but inbox may be empty
      }

      const completed: VaultEvolutionRecord = {
        ...existing,
        safeAddress:          body.safeAddress ?? existing.safeAddress,
        status:               'complete',
        migratedMessageCount: migratedMessages,
        migratedContactCount: migratedContacts,
        completedAt:          Date.now(),
      };
      await kvPut(`vault-evo:${name}`, completed);

      const audit = buildEvolutionAuditEntry(completed);
      await appendGlassBox(name, audit);

      return NextResponse.json({
        status: 'ok',
        evolution: completed,
        message: `Evolved to vault.gno: ${completed.agentEmail}`,
        migratedMessages,
        migratedContacts,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WORKER_SECRET },
      body: JSON.stringify({ action: 'kvGet', key }),
    });
    const data = await res.json() as { value?: string };
    return data.value ? JSON.parse(data.value) as T : null;
  } catch { return null; }
}

async function kvPut(key: string, value: unknown): Promise<void> {
  await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WORKER_SECRET },
    body: JSON.stringify({
      action: 'kvPut', key,
      value: JSON.stringify(value),
      ownerAddress: 'system',
    }),
  });
}

async function appendGlassBox(clientName: string, entry: unknown): Promise<void> {
  try {
    const key = `glassbox:swarm.${clientName}_:vault.gno`;
    const existing = await kvGet<unknown[]>(key) ?? [];
    existing.push(entry);
    if (existing.length > 500) existing.splice(0, existing.length - 500);
    await kvPut(key, existing);
  } catch { /* non-fatal */ }
}
