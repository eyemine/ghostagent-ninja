/// @module glassbox-xmtp-logger
/// Tiered Glass Box logging based on XMTP toggle state.
///
/// XMTP OFF → full metadata log (hash + timestamp + participants + type)
/// XMTP ON  → hash only (no content, no participants — privacy preserved)
/// Owner opt-in → enhanced logging regardless of XMTP state (reputation boost)

export type GlassBoxEventType =
  | 'email-received'
  | 'email-sent'
  | 'xmtp-message'
  | 'xmtp-toggle'
  | 'alias-created'
  | 'alias-revoked'
  | 'stealth-alias-created'
  | 'stealth-alias-revoked'
  | 'molt-transition'
  | 'privacy-change';

export interface GlassBoxEntry {
  id: string;
  agentName: string;
  tld: string;
  eventType: GlassBoxEventType;
  timestamp: number;
  contentHash: string;
  /** XMTP mode at time of log — determines what fields are populated */
  xmtpEnabled: boolean;
  /** Owner opted into enhanced logging for reputation boost */
  enhancedLogging: boolean;

  // Populated when xmtpEnabled=false OR enhancedLogging=true
  from?: string;
  to?: string;
  subject?: string;
  participants?: string[];
  protocol?: 'email' | 'xmtp';

  // Always present
  edgeEncryptNote: string;

  // XMTP-specific (only when eventType=xmtp-toggle)
  xmtpStatus?: 'enabled' | 'disabled';

  // Redaction
  redacted?: boolean;
  redactionReason?: string;
}

export interface LogOptions {
  agentName: string;
  tld: string;
  eventType: GlassBoxEventType;
  contentHash: string;
  xmtpEnabled: boolean;
  enhancedLogging?: boolean;
  // Full metadata — only logged when XMTP off or enhanced mode
  from?: string;
  to?: string;
  subject?: string;
  participants?: string[];
  protocol?: 'email' | 'xmtp';
  xmtpStatus?: 'enabled' | 'disabled';
  redacted?: boolean;
  redactionReason?: string;
}

export function buildGlassBoxEntry(opts: LogOptions): GlassBoxEntry {
  const enhanced = opts.enhancedLogging ?? false;
  const includeMetadata = !opts.xmtpEnabled || enhanced;

  const entry: GlassBoxEntry = {
    id: `gb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    agentName: opts.agentName,
    tld: opts.tld,
    eventType: opts.eventType,
    timestamp: Date.now(),
    contentHash: opts.contentHash,
    xmtpEnabled: opts.xmtpEnabled,
    enhancedLogging: enhanced,
    edgeEncryptNote: opts.xmtpEnabled
      ? 'Glass Box Audit: XMTP Enabled (Hash Only)'
      : 'Glass Box Audit: Full Metadata',
  };

  if (includeMetadata) {
    if (opts.from)         entry.from         = opts.from;
    if (opts.to)           entry.to           = opts.to;
    if (opts.subject)      entry.subject      = opts.subject;
    if (opts.participants) entry.participants = opts.participants;
    if (opts.protocol)     entry.protocol     = opts.protocol;
  }

  if (opts.xmtpStatus)      entry.xmtpStatus      = opts.xmtpStatus;
  if (opts.redacted)        entry.redacted         = opts.redacted;
  if (opts.redactionReason) entry.redactionReason  = opts.redactionReason;

  return entry;
}

/** Summarise entry for display — safe to render in UI */
export function summariseEntry(entry: GlassBoxEntry): string {
  if (entry.eventType === 'xmtp-toggle') {
    return `XMTP ${entry.xmtpStatus === 'enabled' ? 'enabled' : 'disabled'} by owner`;
  }
  if (entry.xmtpEnabled && !entry.enhancedLogging) {
    return `${entry.eventType} — hash only`;
  }
  if (entry.from && entry.subject) {
    return `${entry.eventType} from ${entry.from} — "${entry.subject}"`;
  }
  return entry.eventType;
}
