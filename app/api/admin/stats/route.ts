/// Admin API endpoint for nftmail.box statistics
/// Uses Worker KV (listAgents + getStats) as source of truth for account metrics

import { NextRequest, NextResponse } from 'next/server';
import { getCachedNftmailCount } from '../../../utils/getNftmailCount';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

export async function GET(request: NextRequest) {
  try {
    // Optional auth check - if ADMIN_SECRET is set, require it
    if (process.env.ADMIN_SECRET) {
      const authHeader = request.headers.get('authorization');
      if (authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    // Fetch TLD-grouped counts from worker via listAgents
    const registrarStats = await getCachedNftmailCount();

    // Fetch comprehensive stats (unique agents + active inboxes) from worker
    let workerStats: { total_accounts?: number; active_inboxes?: number; agents?: string[] } = {};
    try {
      const workerResponse = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getStats' })
      });
      if (workerResponse.ok) {
        workerStats = await workerResponse.json();
      }
    } catch (workerError) {
      console.error('Failed to fetch worker stats:', workerError);
    }

    // Use the higher of listAgents total vs getStats total (covers all KV prefixes)
    const totalFromGetStats = workerStats.total_accounts || 0;
    const totalFromListAgents = parseInt(registrarStats.formattedTotal) || 0;
    const bestTotal = Math.max(totalFromGetStats, totalFromListAgents);

    const aggregatedStats = {
      on_chain: {
        total_accounts: bestTotal.toString(),
        breakdown: registrarStats.breakdown,
        chain_id: 100,
        contracts: {
          molt_gno: '0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50',
          nftmail_gno: '0x46c37365572C9994812AAA41fD04eB56D05469D0',
          openclaw_gno: '0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe',
          picoclaw_gno: '0xe5fd65562698f46ea9762bd38141535b1fd875b5',
          vault_gno: '0xc6b184a38da64d1d535674dafb9ce2440058ec4e',
          agent_gno: '0x608071875bcc0ef0b934f8a2367672d8c472cacf',
        },
        last_updated: registrarStats.lastUpdated
      },
      off_chain: {
        active_inboxes: workerStats.active_inboxes || 0,
        tracked_via_kv: true,
        tracking_period: '30_days'
      },
      revenue: {
        total_revenue: '0',
        currency: 'xDAI'
      },
      last_updated: Date.now()
    };

    return NextResponse.json(aggregatedStats);
  } catch (error) {
    console.error('Failed to fetch nftmail admin stats:', error);
    return NextResponse.json({
      on_chain: {
        total_accounts: '0',
        breakdown: {
          molt_gno: '0',
          nftmail_gno: '0',
          openclaw_gno: '0',
          picoclaw_gno: '0',
          vault_gno: '0',
          agent_gno: '0',
        },
        chain_id: 100,
        contracts: {
          molt_gno: '0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50',
          nftmail_gno: '0x46c37365572C9994812AAA41fD04eB56D05469D0',
          openclaw_gno: '0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe',
          picoclaw_gno: '0xe5fd65562698f46ea9762bd38141535b1fd875b5',
          vault_gno: '0xc6b184a38da64d1d535674dafb9ce2440058ec4e',
          agent_gno: '0x608071875bcc0ef0b934f8a2367672d8c472cacf',
        },
        last_updated: new Date()
      },
      off_chain: {
        active_inboxes: 0,
        tracked_via_kv: true,
        tracking_period: '30_days'
      },
      revenue: {
        total_revenue: '0',
        currency: 'xDAI'
      },
      last_updated: Date.now(),
      error: 'Failed to fetch live stats, showing fallback data'
    });
  }
}
