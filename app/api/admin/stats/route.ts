/// Admin API endpoint for aggregated statistics
/// Combines on-chain data, Cloudflare KV metrics, and revenue tracking

import { NextRequest, NextResponse } from 'next/server';
import { getCachedRegistryCount } from '../../../utils/getRegistryCount';

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

    // Fetch on-chain registry count
    const onChainStats = await getCachedRegistryCount();

    // Fetch Cloudflare KV usage stats
    let workerStats = null;
    try {
      const workerResponse = await fetch(`${WORKER_URL}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.WEBHOOK_SECRET || ''}`
        },
        body: JSON.stringify({ action: 'getStats' })
      });
      if (workerResponse.ok) {
        workerStats = await workerResponse.json();
      }
    } catch (workerError) {
      console.error('Failed to fetch worker stats:', workerError);
    }

    // Aggregate stats
    const aggregatedStats = {
      on_chain: {
        total_minted: onChainStats.formattedTotal,
        chain_id: onChainStats.chainId,
        contract: '0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50',
        last_updated: onChainStats.lastUpdated
      },
      off_chain: {
        active_inboxes: workerStats?.off_chain?.active_inboxes || 0,
        tracked_via_kv: true,
        tracking_period: '30_days'
      },
      revenue: {
        total_revenue: '0', // TODO: Query Stamps mapping
        currency: 'xDAI'
      },
      last_updated: Date.now()
    };

    return NextResponse.json(aggregatedStats);
  } catch (error) {
    console.error('Failed to fetch admin stats:', error);
    // Return fallback data instead of error
    return NextResponse.json({
      on_chain: {
        total_minted: '0',
        chain_id: 100,
        contract: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
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
