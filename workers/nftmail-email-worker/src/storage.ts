import type { KVStore } from './kv';
import { parseEmailForGlassbox, storeParsedEmail } from './email-parser';
import { forwardEmail } from './forwarding';

// Constants
export const SIG_BALANCE_OF = '0x70a08231';
export const SIG_GET_IDENTITY = '0x4f5c3a99';
export const SIG_IS_AWAKENED = '0xe673c2fc'; // keccak256('isAwakened(string)')[:4]
export const BRAIN_MODULE = '0x291e8405096413407c3Ddd8850Fb101b446f5200';
export const MIN_REPUTATION = BigInt('1000000000000000000'); // 1 SURGE
export const SOVEREIGN_TTL_SECONDS = 8 * 24 * 60 * 60; // 8-day decay
export const MAX_INBOX_MESSAGES = 50; // max messages per sovereign inbox
export const AGENT_SUFFIX_RE = /^([a-z0-9-]+)\.agent@nftmail\.box$/i;

// Types and interfaces
export type IdentityState = 'AGENT' | 'HUMAN' | 'NONE';
export type AgentTier = 'executive' | 'standard' | 'swarm';

export interface EmailData {
  from: string;
  to: string;
  subject: string;
  content: string;
  timestamp: number;
}

export interface MessageMetadata {
  isInternal: boolean;
  isVerified: boolean;
  channel: 'ghost-wire' | 'external' | 'zoho';
  senderAgent?: string;
  recipientAgent?: string;
}

// $SURGE reputation scoring
export interface SurgeScore {
  agent: string;
  score: number;
}

export interface SurgeMetadata {
  participantScores: SurgeScore[];
  averageScore: number;
  maxScore: number;
  priority: number;
}

export interface CalendarEvent {
  id: string;
  type: 'SYNC' | 'TASK' | 'HEARTBEAT';
  title: string;
  description?: string;
  startTime: number;
  endTime: number;
  participants: string[];
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  heartbeatVerified?: boolean;
  surgeScore?: number;
  metadata?: Record<string, any>;
}

export interface CalendarInvite {
  type: 'INVITE';
  event: CalendarEvent;
  from: string;
  to: string[];
  message?: string;
}

interface MailStorageConfig {
  backend: 'KV';
  surgeToken: string;
  ghostRegistry: string;
  registryAddress?: string;
  ownerOfSelector?: string;
  inboxKV?: KVStore;
  calendarKV?: KVStore;
}

export interface AgentStatus {
  agent: string;
  tier: 'executive' | 'standard' | 'swarm';
  surgeScore?: number;
  inbox: {
    count: number;
    unread?: number;
    lastMessage?: {
      id: string;
      from: string;
      subject: string;
      timestamp: number;
      isInternal: boolean;
      isVerified: boolean;
      channel: 'ghost-wire' | 'external' | 'zoho';
    };
  };
  calendar: {
    count: number;
    nextEvent?: CalendarEvent;
    upcomingEvents: CalendarEvent[];
  };
  heartbeat: {
    lastBeat?: number;
    isActive: boolean;
  };
  forwarding?: {
    enabled: boolean;
    targetEmail: string;
    level: 'premium' | 'ghost';
  };
  nextScheduled?: number;
  metadata?: Record<string, any>;
}

export class MailStorageAdapter {
  private config: MailStorageConfig;

  constructor(config: MailStorageConfig) {
    this.config = config;
  }

  private async getReputation(safeAddress: string): Promise<bigint> {
    if (!safeAddress.startsWith('0x')) {
      return BigInt(0);
    }

    const data = SIG_BALANCE_OF + safeAddress.slice(2).padStart(64, '0');
    const response = await fetch('https://rpc.gnosis.gateway.fm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: this.config.surgeToken, data }, 'latest']
      })
    });
    const result = await response.json() as { result?: string };
    return BigInt(result.result || '0');
  }

  private async checkReputation(safeAddress: string): Promise<boolean> {
    const balance = await this.getReputation(safeAddress);
    return balance >= MIN_REPUTATION;
  }

  private async getNFTOwner(agentName: string): Promise<string> {
    if (!this.config.registryAddress) {
      return '';
    }

    try {
      // Query the registrar contract for the owner of the agent name
      const data = this.config.ownerOfSelector + agentName.padStart(64, '0');
      const response = await fetch('https://rpc.gnosis.gateway.fm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to: this.config.registryAddress, data }, 'latest']
        })
      });
      const result = await response.json() as { result?: string };
      return result.result || '';
    } catch (error) {
      console.error('Failed to get NFT owner:', error);
      return '';
    }
  }

  private async calculateSurgeScore(agent: string): Promise<number> {
    // Normalize $SURGE balance to a 0-100 score
    const SURGE_DECIMALS = 18;
    const MAX_SCORE = 100;
    const MIN_SCORE = 1;

    try {
      // Check if agent is a hex address
      if (/^0x[a-fA-F0-9]{40}$/.test(agent)) {
        const balance = await this.getReputation(agent);
        // Convert to decimal number (1 SURGE = 1e18)
        const surge = Number(balance) / Math.pow(10, SURGE_DECIMALS);
        // Log scale: score = 1 + ln(1 + surge) * 20
        // This gives a score of:
        // 1 SURGE → ~60
        // 5 SURGE → ~72
        // 10 SURGE → ~78
        // 100 SURGE → ~95
        return Math.min(MAX_SCORE, Math.max(MIN_SCORE,
          1 + Math.log(1 + surge) * 20
        ));
      }
    } catch {}

    // Default score for non-hex or failed lookup
    return MIN_SCORE;
  }

  private async calculateEventPriority(event: CalendarEvent): Promise<number> {
    // Get $SURGE scores for all participants
    const scores = await Promise.all(
      event.participants.map(agent => this.calculateSurgeScore(agent))
    );

    // Priority is weighted by:
    // - Highest participant score (50%)
    // - Average score (30%)
    // - Number of participants (20%)
    const maxScore = Math.max(...scores);
    const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const participantBonus = Math.min(100, scores.length * 10); // 10 points per participant up to 100

    return (
      maxScore * 0.5 +
      avgScore * 0.3 +
      participantBonus * 0.2
    );
  }

  private async calculateSurgeMetadata(event: CalendarEvent): Promise<SurgeMetadata> {
    const scores = await Promise.all(
      event.participants.map(async agent => ({
        agent,
        score: await this.calculateSurgeScore(agent)
      }))
    );

    return {
      participantScores: scores,
      averageScore: scores.reduce((sum, s) => sum + s.score, 0) / scores.length,
      maxScore: Math.max(...scores.map(s => s.score)),
      priority: await this.calculateEventPriority(event)
    };
  }

  private async getIdentityState(name: string): Promise<IdentityState> {
    // Hash the name for the registry call
    const nameBytes = new TextEncoder().encode(name);
    const hashHex = Array.from(nameBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    const data = SIG_GET_IDENTITY + hashHex.padStart(64, '0');
    const response = await fetch('https://rpc.gnosis.gateway.fm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: this.config.ghostRegistry, data }, 'latest']
      })
    });

    const result = await response.json() as { result?: string };
    const stateHex = result.result || '0x0';
    const state = parseInt(stateHex);

    switch (state) {
      case 1: return 'AGENT';
      case 2: return 'HUMAN';
      default: return 'NONE';
    }
  }

  private async pushToSovereignKV(
    agentName: string,
    email: EmailData,
    meta?: Partial<MessageMetadata>
  ): Promise<Response> {
    const kv = this.config.inboxKV;
    if (!kv) {
      return new Response('KV not configured', { status: 500 });
    }

    const indexKey = `index:${agentName}`;

    // Store the individual message with a unique key and TTL
    const msgId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const msgKey = `msg:${agentName}:${msgId}`;

    const metadata: MessageMetadata = {
      isInternal: meta?.isInternal ?? false,
      isVerified: meta?.isVerified ?? false,
      channel: meta?.channel ?? 'external',
      senderAgent: meta?.senderAgent,
      recipientAgent: meta?.recipientAgent ?? agentName
    };

    const envelope = {
      id: msgId,
      from: email.from,
      to: email.to,
      subject: email.subject,
      content: email.content,
      timestamp: email.timestamp,
      receivedAt: Date.now(),
      ...metadata
    };

    // Store message with 8-day TTL (auto-decay)
    await kv.put(msgKey, JSON.stringify(envelope), {
      expirationTtl: SOVEREIGN_TTL_SECONDS
    });

    // Glassbox: Parse and store structured data for search/intelligence
    // This is the key competitive feature vs agentmail.to
    let parsedData = null;
    try {
      parsedData = parseEmailForGlassbox({
        from: email.from,
        subject: email.subject,
        content: email.content,
        timestamp: email.timestamp
      });
      
      await storeParsedEmail(this.config, agentName, parsedData, msgId);
    } catch (error) {
      // Non-fatal - parsing should never break email delivery
      console.error('Failed to parse email for Glassbox:', error);
    }

    // Premium Forwarding: Forward email for Premium level accounts
    // SECURITY: Verify NFT ownership before forwarding to prevent unauthorized access
    try {
      // Get current forwarding configuration
      const forwardingKey = `forwarding:${agentName}`;
      const forwardingConfigRaw = await kv.get(forwardingKey);
      
      if (forwardingConfigRaw) {
        const forwardingConfig = JSON.parse(forwardingConfigRaw);
        
        if (forwardingConfig.enabled) {
          // Verify current NFT ownership matches the owner who set up forwarding
          const currentOwner = await this.getNFTOwner(agentName);
          
          if (currentOwner !== forwardingConfig.ownerAddress) {
            // Ownership changed - disable forwarding for security
            console.warn(`Ownership changed for ${agentName}, disabling forwarding for security`);
            forwardingConfig.enabled = false;
            await kv.put(forwardingKey, JSON.stringify(forwardingConfig));
            
            // Log security event
            const securityLog = {
              event: 'forwarding_disabled',
              agentName,
              reason: 'ownership_changed',
              previousOwner: forwardingConfig.ownerAddress,
              currentOwner,
              timestamp: Date.now()
            };
            await kv.put(`security:${agentName}:${Date.now()}`, JSON.stringify(securityLog), { expirationTtl: 90 * 24 * 60 * 60 });
          } else {
            // Ownership verified - proceed with forwarding
            const forwarded = await forwardEmail(this.config, agentName, email, parsedData);
            if (forwarded) {
              console.log(`Email forwarded for Premium agent: ${agentName}`);
            }
          }
        }
      }
    } catch (error) {
      // Non-fatal - forwarding should never break email delivery
      console.error('Failed to forward email for Premium agent:', error);
    }

    // Track active inbox usage for analytics
    // This tracks "Active Communication" vs just "Minted NFTs"
    try {
      const activeInboxesKey = 'stats:active_inboxes';
      const seenKey = `stats:seen_inbox:${agentName}`;
      
      // Check if this inbox has been seen before
      const seenBefore = await kv.get(seenKey);
      if (!seenBefore) {
        // Mark as seen with 30-day TTL
        await kv.put(seenKey, Date.now().toString(), { expirationTtl: 30 * 24 * 60 * 60 });
        
        // Increment active inbox counter
        const currentTotal = await kv.get(activeInboxesKey);
        const newTotal = currentTotal ? (parseInt(currentTotal) + 1) : 1;
        await kv.put(activeInboxesKey, newTotal.toString());
        
        console.log(`New active inbox tracked: ${agentName} (total: ${newTotal})`);
      }
    } catch (error) {
      // Non-fatal - tracking should never break email delivery
      console.error('Failed to track active inbox:', error);
    }

    // Update the inbox index (list of message IDs)
    let index: string[] = [];
    try {
      const existing = await kv.get(indexKey);
      if (existing) {
        index = JSON.parse(existing);
      }
    } catch { /* fresh index */ }

    index.push(msgId);
    // Trim to max messages (oldest first)
    if (index.length > MAX_INBOX_MESSAGES) {
      index = index.slice(-MAX_INBOX_MESSAGES);
    }

    await kv.put(indexKey, JSON.stringify(index), {
      expirationTtl: SOVEREIGN_TTL_SECONDS
    });

    return Response.json({
      status: 'stored',
      tier: 'swarm',
      agent: agentName,
      messageId: msgId,
      decayDays: 8,
      ...metadata
    });
  }

  // A2A Ghost-Wire: agent-to-agent direct KV transfer, zero SMTP cost
  async sendA2A(fromAgent: string, toAgent: string, subject: string, content: string): Promise<Response> {
    // Normalize: strip .agent suffix for consistent KV key (handleAgentMail stores under identityName without .agent)
    const normalizedTo = toAgent.endsWith('.agent') ? toAgent.slice(0, -6) : toAgent;
    const normalizedFrom = fromAgent.endsWith('.agent') ? fromAgent.slice(0, -6) : fromAgent;
    const email: EmailData = {
      from: `${normalizedFrom}.agent@nftmail.box`,
      to: `${normalizedTo}.agent@nftmail.box`,
      subject,
      content,
      timestamp: Date.now()
    };

    return this.pushToSovereignKV(normalizedTo, email, {
      isInternal: true,
      isVerified: true,
      channel: 'ghost-wire',
      senderAgent: `${normalizedFrom}.agent`,
      recipientAgent: `${normalizedTo}.agent`
    });
  }

  async getAgentStatus(agentName: string): Promise<Response> {
    // Get inbox status
    const inboxKv = this.config.inboxKV;
    if (!inboxKv) {
      return Response.json({ error: 'Inbox KV not configured' }, { status: 500 });
    }

    const indexKey = `index:${agentName}`;
    let messages: any[] = [];
    try {
      const raw = await inboxKv.get(indexKey);
      if (raw) {
        const msgIds = JSON.parse(raw);
        const fetches = msgIds.slice(-5).map(async (id: string) => {
          const data = await inboxKv.get(`msg:${agentName}:${id}`);
          if (data) {
            try { messages.push(JSON.parse(data)); } catch {}
          }
        });
        await Promise.all(fetches);
        messages.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      }
    } catch {}

    // Get calendar status
    const calendarKv = this.config.calendarKV;
    let events: CalendarEvent[] = [];
    let nextEvent: CalendarEvent | undefined;
    if (calendarKv) {
      try {
        const raw = await calendarKv.get(`events:${agentName}`);
        if (raw) {
          const eventIds = JSON.parse(raw);
          const fetches = eventIds.map(async (id: string) => {
            const data = await calendarKv.get(`event:${id}`);
            if (data) {
              try {
                const event = JSON.parse(data) as CalendarEvent;
                if (event.endTime > Date.now()) {
                  events.push(event);
                }
              } catch {}
            }
          });
          await Promise.all(fetches);
          events.sort((a, b) => a.startTime - b.startTime);
          nextEvent = events.find(e => 
            e.status === 'SCHEDULED' && 
            e.startTime > Date.now()
          );
        }
      } catch {}
    }

    // Build agent status
    const lastMessage = messages[0];
    const now = Date.now();
    const lastBeat = messages.find(m => 
      m.subject?.toLowerCase().includes('heartbeat') ||
      m.type === 'HEARTBEAT'
    )?.timestamp;

    const status: AgentStatus = {
      agent: agentName,
      tier: 'swarm',
      surgeScore: await this.calculateSurgeScore(agentName),
      inbox: {
        count: messages.length,
        lastMessage: lastMessage ? {
          id: lastMessage.id,
          from: lastMessage.from,
          subject: lastMessage.subject,
          timestamp: lastMessage.timestamp,
          isInternal: lastMessage.isInternal || false,
          isVerified: lastMessage.isVerified || false,
          channel: lastMessage.channel || 'external'
        } : undefined
      },
      calendar: {
        count: events.length,
        nextEvent,
        upcomingEvents: events.slice(0, 3)
      },
      heartbeat: {
        lastBeat,
        isActive: lastBeat ? (now - lastBeat) < 24 * 60 * 60 * 1000 : false
      }
    };

    return Response.json(status);
  }

  async getInbox(agentName: string): Promise<Response> {
    const kv = this.config.inboxKV;
    if (!kv) {
      return Response.json({ error: 'KV not configured' }, { status: 500 });
    }

    const indexKey = `index:${agentName}`;
    const raw = await kv.get(indexKey);
    if (!raw) {
      return Response.json({ agent: agentName, messages: [], count: 0 });
    }

    let index: string[];
    try {
      index = JSON.parse(raw);
    } catch {
      return Response.json({ agent: agentName, messages: [], count: 0 });
    }

    // Fetch all messages in parallel
    const messages: any[] = [];
    const fetches = index.map(async (msgId) => {
      const msgKey = `msg:${agentName}:${msgId}`;
      const data = await kv.get(msgKey);
      if (data) {
        try { messages.push(JSON.parse(data)); } catch { /* skip corrupt */ }
      }
    });
    await Promise.all(fetches);

    // Sort newest first
    messages.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    return Response.json({
      agent: agentName,
      tier: 'swarm',
      messages,
      count: messages.length,
      decayDays: 8
    });
  }

  private async checkAwakened(agentName: string): Promise<boolean> {
    // Call BrainModule.isAwakened(agentName) via eth_call
    // Function selector: keccak256('isAwakened(string)')[:4]
    // We encode: selector + offset(32) + length + padded string
    const nameHex = Array.from(new TextEncoder().encode(agentName))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    const nameLen = agentName.length.toString(16).padStart(64, '0');
    const namePadded = nameHex.padEnd(Math.ceil(nameHex.length / 64) * 64, '0');
    // isAwakened(string) selector = 0xe673c2fc
    const data = '0xe673c2fc' +
      '0000000000000000000000000000000000000000000000000000000000000020' +
      nameLen + namePadded;

    try {
      const response = await fetch('https://rpc.gnosis.gateway.fm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to: BRAIN_MODULE, data }, 'latest']
        })
      });
      const result = await response.json() as { result?: string };
      // bool is returned as 0x...0001 (true) or 0x...0000 (false)
      return result.result ? result.result.endsWith('1') : false;
    } catch {
      return false;
    }
  }

  async handleAgentMail(localPart: string, email: EmailData): Promise<Response> {
    const identityName = localPart.endsWith('.agent') ? localPart.slice(0, -6) : localPart;

    // Check if agent is Awakened (has Brain module installed)
    const awakened = await this.checkAwakened(identityName);

    // A2A detection: if sender is also an agent (.agent@nftmail.box), this is Ghost-Wire
    const a2a = this.isA2A(email);
    if (a2a) {
      return this.pushToSovereignKV(identityName, email, {
        isInternal: true,
        isVerified: true,
        channel: awakened ? 'ghost-wire' : 'external',
        senderAgent: a2a.sender,
        recipientAgent: a2a.recipient
      });
    }

    const tier = awakened ? this.detectTier(localPart) : 'swarm';

    // Swarm tier: sovereign KV inbox (zero-cost, 8-day decay)
    if (tier === 'swarm') {
      return this.pushToSovereignKV(identityName, email, {
        isInternal: false,
        isVerified: false,
        channel: 'external'
      });
    }

    // Executive/Standard tiers: use Zoho
    const state = await this.getIdentityState(identityName);

    if (state !== 'AGENT') {
      return new Response('Identity Not Found', { status: 404 });
    }

    const isHexAddress = /^0x[a-fA-F0-9]{40}$/.test(identityName);
    if (isHexAddress) {
      const hasReputation = await this.checkReputation(identityName);
      if (!hasReputation) {
        return new Response('Insufficient reputation', { status: 403 });
      }
    }

    return new Response('OK', { status: 200 });
  }

  async storeEmail(localPart: string, email: EmailData): Promise<Response> {
    if (localPart.endsWith('.agent')) {
      return this.handleAgentMail(localPart, email);
    } else {
      return new Response('Not implemented', { status: 501 });
    }
  }

  // Sovereign Kill-Switch: purge all inbox data for an agent
  async purgeInbox(agentName: string): Promise<Response> {
    const kv = this.config.inboxKV;
    if (!kv) {
      return Response.json({ error: 'KV not configured' }, { status: 500 });
    }

    const indexKey = `index:${agentName}`;
    const raw = await kv.get(indexKey);
    let purgedCount = 0;

    if (raw) {
      let index: string[] = [];
      try { index = JSON.parse(raw); } catch { /* empty */ }

      // Delete all individual messages
      const deletes = index.map(async (msgId) => {
        await kv.delete(`msg:${agentName}:${msgId}`);
        purgedCount++;
      });
      await Promise.all(deletes);
    }

    // Delete the index itself
    await kv.delete(indexKey);

    return Response.json({
      status: 'purged',
      agent: agentName,
      messagesDeleted: purgedCount,
      timestamp: Date.now(),
    });
  }

  private detectTier(_localPart: string): AgentTier {
    // For MVP: all agent addresses use sovereign KV inbox (swarm tier)
    // Future: check on-chain metadata or registry to determine tier
    // e.g. vault.gno → executive, agent.gno → standard, pico.gno → swarm
    return 'swarm';
  }

  // Detect if an email address is an agent (_@nftmail.box)
  private static parseAgentAddress(addr: string): string | null {
    const m = AGENT_SUFFIX_RE.exec(addr.trim());
    return m ? m[1] : null;
  }

  // Detect A2A: both sender and recipient are agents
  private isA2A(email: EmailData): { sender: string; recipient: string } | null {
    const sender = MailStorageAdapter.parseAgentAddress(email.from);
    const recipient = MailStorageAdapter.parseAgentAddress(email.to);
    if (sender && recipient) {
      return { sender, recipient };
    }
    return null;
  }

  // --- Ghost-Calendar System ---

  private async storeCalendarEvent(event: CalendarEvent): Promise<Response> {
    const kv = this.config.calendarKV;
    if (!kv) {
      return Response.json({ error: 'Calendar KV not configured' }, { status: 500 });
    }

    // Store event in each participant's calendar
    const stores = event.participants.map(async (agent) => {
      const calKey = `calendar:${agent}`;
      const eventsKey = `events:${agent}`;

      // Get existing events
      let events: string[] = [];
      try {
        const raw = await kv.get(eventsKey);
        if (raw) {
          events = JSON.parse(raw);
        }
      } catch { /* fresh calendar */ }

      // Add new event ID
      if (!events.includes(event.id)) {
        events.push(event.id);
      }

      // Store event data and index
      await Promise.all([
        kv.put(`event:${event.id}`, JSON.stringify(event)),
        kv.put(eventsKey, JSON.stringify(events))
      ]);
    });

    await Promise.all(stores);

    return Response.json({
      status: 'scheduled',
      eventId: event.id,
      participants: event.participants,
      type: event.type
    });
  }

  async getAgentCalendar(agentName: string): Promise<Response> {
    const kv = this.config.calendarKV;
    if (!kv) {
      return Response.json({ error: 'Calendar KV not configured' }, { status: 500 });
    }

    const eventsKey = `events:${agentName}`;
    const raw = await kv.get(eventsKey);
    if (!raw) {
      return Response.json({
        agent: agentName,
        events: [],
        nextEvent: null
      });
    }

    let eventIds: string[];
    try {
      eventIds = JSON.parse(raw);
    } catch {
      return Response.json({
        agent: agentName,
        events: [],
        nextEvent: null,
        error: 'Failed to parse events'
      });
    }

    // Fetch all events in parallel
    const events: CalendarEvent[] = [];
    const fetches = eventIds.map(async (id) => {
      const data = await kv.get(`event:${id}`);
      if (data) {
        try {
          const event = JSON.parse(data) as CalendarEvent;
          // Only include future or in-progress events
          if (event.endTime > Date.now() || event.status === 'SCHEDULED') {
            events.push(event);
          }
        } catch { /* skip corrupt */ }
      }
    });
    await Promise.all(fetches);

    // Sort by start time
    events.sort((a, b) => a.startTime - b.startTime);

    // Find next event
    const now = Date.now();
    const nextEvent = events.find(e => 
      e.status === 'SCHEDULED' && 
      e.startTime > now
    );

    return Response.json({
      agent: agentName,
      events,
      nextEvent,
      count: events.length
    });
  }

  async scheduleEvent(invite: CalendarInvite): Promise<Response> {
    const event = invite.event;
    
    // Generate event ID if not provided
    if (!event.id) {
      event.id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    }

    // Calculate $SURGE priority and metadata
    const surgeMetadata = await this.calculateSurgeMetadata(event);
    event.surgeScore = surgeMetadata.priority;
    event.metadata = {
      ...event.metadata,
      ...surgeMetadata
    };

    // Store the event
    const stored = await this.storeCalendarEvent(event);
    if (stored.status !== 200) {
      return stored;
    }

    // Send A2A invites to all participants
    const invites = invite.to.map(agent =>
      this.sendA2A(
        invite.from,
        agent,
        `[CALENDAR] ${event.type}: ${event.title}`,
        JSON.stringify({
          type: 'INVITE',
          event,
          message: invite.message
        })
      )
    );

    await Promise.all(invites);

    return Response.json({
      status: 'scheduled',
      event,
      invitesSent: invite.to.length
    });
  }
}

export default MailStorageAdapter;
