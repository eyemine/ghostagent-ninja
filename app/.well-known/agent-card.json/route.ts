/// GET /.well-known/agent-card.json?agent={name}&sld={sld}
/// Endpoint domain verification for ERC-8004 spec §4.2
/// Proxies to /api/agent-card for the actual response.

import { NextRequest } from 'next/server';
import { GET as agentCardGET } from '../../api/agent-card/route';

export { agentCardGET as GET };
export const dynamic = 'force-dynamic';
