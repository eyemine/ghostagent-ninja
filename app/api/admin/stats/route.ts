/// Admin API endpoint for nftmail.box statistics
/// Combines on-chain data from nftmail registrars, Cloudflare KV metrics, and revenue tracking

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

    // Fetch on-chain nftmail registrar counts
    const onChainStats = await getCachedNftmailCount();

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
        total_accounts: onChainStats.formattedTotal,
        breakdown: onChainStats.breakdown,
        chain_id: onChainStats.chainId,
        contracts: {
          molt_gno: '0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50',
          nftmail_gno: '0x46c37365572C9994812AAA41fD04eB56D05469D0',
          openclaw_gno: '0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe',
          picoclaw_gno: '0xe5fd65562698f46ea9762bd38141535b1fd875b5',
          vault_gno: '0xc6b184a38da64d1d535674dafb9ce2440058ec4e',
          agent_gno: '0x608071875bcc0ef0b934f8a2367672d8c472cacf',
        },
        last_updated: onChainStats.lastUpdated
      },
      off_chain: {
        active_inboxes: workerStats?.off_chain?.active_inboxes || 0,
        tracked_via_kv: true,
        tracking_period: '30_days'
      },
      revenue: {
        total_revenue: '0', // TODO: Query revenue from nftmail mints
        currency: 'xDAI'
      },
      last_updated: Date.now()
    };

    return NextResponse.json(aggregatedStats);
  } catch (error) {
    console.error('Failed to fetch nftmail admin stats:', error);
    // Return fallback data instead of error
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
