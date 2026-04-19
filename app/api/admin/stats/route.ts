/// Admin API endpoint for aggregated statistics
/// Combines on-chain data, Cloudflare KV metrics, and revenue tracking

import { NextRequest, NextResponse } from 'next/server';
import { getCachedRegistryCount } from '../../../utils/getRegistryCount';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

export async function GET(request: NextRequest) {
  try {
    // Simple auth check - in production, use proper authentication
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch on-chain registry count
    const onChainStats = await getCachedRegistryCount();

    // Fetch Cloudflare KV usage stats
    const workerResponse = await fetch(`${WORKER_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.WEBHOOK_SECRET || ''}`
      },
      body: JSON.stringify({ action: 'getStats' })
    });

    const workerStats = workerResponse.ok ? await workerResponse.json() : null;

    // Aggregate stats
    const aggregatedStats = {
      on_chain: {
        total_minted: onChainStats.formattedTotal,
        chain_id: onChainStats.chainId,
        contract: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
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
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
