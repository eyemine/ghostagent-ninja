/// Admin API endpoint for GhostAgent statistics
/// Uses Cloudflare KV for agent tracking (ERC-8004 registry doesn't have totalSupply)

import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

// Known agents for GhostAgent.ninja
const KNOWN_AGENTS = [
  { name: 'ghostagent', sld: 'molt.gno', agentId: 3199 },
  { name: 'eyemine', sld: 'nftmail.gno', agentId: 3205 },
  { name: 'victor', sld: 'openclaw.gno', agentId: 3206 },
];

export async function GET(request: NextRequest) {
  try {
    // Optional auth check - if ADMIN_SECRET is set, require it
    if (process.env.ADMIN_SECRET) {
      const authHeader = request.headers.get('authorization');
      if (authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    // Fetch agents from Cloudflare KV via worker
    let agentsList: any[] = [];
    try {
      const listResponse = await fetch(`${WORKER_URL}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.WEBHOOK_SECRET || ''}`
        },
        body: JSON.stringify({ 
          action: 'listAgents',
          safeAddress: '0xb7e493e3d226f8fE722CC9916fF164B793af13F4' // GhostAgent Safe
        })
      });
      if (listResponse.ok) {
        const data = await listResponse.json();
        agentsList = data.agents || [];
      }
    } catch (error) {
      console.error('Failed to fetch agents list:', error);
    }

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
      agents: {
        total_registered: agentsList.length || KNOWN_AGENTS.length,
        known_agents: KNOWN_AGENTS,
        from_kv: agentsList,
        chain_id: 100,
        contract: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
        last_updated: new Date()
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
      agents: {
        total_registered: KNOWN_AGENTS.length,
        known_agents: KNOWN_AGENTS,
        from_kv: [],
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
