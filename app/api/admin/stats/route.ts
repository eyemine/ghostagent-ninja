/// Admin API endpoint for ghostagent.ninja statistics
/// Single getStats call to Worker KV for all metrics

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

const TLD_LIST = ['molt.gno', 'nftmail.gno', 'openclaw.gno', 'picoclaw.gno', 'vault.gno', 'agent.gno'] as const;

const CONTRACTS = {
  molt_gno: '0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50',
  nftmail_gno: '0x46c37365572C9994812AAA41fD04eB56D05469D0',
  openclaw_gno: '0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe',
  picoclaw_gno: '0xe5fd65562698f46ea9762bd38141535b1fd875b5',
  vault_gno: '0xc6b184a38da64d1d535674dafb9ce2440058ec4e',
  agent_gno: '0x608071875bcc0ef0b934f8a2367672d8c472cacf',
};

export async function GET(request: NextRequest) {
  // Optional auth check
  if (process.env.ADMIN_SECRET) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const workerResponse = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getStats' }),
    });

    if (!workerResponse.ok) {
      throw new Error(`Worker getStats returned ${workerResponse.status}`);
    }

    const data = await workerResponse.json() as {
      total_accounts: number;
      nft_accounts: number;
      sandbox_accounts: number;
      active_inboxes: number;
      agents: string[];
      tld_breakdown: Record<string, string[]>;
    };

    // Build breakdown from tld_breakdown
    const counts: Record<string, number> = {};
    for (const tld of TLD_LIST) counts[tld] = 0;

    let assignedCount = 0;
    for (const [tld, agents] of Object.entries(data.tld_breakdown || {})) {
      const count = Array.isArray(agents) ? agents.length : 0;
      if (tld in counts) counts[tld] = count;
      assignedCount += count;
    }

    // Unassigned agents default to nftmail.gno (BYO mints)
    const unassigned = (data.total_accounts || 0) - assignedCount;
    if (unassigned > 0) counts['nftmail.gno'] += unassigned;

    return NextResponse.json({
      on_chain: {
        total_accounts: (data.total_accounts || 0).toString(),
        breakdown: {
          molt_gno: counts['molt.gno'].toString(),
          nftmail_gno: counts['nftmail.gno'].toString(),
          openclaw_gno: counts['openclaw.gno'].toString(),
          picoclaw_gno: counts['picoclaw.gno'].toString(),
          vault_gno: counts['vault.gno'].toString(),
          agent_gno: counts['agent.gno'].toString(),
        },
        chain_id: 100,
        contracts: CONTRACTS,
        last_updated: new Date().toISOString(),
      },
      off_chain: {
        active_inboxes: data.active_inboxes || 0,
        nft_accounts: data.nft_accounts || 0,
        sandbox_accounts: data.sandbox_accounts || 0,
        tracked_via_kv: true,
      },
      revenue: {
        total_revenue: '0',
        currency: 'xDAI',
      },
      last_updated: Date.now(),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Admin stats error:', msg);
    return NextResponse.json({
      on_chain: {
        total_accounts: '0',
        breakdown: { molt_gno: '0', nftmail_gno: '0', openclaw_gno: '0', picoclaw_gno: '0', vault_gno: '0', agent_gno: '0' },
        chain_id: 100,
        contracts: CONTRACTS,
        last_updated: new Date().toISOString(),
      },
      off_chain: { active_inboxes: 0, nft_accounts: 0, sandbox_accounts: 0, tracked_via_kv: true },
      revenue: { total_revenue: '0', currency: 'xDAI' },
      last_updated: Date.now(),
      error: `Failed to fetch stats: ${msg}`,
    });
  }
}
