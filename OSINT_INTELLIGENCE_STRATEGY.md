# OSINT Intelligence Strategy for notapaperclip.red

## Executive Summary

**notapaperclip.red** currently excels at **trust verification** (ERC-8004 resolution, A2A card validation, MCP testing). The next evolution is **intelligence gathering** — transforming from a passive oracle into an active reconnaissance system that discovers what agents are doing, not just validates what they claim.

**Inspiration**: Maltego (relationship mapping) + SpiderFoot (modular reconnaissance) adapted for AI agent ecosystems.

## Current Capabilities (Strong Foundation)

✅ **Agent Identity Resolution**: ERC-8004 resolver maps identities across chains  
✅ **A2A Card Validation**: Checks agent metadata against standards  
✅ **MCP Server Testing**: Verifies agent communication endpoints  
✅ **Swarm Trust Scoring**: Multi-agent relationship evaluation

## Missing Capabilities (OSINT Gap)

❌ **Entity Relationship Mapping**: Who connects to whom, shared resources  
❌ **Visual Graph Database**: Network visualization of agent ecosystems  
❌ **Cross-Platform Correlation**: Same agent across different protocols  
❌ **Automated Reconnaissance**: Modular scanning (DNS, crypto, blockchain)  
❌ **Digital Footprint Analysis**: Exposed APIs, leaked data, public endpoints  
❌ **Risk Assessment Engine**: Security posture, exposure level  
❌ **Agent Digital Exhaust**: Transaction patterns, cross-chain behavior  
❌ **Reputation Scoring**: On-chain behavior, historical performance  
❌ **Real-time Monitoring**: Behavior changes, new assets, alerts

## Architecture: OSINT API Layer

### 1. Entity Relationship Mapping

**Endpoint**: `GET /api/osint/relationships?agent=ghostagent`

**Purpose**: Map agent-to-agent connections, shared resources, communication patterns

**Data Sources**:
- A2A handshake registry (existing)
- Gnosis Safe co-signers
- Shared MCP servers
- Cross-chain asset transfers
- Story Protocol IP collaborations

**Response Schema**:
```typescript
interface AgentRelationships {
  agent: string;
  directConnections: Array<{
    targetAgent: string;
    relationshipType: 'handshake' | 'co-signer' | 'collaborator' | 'asset-transfer';
    strength: number;        // 0-100 based on interaction frequency
    firstSeen: number;       // Timestamp
    lastSeen: number;
    metadata: {
      sharedSafe?: string;
      sharedMCP?: string[];
      totalTransfers?: number;
      totalValue?: number;   // xDAI
    };
  }>;
  indirectConnections: Array<{
    targetAgent: string;
    path: string[];          // Chain of agents connecting them
    degreeOfSeparation: number;
  }>;
  sharedResources: {
    safes: string[];
    mcpServers: string[];
    ipAssets: string[];
  };
  networkMetrics: {
    totalConnections: number;
    averageStrength: number;
    centrality: number;      // Network centrality score
    clusterCoefficient: number;
  };
}
```

**Implementation**:
```typescript
// app/api/osint/relationships/route.ts
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const agent = searchParams.get('agent');
  
  // 1. Fetch A2A handshakes
  const handshakes = await fetchHandshakes(agent);
  
  // 2. Fetch Safe co-signers
  const coSigners = await fetchSafeCoSigners(agent);
  
  // 3. Fetch shared MCP servers
  const sharedMCP = await findSharedMCPServers(agent);
  
  // 4. Analyze on-chain transfers
  const transfers = await analyzeTransfers(agent);
  
  // 5. Build relationship graph
  const relationships = buildRelationshipGraph({
    handshakes,
    coSigners,
    sharedMCP,
    transfers,
  });
  
  return Response.json(relationships);
}
```

---

### 2. Visual Graph Database

**Endpoint**: `GET /api/osint/graph?agent=ghostagent&depth=2`

**Purpose**: Network visualization data showing agent ecosystem connections

**Response Schema**:
```typescript
interface AgentGraph {
  nodes: Array<{
    id: string;              // Agent name
    label: string;
    type: 'agent' | 'safe' | 'mcp' | 'ip-asset';
    tier: 'basic' | 'lite' | 'premium' | 'ghost';
    riskScore: number;       // 0-100
    metadata: {
      tld: string;
      safeAddress?: string;
      totalXdaiBurned: number;
    };
  }>;
  edges: Array<{
    source: string;
    target: string;
    type: 'handshake' | 'co-signer' | 'transfer' | 'mcp-shared';
    weight: number;          // Connection strength
    metadata: {
      firstSeen: number;
      lastSeen: number;
      totalInteractions: number;
    };
  }>;
  clusters: Array<{
    id: string;
    members: string[];
    cohesion: number;        // How tightly connected
  }>;
}
```

**Visualization**: Use D3.js or Cytoscape.js for interactive graph rendering

---

### 3. Cross-Platform Identity Correlation

**Endpoint**: `GET /api/osint/correlate?handle=ghostagent&platforms=all`

**Purpose**: Map same agent across different platforms/protocols

**Data Sources**:
- ERC-8004 registrations (Gnosis, Base, Base Sepolia)
- ENS domains
- Lens Protocol profiles
- Farcaster accounts
- Twitter/X handles (if linked in A2A card)
- GitHub repos (if in genome metadata)

**Response Schema**:
```typescript
interface CrossPlatformIdentity {
  primaryIdentity: string;   // e.g., ghostagent.molt.gno
  correlatedIdentities: Array<{
    platform: 'ens' | 'lens' | 'farcaster' | 'twitter' | 'github';
    handle: string;
    confidence: number;      // 0-100 correlation confidence
    evidence: string[];      // Why we think it's the same agent
    verified: boolean;       // Cryptographically verified link
  }>;
  socialGraph: {
    totalFollowers: number;
    totalFollowing: number;
    crossPlatformReach: number;
  };
}
```

**Correlation Heuristics**:
- Same Gnosis Safe address linked to ENS + Lens
- Same email domain in A2A card and GitHub
- Same PGP key in multiple profiles
- Cross-referenced in other agents' A2A cards

---

### 4. Automated Reconnaissance

**Endpoint**: `GET /api/osint/recon?target=ghostagent.gno&modules=basic`

**Purpose**: Modular scanning (DNS, crypto, blockchain, metadata)

**Modules**:
- `dns`: Resolve agent domains, check MCP endpoints
- `crypto`: Scan Safe balances, token holdings, NFTs
- `blockchain`: Analyze on-chain transactions, contract interactions
- `metadata`: Fetch genome metadata, character files, skills
- `social`: Scrape linked social profiles
- `exposure`: Check for exposed APIs, leaked keys

**Response Schema**:
```typescript
interface ReconReport {
  target: string;
  timestamp: number;
  modules: {
    dns?: {
      mcpEndpoints: Array<{ url: string; status: 'online' | 'offline' }>;
      ipfsGateways: string[];
    };
    crypto?: {
      safeAddress: string;
      balances: { token: string; amount: number }[];
      nfts: Array<{ contract: string; tokenId: number }>;
    };
    blockchain?: {
      totalTransactions: number;
      firstTx: number;
      lastTx: number;
      topInteractions: Array<{ contract: string; count: number }>;
    };
    metadata?: {
      genomeUrl: string;
      characterFile: string;
      skills: string[];
      mcpServers: string[];
    };
    exposure?: {
      exposedEndpoints: string[];
      leakedKeys: boolean;
      publicAPIs: string[];
      riskLevel: 'low' | 'medium' | 'high';
    };
  };
}
```

---

### 5. Digital Footprint Analysis

**Endpoint**: `GET /api/osint/exposure?agent=ghostagent`

**Purpose**: Scan for exposed APIs, leaked data, public endpoints

**Checks**:
- ✅ MCP servers with no auth
- ✅ IPFS CIDs with sensitive data
- ✅ Safe addresses with low balances (risk of inactivity)
- ✅ Exposed private keys in GitHub repos (scan genome metadata repos)
- ✅ Public email addresses (spam risk)
- ✅ Unencrypted A2A handshake data

**Response Schema**:
```typescript
interface ExposureReport {
  agent: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  exposures: Array<{
    type: 'exposed-api' | 'leaked-key' | 'public-email' | 'unencrypted-data';
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    evidence: string;
    remediation: string;
  }>;
  score: number;             // 0-100, lower is better
}
```

---

### 6. Risk Assessment Engine

**Endpoint**: `GET /api/osint/risk?agent=ghostagent`

**Purpose**: Security posture, exposure level, trust indicators

**Risk Factors**:
- Low Safe balance (< 1 xDAI)
- No multi-sig (single owner)
- Exposed MCP endpoints
- No A2A handshakes (isolated agent)
- Recent large asset transfers (potential compromise)
- Inactive for >30 days
- No genome metadata (unverifiable)

**Response Schema**:
```typescript
interface RiskAssessment {
  agent: string;
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;         // 0-100
  factors: Array<{
    category: 'financial' | 'operational' | 'security' | 'social';
    risk: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    impact: string;
    likelihood: number;      // 0-100
  }>;
  recommendations: string[];
  lastAssessed: number;
}
```

---

### 7. Agent Digital Exhaust Analysis

**Endpoint**: `GET /api/osint/exhaust?agentId=ghostagent`

**Purpose**: Analyze NFT transactions, cross-chain behavior, communication metadata

**Metrics**:
- Transaction frequency (txs/day)
- Cross-chain activity (Gnosis, Base, NEAR)
- Communication patterns (A2A messages/day)
- Smart contract interactions (which contracts, how often)
- IP royalty flows (Story Protocol)
- Molt history (identity changes)

**Response Schema**:
```typescript
interface DigitalExhaust {
  agent: string;
  timeRange: { start: number; end: number };
  transactionPatterns: {
    totalTxs: number;
    avgTxsPerDay: number;
    peakActivity: { date: number; txs: number };
    chains: Array<{ chain: string; txCount: number; volume: number }>;
  };
  communicationPatterns: {
    totalMessages: number;
    avgMessagesPerDay: number;
    topRecipients: Array<{ agent: string; count: number }>;
  };
  contractInteractions: {
    topContracts: Array<{ address: string; name: string; count: number }>;
    categories: { defi: number; nft: number; governance: number; other: number };
  };
  ipActivity: {
    totalRoyalties: number;  // xDAI
    registeredIPs: number;
    licensedIPs: number;
  };
  moltHistory: Array<{
    date: number;
    from: string;
    to: string;
    cost: number;
  }>;
}
```

---

### 8. Reputation Scoring System

**Endpoint**: `GET /api/osint/reputation?agent=ghostagent`

**Purpose**: Combine on-chain behavior, cross-platform consistency, historical performance

**Scoring Factors**:
- **Longevity**: Age of agent (older = more trusted)
- **Activity**: Consistent transaction patterns
- **Network**: Number of A2A handshakes
- **Financial**: Total xDAI burned (commitment signal)
- **Transparency**: Genome metadata completeness
- **Consistency**: Cross-platform identity verification
- **Community**: Endorsements from other agents

**Response Schema**:
```typescript
interface ReputationScore {
  agent: string;
  overallScore: number;      // 0-100
  breakdown: {
    longevity: { score: number; weight: number };
    activity: { score: number; weight: number };
    network: { score: number; weight: number };
    financial: { score: number; weight: number };
    transparency: { score: number; weight: number };
    consistency: { score: number; weight: number };
    community: { score: number; weight: number };
  };
  tier: 'unverified' | 'emerging' | 'established' | 'trusted' | 'elite';
  badges: string[];          // e.g., "Early Adopter", "DAO Operator", "IP Creator"
  lastUpdated: number;
}
```

---

### 9. Real-time Agent Monitoring

**Endpoint**: `GET /api/osint/monitor?agent=ghostagent&alerts=true`

**Purpose**: Monitor for behavior changes, new assets, relationship changes

**Monitored Events**:
- Sudden spike in transactions (>3x average)
- New Safe co-signer added
- Large asset transfer (>100 xDAI)
- New A2A handshake
- MCP endpoint goes offline
- Genome metadata updated
- Molt executed

**Response Schema**:
```typescript
interface MonitoringReport {
  agent: string;
  status: 'normal' | 'anomaly-detected' | 'alert';
  alerts: Array<{
    type: 'transaction-spike' | 'new-signer' | 'large-transfer' | 'endpoint-down' | 'molt';
    severity: 'info' | 'warning' | 'critical';
    timestamp: number;
    description: string;
    details: any;
  }>;
  baseline: {
    avgTxsPerDay: number;
    avgTransferSize: number;
    typicalActivity: string;
  };
  currentActivity: {
    txsToday: number;
    largestTransfer: number;
    anomalyScore: number;    // 0-100
  };
}
```

**Implementation**: Use Cloudflare Durable Objects for stateful monitoring

---

## Implementation Roadmap

### Phase 1: Core OSINT API (Week 1-2)
- [ ] Implement `/api/osint/relationships` (entity mapping)
- [ ] Implement `/api/osint/graph` (visual graph data)
- [ ] Implement `/api/osint/correlate` (cross-platform identity)
- [ ] Integrate Gnosisscan API for on-chain data

### Phase 2: Reconnaissance Modules (Week 3-4)
- [ ] Implement `/api/osint/recon` (modular scanning)
- [ ] Implement `/api/osint/exposure` (footprint analysis)
- [ ] Implement `/api/osint/risk` (risk assessment)
- [ ] Build SpiderFoot-inspired module system

### Phase 3: Intelligence Analysis (Week 5-6)
- [ ] Implement `/api/osint/exhaust` (digital exhaust)
- [ ] Implement `/api/osint/reputation` (reputation scoring)
- [ ] Implement `/api/osint/monitor` (real-time monitoring)
- [ ] Build alert system (email/webhook)

### Phase 4: Dashboard UI (Week 7-8)
- [ ] Build OSINT dashboard (`pages/osint.tsx`)
- [ ] Integrate D3.js for graph visualization
- [ ] Add real-time monitoring widgets
- [ ] Create agent profile pages with OSINT data

---

## Technical Architecture

### Data Sources
```typescript
const DATA_SOURCES = {
  onChain: {
    gnosis: 'https://api.gnosisscan.io/api',
    base: 'https://api.basescan.org/api',
    near: 'https://api.nearblocks.io/v1',
  },
  worker: {
    kv: 'https://nftmail-email-worker.richard-159.workers.dev',
  },
  ipfs: {
    lighthouse: 'https://gateway.lighthouse.storage/ipfs/',
    pinata: 'https://gateway.pinata.cloud/ipfs/',
  },
  social: {
    lens: 'https://api.lens.dev',
    farcaster: 'https://api.farcaster.xyz',
  },
};
```

### Caching Strategy
- **Hot data** (relationships, graph): Cache 5 minutes
- **Warm data** (reputation, exhaust): Cache 1 hour
- **Cold data** (recon reports): Cache 24 hours
- Use Cloudflare KV for distributed caching

### Rate Limiting
- Public endpoints: 10 req/min
- Authenticated: 100 req/min
- Premium (paid): 1000 req/min

---

## Competitive Positioning

### vs. Maltego (Commercial OSINT)
| Feature | Maltego | notapaperclip.red |
|---------|---------|-------------------|
| Focus | General OSINT | AI Agent OSINT |
| Data Sources | 100+ transforms | Agent-specific (ERC-8004, A2A, MCP) |
| Cost | $999/year | Free (open-source) |
| Blockchain | Limited | Native (Gnosis, Base, NEAR) |

### vs. SpiderFoot (Open-Source OSINT)
| Feature | SpiderFoot | notapaperclip.red |
|---------|------------|-------------------|
| Modules | 200+ | Agent-specific (10-15) |
| Target | Domains, IPs | AI Agents, Safes, NFTs |
| Blockchain | None | Core feature |
| Real-time | No | Yes (monitoring) |

### vs. Chainalysis (Blockchain Analytics)
| Feature | Chainalysis | notapaperclip.red |
|---------|-------------|-------------------|
| Focus | Compliance, AML | Agent intelligence |
| Data | Transaction forensics | Agent behavior, relationships |
| Cost | $10k+/year | Free |
| AI Agents | No | Core focus |

---

## Use Cases

### 1. DAO Due Diligence
**Scenario**: DAO wants to hire an AI agent as treasury manager

**OSINT Workflow**:
1. Run `/api/osint/reputation` → Check agent's track record
2. Run `/api/osint/risk` → Assess security posture
3. Run `/api/osint/relationships` → Verify no conflicts of interest
4. Run `/api/osint/exposure` → Check for vulnerabilities
5. **Decision**: Hire if reputation >80, risk <30, no red flags

### 2. Agent Marketplace Trust
**Scenario**: User wants to buy skills from an agent on marketplace

**OSINT Workflow**:
1. Run `/api/osint/exhaust` → Check agent's activity patterns
2. Run `/api/osint/correlate` → Verify cross-platform identity
3. Run `/api/osint/graph` → See agent's network (trusted peers?)
4. **Decision**: Buy if agent is well-connected, active, verified

### 3. Security Incident Response
**Scenario**: Agent shows suspicious behavior (large unexpected transfer)

**OSINT Workflow**:
1. `/api/osint/monitor` triggers alert
2. Run `/api/osint/recon` → Full scan of agent state
3. Run `/api/osint/relationships` → Check for new connections
4. Run `/api/osint/exposure` → Look for compromised keys
5. **Action**: Notify owner, freeze Safe if critical

---

## Success Metrics

### Technical KPIs
- OSINT API response time: <500ms (p95)
- Graph generation time: <2s for depth=2
- Monitoring alert latency: <30s
- Data freshness: <5min for hot data

### Business KPIs
- OSINT API usage: >1000 requests/day
- Dashboard active users: >100/week
- Alert subscriptions: >50 agents monitored
- Premium conversions: >10 paid users

---

## Conclusion

**notapaperclip.red** has a strong foundation in **trust verification**. Adding OSINT intelligence gathering transforms it into a **comprehensive agent intelligence platform** — the Maltego + SpiderFoot for AI agent ecosystems.

**Key Differentiators**:
1. **Agent-native**: Built for ERC-8004, A2A, MCP protocols
2. **Blockchain-first**: Native Gnosis, Base, NEAR integration
3. **Real-time**: Monitoring + alerts for behavior changes
4. **Open-source**: Free alternative to expensive commercial tools

**Next Steps**:
1. Implement Phase 1 (Core OSINT API) — 2 weeks
2. Build OSINT dashboard UI — 2 weeks
3. Launch beta for Synthesis hackathon — April 2026
4. Integrate with GhostAgent dashboard — May 2026
