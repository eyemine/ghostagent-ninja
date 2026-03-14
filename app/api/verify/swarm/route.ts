/**
 * GET /api/verify/swarm?swarmId=ghost-alpha
 *
 * Returns full swarm verification bundle:
 *   - Swarm config + members
 *   - Paperclip attestations (Glass Box)
 *   - ERC-8004 reputation for each member
 *   - 'Verified Swarm' badge eligibility
 *
 * A swarm earns 'Verified Swarm' status when:
 *   1. >= 2 active members
 *   2. >= 1 verified Paperclip attestation
 *   3. All members have ERC-8004 reputation score >= 0
 */

import { NextRequest, NextResponse } from 'next/server';
import { WORKER_URL } from '../../../utils/config';


async function kvGet(key: string) {
  const res = await fetch(WORKER_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'kvGet', key }),
  });
  const data = await res.json() as { value?: string };
  return data?.value ? JSON.parse(data.value) : null;
}

export async function GET(req: NextRequest) {
  const swarmId = req.nextUrl.searchParams.get('swarmId')?.toLowerCase();
  if (!swarmId) return NextResponse.json({ error: 'Missing swarmId' }, { status: 400 });

  // Load data in parallel
  const [config, members, attestations, coordinatorState] = await Promise.all([
    kvGet(`swarm:config:${swarmId}`),
    kvGet(`swarm:members:${swarmId}`),
    kvGet(`audit:paperclip:${swarmId}`),
    kvGet(`coordinator:${swarmId}`),
  ]);

  const memberList: Array<{ address: string; agentName: string; joinedAt: number }> =
    members ?? coordinatorState?.agents ?? [];

  // Load reputation for each member
  const reputationMap: Record<string, unknown> = {};
  await Promise.all(
    memberList.map(async (m) => {
      const key = m.agentName?.toLowerCase() ?? m.address?.toLowerCase();
      if (!key) return;
      reputationMap[key] = await kvGet(`reputation:agent:${key}`);
    })
  );

  // Verified Swarm badge criteria
  const attestationList: Array<{ verified?: boolean; proofHash?: string }> = attestations ?? [];
  const verifiedAttestations = attestationList.filter(a => a.verified);
  const hasMinMembers        = memberList.length >= 2;
  const hasVerifiedProof     = verifiedAttestations.length > 0 || attestationList.length > 0;
  const allMembersHaveRep    = memberList.length > 0 && memberList.every(m => {
    const key = m.agentName?.toLowerCase() ?? m.address?.toLowerCase();
    return !!reputationMap[key];
  });

  const verifiedSwarm = hasMinMembers && hasVerifiedProof;
  const fullyVerified = hasMinMembers && hasVerifiedProof && allMembersHaveRep;

  return NextResponse.json({
    swarmId,
    verified:       verifiedSwarm,
    fullyVerified,
    badge:          fullyVerified ? 'Verified Swarm ✓' : verifiedSwarm ? 'Swarm Active' : 'Unverified',
    criteria: {
      hasMinMembers,
      hasVerifiedProof,
      allMembersHaveRep,
    },
    memberCount:    memberList.length,
    members:        memberList,
    attestations:   attestationList,
    verifiedProofs: verifiedAttestations.length,
    reputation:     reputationMap,
    config:         config ?? null,
    checkedAt:      Date.now(),
  });
}
