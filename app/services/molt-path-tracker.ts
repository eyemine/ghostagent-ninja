/**
 * @module molt-path-tracker
 * Tracks the complete evolution + identity history of a GhostAgent.
 *
 * Persisted in worker KV under:
 *   molt-path:{agentName}  →  MoltPathRecord JSON
 *
 * Updated on:
 *   - evolve upgrade   (pupa → imago):  new MoltEvent, xdaiBurned += 14+24
 *   - evolve downgrade (imago → pupa):  new MoltEvent, xdaiBurned unchanged (no fee)
 *   - chonk molt:                       new MoltEvent (type='identity'), lastMoltTimestamp updated
 *   - initial mint:                     record created with larva level
 *
 * surge_reputation_score:
 *   Linear: 1 point per xDAI burned, capped at 1000.
 *   Bonus multipliers applied per event type.
 */

import { buildAndPin, type MoltEvent, type MoltPath, type EmailAliasMeta } from './beacon-metadata';
import { WORKER_URL } from '../utils/config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MoltPathRecord {
  agentName: string;
  currentLevel: string;
  totalXdaiBurned: number;
  surgeReputationScore: number;
  lastMoltTimestamp: number | null;
  lastEvolveTimestamp: number | null;
  evolutionHistory: MoltEvent[];
  beaconCid: string | null;
  beaconMetadataUrl: string | null;
  beaconUpdatedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface TrackEvolveParams {
  agentName: string;
  ownerAddress: string;
  gnosisNft: string;
  fromLevel: string;
  toLevel: string;
  xdaiBurned: number;
  txHash: string;
  safeAddress?: string | null;
  tbaAddress?: string | null;
  storyIpDomain?: string | null;
  aliases?: EmailAliasMeta[];
  note?: string;
  repinBeacon?: boolean;
}

export interface TrackMoltParams {
  agentName: string;
  ownerAddress: string;
  gnosisNft: string;
  moltType: string;          // 'chonk' | 'identity' | 'collection'
  collectionName?: string;
  tokenId?: string;
  xdaiBurned: number;        // fee paid for this molt (e.g. 2 xDAI for Chonk)
  txHash: string;
  aliases?: EmailAliasMeta[];
  note?: string;
  repinBeacon?: boolean;
}

export interface TrackResult {
  record: MoltPathRecord;
  beaconPinned: boolean;
  beaconCid: string | null;
  beaconMetadataUrl: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────


// xDAI costs per action for score calculation
const XDAI_COSTS: Record<string, number> = {
  'larva→pupa':   10,
  'pupa→imago': 38,  // 14 + 24
  'chonk':       2,
};

// Bonus multipliers per event type
const EVENT_MULTIPLIERS: Record<string, number> = {
  'pupa→imago':  1.5,
  'larva→pupa':    1.2,
  identity:      1.1,
  chonk:         1.1,
};

const MAX_SCORE = 1000;

// ─── Score calculator ─────────────────────────────────────────────────────────

export function calcSurgeReputationScore(history: MoltEvent[]): number {
  let score = 0;
  for (const event of history) {
    const key = `${event.fromLevel}→${event.toLevel}`;
    const multiplier =
      EVENT_MULTIPLIERS[key] ??
      EVENT_MULTIPLIERS[event.note ?? ''] ??
      1.0;
    score += event.xdaiBurned * multiplier;
  }
  return Math.min(Math.round(score * 10) / 10, MAX_SCORE);
}

// ─── KV helpers ──────────────────────────────────────────────────────────────

async function getMoltPath(agentName: string): Promise<MoltPathRecord | null> {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getMoltPath', name: agentName }),
    });
    if (res.status === 404) return null;
    const data = await res.json() as any;
    return data?.record ?? null;
  } catch {
    return null;
  }
}

async function saveMoltPath(
  record: MoltPathRecord,
  secret: string,
): Promise<void> {
  await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'setMoltPath',
      secret,
      name: record.agentName,
      record,
    }),
  });
}

// ─── Beacon re-pin ────────────────────────────────────────────────────────────

async function repinBeacon(params: {
  agentName: string;
  ownerAddress: string;
  gnosisNft: string;
  record: MoltPathRecord;
  aliases: EmailAliasMeta[];
  safeAddress?: string | null;
  tbaAddress?: string | null;
  storyIpDomain?: string | null;
  lighthouseApiKey?: string;
  webhookSecret: string;
}): Promise<{ cid: string | null; metadataUrl: string | null; pinned: boolean }> {
  try {
    const { metadata, pin } = await buildAndPin(
      {
        agentName: params.agentName,
        ownerAddress: params.ownerAddress,
        gnosisNft: params.gnosisNft,
        safeAddress: params.safeAddress ?? null,
        tbaAddress: params.tbaAddress ?? null,
        storyIpDomain: params.storyIpDomain ?? null,
        currentLevel: params.record.currentLevel,
        xdaiBurned: params.record.totalXdaiBurned,
        moltHistory: params.record.evolutionHistory,
        aliases: params.aliases,
      },
      params.lighthouseApiKey,
    );

    if (!pin) {
      return { cid: null, metadataUrl: null, pinned: false };
    }

    // Store new CID in worker KV
    await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'setBeacon',
        secret: params.webhookSecret,
        name: params.agentName,
        cid: pin.cid,
        metadataUrl: pin.url,
        pinnedAt: pin.pinnedAt,
      }),
    });

    return { cid: pin.cid, metadataUrl: pin.url, pinned: true };
  } catch {
    return { cid: null, metadataUrl: null, pinned: false };
  }
}

// ─── Track evolve (pupa ↔ imago) ─────────────────────────────────────────────

export async function trackEvolve(
  params: TrackEvolveParams,
  webhookSecret: string,
  lighthouseApiKey?: string,
): Promise<TrackResult> {
  const now = Date.now();

  const existing = await getMoltPath(params.agentName);

  const event: MoltEvent = {
    fromLevel: params.fromLevel,
    toLevel: params.toLevel,
    xdaiBurned: params.xdaiBurned,
    txHash: params.txHash,
    timestamp: now,
    chain: 'gnosis',
    note: params.note,
  };

  const history = [...(existing?.evolutionHistory ?? []), event];
  const totalXdaiBurned = (existing?.totalXdaiBurned ?? 0) + params.xdaiBurned;
  const surgeReputationScore = calcSurgeReputationScore(history);

  const record: MoltPathRecord = {
    agentName: params.agentName,
    currentLevel: params.toLevel,
    totalXdaiBurned,
    surgeReputationScore,
    lastMoltTimestamp: existing?.lastMoltTimestamp ?? null,
    lastEvolveTimestamp: now,
    evolutionHistory: history,
    beaconCid: existing?.beaconCid ?? null,
    beaconMetadataUrl: existing?.beaconMetadataUrl ?? null,
    beaconUpdatedAt: existing?.beaconUpdatedAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  // Re-pin beacon if requested (default: true for upgrades)
  const shouldPin = params.repinBeacon !== false && params.fromLevel !== params.toLevel;
  let beaconPinned = false;
  let beaconCid = record.beaconCid;
  let beaconMetadataUrl = record.beaconMetadataUrl;

  if (shouldPin) {
    const pinResult = await repinBeacon({
      agentName: params.agentName,
      ownerAddress: params.ownerAddress,
      gnosisNft: params.gnosisNft,
      record,
      aliases: params.aliases ?? [],
      safeAddress: params.safeAddress,
      tbaAddress: params.tbaAddress,
      storyIpDomain: params.storyIpDomain,
      lighthouseApiKey,
      webhookSecret,
    });
    beaconPinned = pinResult.pinned;
    if (pinResult.cid) {
      beaconCid = pinResult.cid;
      beaconMetadataUrl = pinResult.metadataUrl;
      record.beaconCid = pinResult.cid;
      record.beaconMetadataUrl = pinResult.metadataUrl;
      record.beaconUpdatedAt = now;
    }
  }

  await saveMoltPath(record, webhookSecret);

  return { record, beaconPinned, beaconCid, beaconMetadataUrl };
}

// ─── Track identity molt (Chonk, collection overlay) ─────────────────────────

export async function trackMolt(
  params: TrackMoltParams,
  webhookSecret: string,
  lighthouseApiKey?: string,
): Promise<TrackResult> {
  const now = Date.now();

  const existing = await getMoltPath(params.agentName);
  const currentLevel = existing?.currentLevel ?? 'larva';

  const event: MoltEvent = {
    fromLevel: currentLevel,
    toLevel: currentLevel,   // identity molt doesn't change level
    xdaiBurned: params.xdaiBurned,
    txHash: params.txHash,
    timestamp: now,
    chain: 'gnosis',
    note: params.note ?? `${params.moltType} molt${params.tokenId ? ` #${params.tokenId}` : ''}`,
  };

  const history = [...(existing?.evolutionHistory ?? []), event];
  const totalXdaiBurned = (existing?.totalXdaiBurned ?? 0) + params.xdaiBurned;
  const surgeReputationScore = calcSurgeReputationScore(history);

  const record: MoltPathRecord = {
    agentName: params.agentName,
    currentLevel,
    totalXdaiBurned,
    surgeReputationScore,
    lastMoltTimestamp: now,
    lastEvolveTimestamp: existing?.lastEvolveTimestamp ?? null,
    evolutionHistory: history,
    beaconCid: existing?.beaconCid ?? null,
    beaconMetadataUrl: existing?.beaconMetadataUrl ?? null,
    beaconUpdatedAt: existing?.beaconUpdatedAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const shouldPin = params.repinBeacon !== false;
  let beaconPinned = false;
  let beaconCid = record.beaconCid;
  let beaconMetadataUrl = record.beaconMetadataUrl;

  if (shouldPin) {
    const pinResult = await repinBeacon({
      agentName: params.agentName,
      ownerAddress: params.ownerAddress,
      gnosisNft: params.gnosisNft,
      record,
      aliases: params.aliases ?? [],
      lighthouseApiKey,
      webhookSecret,
    });
    beaconPinned = pinResult.pinned;
    if (pinResult.cid) {
      beaconCid = pinResult.cid;
      beaconMetadataUrl = pinResult.metadataUrl;
      record.beaconCid = pinResult.cid;
      record.beaconMetadataUrl = pinResult.metadataUrl;
      record.beaconUpdatedAt = now;
    }
  }

  await saveMoltPath(record, webhookSecret);

  return { record, beaconPinned, beaconCid, beaconMetadataUrl };
}

// ─── Get molt path (read-only, no auth) ──────────────────────────────────────

export async function fetchMoltPath(agentName: string): Promise<MoltPathRecord | null> {
  return getMoltPath(agentName);
}
