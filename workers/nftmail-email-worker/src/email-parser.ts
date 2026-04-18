/// Email parsing and structured data extraction for Glassbox tier
/// Extracts key fields for LLM context injection and search functionality

export interface ParsedEmail {
  // Core fields
  sender: string;
  subject: string;
  summary: string;
  intent: string;
  
  // OTP detection
  isOtp: boolean;
  otpCode?: string;
  
  // Metadata
  timestamp: number;
  hasAttachments: boolean;
  isUrgent: boolean;
  
  // Structured content
  links: string[];
  mentions: string[];
  actionItems: string[];
  
  // Trust score impact for notapaperclip.red
  trustScoreImpact: string;
  senderDomain: string;
  senderReputation: 'high' | 'medium' | 'low' | 'unknown';
}

// Simple regex-based parsing (can be upgraded to LLM later)
export function parseEmailForGlassbox(email: {
  from: string;
  subject: string;
  content: string;
  timestamp: number;
}): ParsedEmail {
  const { from, subject, content, timestamp } = email;
  
  // Extract OTP codes (6-digit numbers common in verification emails)
  const otpRegex = /\b(\d{6})\b/g;
  const otpMatches = content.match(otpRegex);
  const isOtp = !!otpMatches;
  const otpCode = otpMatches ? otpMatches[0] : undefined;
  
  // Extract links
  const linkRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
  const links = content.match(linkRegex) || [];
  
  // Extract mentions (@username or @domain)
  const mentionRegex = /@[a-zA-Z0-9.-]+/g;
  const mentions = content.match(mentionRegex) || [];
  
  // Detect urgency
  const urgencyKeywords = ['urgent', 'asap', 'immediately', 'critical', 'emergency'];
  const isUrgent = urgencyKeywords.some(keyword => 
    subject.toLowerCase().includes(keyword) || 
    content.toLowerCase().includes(keyword)
  );
  
  // Detect attachments (simple heuristic)
  const hasAttachments = content.includes('attachment') || 
                        content.includes('attached') ||
                        content.includes('[image:') ||
                        content.includes('[document:');
  
  // Extract action items (lines starting with •, -, or containing "please", "action", "review")
  const actionItemRegex = /^[•\-\*]\s*(.+)$/gm;
  const actionMatches = content.match(actionItemRegex) || [];
  const actionItems = actionMatches.map(match => match.replace(/^[•\-\*]\s*/, ''));
  
  // Add more action detection
  const actionKeywords = ['please', 'action required', 'review', 'approve', 'sign', 'complete'];
  const lines = content.split('\n');
  for (const line of lines) {
    if (actionKeywords.some(keyword => line.toLowerCase().includes(keyword))) {
      actionItems.push(line.trim());
    }
  }
  
  // Generate summary (first sentence or first 100 chars)
  let summary = '';
  const firstSentence = content.match(/^[^.!?]*[.!?]/);
  if (firstSentence) {
    summary = firstSentence[0].trim();
  } else {
    summary = content.slice(0, 100) + (content.length > 100 ? '...' : '');
  }
  
  // Detect intent
  let intent = 'general';
  const contentLower = content.toLowerCase();
  const subjectLower = subject.toLowerCase();
  
  if (isOtp) {
    intent = 'verification';
  } else if (contentLower.includes('password') || contentLower.includes('reset')) {
    intent = 'security';
  } else if (contentLower.includes('billing') || contentLower.includes('invoice') || contentLower.includes('payment')) {
    intent = 'billing';
  } else if (contentLower.includes('welcome') || contentLower.includes('thank you for signing')) {
    intent = 'onboarding';
  } else if (contentLower.includes('meeting') || contentLower.includes('schedule') || contentLower.includes('calendar')) {
    intent = 'scheduling';
  } else if (isUrgent) {
    intent = 'urgent';
  } else if (actionItems.length > 0) {
    intent = 'action_required';
  }
  
  // Extract sender domain for trust scoring
  const senderDomain = from.split('@')[1]?.toLowerCase() || 'unknown';
  
  // Calculate sender reputation based on domain
  const highReputationDomains = [
    'google.com', 'microsoft.com', 'apple.com', 'amazon.com', 
    'visa.com', 'mastercard.com', 'paypal.com', 'stripe.com',
    'github.com', 'linkedin.com', 'twitter.com', 'facebook.com',
    'bankofamerica.com', 'chase.com', 'wellsfargo.com', 'citibank.com'
  ];
  
  const mediumReputationDomains = [
    'gmail.com', 'yahoo.com', 'outlook.com', 'icloud.com',
    'protonmail.com', 'tutanota.com', 'mail.com'
  ];
  
  let senderReputation: 'high' | 'medium' | 'low' | 'unknown' = 'unknown';
  let trustScoreImpact = '+0.0 (Neutral)';
  
  if (highReputationDomains.includes(senderDomain)) {
    senderReputation = 'high';
    trustScoreImpact = isOtp ? '+1.0 (Verified Financial Sender)' : '+0.5 (Verified Sender)';
  } else if (mediumReputationDomains.includes(senderDomain)) {
    senderReputation = 'medium';
    trustScoreImpact = '+0.2 (Standard Email Provider)';
  } else if (senderDomain === 'unknown') {
    senderReputation = 'low';
    trustScoreImpact = '-0.5 (Unknown Sender)';
  } else {
    senderReputation = 'low';
    trustScoreImpact = '0.0 (Custom Domain)';
  }
  
  return {
    sender,
    subject,
    summary,
    intent,
    isOtp,
    otpCode,
    timestamp,
    hasAttachments,
    isUrgent,
    links,
    mentions,
    actionItems,
    trustScoreImpact,
    senderDomain,
    senderReputation
  };
}

// Store parsed data in D1 database (or KV as fallback)
export async function storeParsedEmail(
  env: any,
  agentName: string,
  parsed: ParsedEmail,
  messageId: string
): Promise<void> {
  const storageKey = `parsed:${agentName}:${messageId}`;
  
  // Store in KV for now (can be upgraded to D1 later)
  const ttl = 8 * 24 * 60 * 60; // 8 days same as sovereign TTL
  
  await env.INBOX_KV.put(storageKey, JSON.stringify(parsed), {
    expirationTtl: ttl
  });
  
  // Also store in a searchable index (keyed by intent)
  const intentKey = `index:${agentName}:intent:${parsed.intent}`;
  const existing = await env.INBOX_KV.get(intentKey);
  const indexData = existing ? JSON.parse(existing) : [];
  
  indexData.push({
    messageId,
    timestamp: parsed.timestamp,
    subject: parsed.subject,
    sender: parsed.sender,
    summary: parsed.summary
  });
  
  // Keep only last 50 entries per intent
  if (indexData.length > 50) {
    indexData.splice(0, indexData.length - 50);
  }
  
  await env.INBOX_KV.put(intentKey, JSON.stringify(indexData), {
    expirationTtl: ttl
  });
}

// Search parsed emails by intent and filters
export async function searchParsedEmails(
  env: any,
  agentName: string,
  filters: {
    intent?: string;
    isOtp?: boolean;
    isUrgent?: boolean;
    limit?: number;
  }
): Promise<any[]> {
  const intent = filters.intent || 'all';
  const limit = filters.limit || 20;
  
  if (intent === 'all') {
    // Search across all intents
    const intents = ['verification', 'security', 'billing', 'onboarding', 'scheduling', 'urgent', 'action_required', 'general'];
    const results = [];
    
    for (const intentType of intents) {
      const intentKey = `index:${agentName}:intent:${intentType}`;
      const data = await env.INBOX_KV.get(intentKey);
      if (data) {
        const indexData = JSON.parse(data);
        results.push(...indexData);
      }
    }
    
    // Apply filters and sort by timestamp
    let filtered = results;
    if (filters.isOtp !== undefined) {
      // Need to fetch full parsed data to check isOtp
      filtered = await Promise.all(
        filtered.map(async (item) => {
          const fullData = await env.INBOX_KV.get(`parsed:${agentName}:${item.messageId}`);
          const parsed = fullData ? JSON.parse(fullData) : null;
          return parsed && parsed.isOtp === filters.isOtp ? item : null;
        })
      ).then(items => items.filter(Boolean));
    }
    
    return filtered
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  } else {
    // Search specific intent
    const intentKey = `index:${agentName}:intent:${intent}`;
    const data = await env.INBOX_KV.get(intentKey);
    
    if (!data) return [];
    
    let results = JSON.parse(data);
    
    // Apply additional filters
    if (filters.isOtp !== undefined || filters.isUrgent !== undefined) {
      results = await Promise.all(
        results.map(async (item) => {
          const fullData = await env.INBOX_KV.get(`parsed:${agentName}:${item.messageId}`);
          const parsed = fullData ? JSON.parse(fullData) : null;
          if (!parsed) return null;
          
          if (filters.isOtp !== undefined && parsed.isOtp !== filters.isOtp) return null;
          if (filters.isUrgent !== undefined && parsed.isUrgent !== filters.isUrgent) return null;
          
          return item;
        })
      ).then(items => items.filter(Boolean));
    }
    
    return results
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }
}
