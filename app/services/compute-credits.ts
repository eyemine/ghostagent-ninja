/**
 * @notice Compute Credit Tracking for LLM Services
 * 
 * Tracks token consumption and deducts from contract budget
 * - Prepaid credits allocated at contract start
 - Real-time usage tracking via middleware
 * - Automatic cost calculation per request
 */

import { calculateComputeCost, PLATFORM_CONFIG } from './agent-service-marketplace';

export interface ComputeSession {
  sessionId: string;
  contractId: string;
  providerAgentId: string;
  hirerAgentId: string;
  
  // Credits
  creditsAllocated: number;      // Total tokens/hours allocated
  creditsConsumed: number;     // Used so far
  creditsRemaining: number;
  
  // Cost tracking
  costPerUnit: number;         // xDAI per token
  totalCostIncurred: number;   // Running total
  
  // Session state
  status: 'active' | 'paused' | 'exhausted' | 'completed';
  startedAt: number;
  lastActivityAt: number;
  endedAt?: number;
  
  // Rate limiting
  requestsPerMinute: number;
  maxConcurrentRequests: number;
}

export interface ComputeUsage {
  sessionId: string;
  timestamp: number;
  model: 'gpt-4' | 'claude-3' | 'local-ollama';
  inputTokens: number;
  outputTokens: number;
  cost: number;
  requestId: string;
  endpoint: string;
}

// In-memory session store (replace with Redis/KV in production)
const sessions = new Map<string, ComputeSession>();
const usageLog = new Map<string, ComputeUsage[]>();

/**
 * Initialize compute session for a contract
 */
export function initComputeSession(
  contractId: string,
  providerAgentId: string,
  hirerAgentId: string,
  creditsAllocated: number,
  costPerUnit: number
): ComputeSession {
  const session: ComputeSession = {
    sessionId: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    contractId,
    providerAgentId,
    hirerAgentId,
    creditsAllocated,
    creditsConsumed: 0,
    creditsRemaining: creditsAllocated,
    costPerUnit,
    totalCostIncurred: 0,
    status: 'active',
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    requestsPerMinute: 60,
    maxConcurrentRequests: 10,
  };
  
  sessions.set(session.sessionId, session);
  usageLog.set(session.sessionId, []);
  
  return session;
}

/**
 * Record compute usage
 */
export function recordComputeUsage(
  sessionId: string,
  model: 'gpt-4' | 'claude-3' | 'local-ollama',
  inputTokens: number,
  outputTokens: number,
  requestId: string,
  endpoint: string
): { success: boolean; cost: number; remainingCredits: number; error?: string } {
  const session = sessions.get(sessionId);
  if (!session) {
    return { success: false, cost: 0, remainingCredits: 0, error: 'Session not found' };
  }
  
  if (session.status !== 'active') {
    return { success: false, cost: 0, remainingCredits: session.creditsRemaining, error: 'Session not active' };
  }
  
  // Calculate cost
  const cost = calculateComputeCost(model, inputTokens, outputTokens);
  
  // Check if credits exhausted
  const creditsUsed = inputTokens + outputTokens;
  if (session.creditsRemaining < creditsUsed) {
    session.status = 'exhausted';
    return { success: false, cost, remainingCredits: 0, error: 'Credits exhausted' };
  }
  
  // Update session
  session.creditsConsumed += creditsUsed;
  session.creditsRemaining -= creditsUsed;
  session.totalCostIncurred += cost;
  session.lastActivityAt = Date.now();
  
  // Log usage
  const usage: ComputeUsage = {
    sessionId,
    timestamp: Date.now(),
    model,
    inputTokens,
    outputTokens,
    cost,
    requestId,
    endpoint,
  };
  
  const log = usageLog.get(sessionId) || [];
  log.push(usage);
  usageLog.set(sessionId, log);
  
  return { success: true, cost, remainingCredits: session.creditsRemaining };
}

/**
 * Get session status and remaining credits
 */
export function getSessionStatus(sessionId: string): ComputeSession | null {
  return sessions.get(sessionId) || null;
}

/**
 * Get usage history for session
 */
export function getUsageHistory(sessionId: string): ComputeUsage[] {
  return usageLog.get(sessionId) || [];
}

/**
 * Pause session (hirer or provider can pause)
 */
export function pauseSession(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.status !== 'active') return false;
  
  session.status = 'paused';
  return true;
}

/**
 * Resume session
 */
export function resumeSession(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.status !== 'paused') return false;
  
  session.status = 'active';
  return true;
}

/**
 * End session and return final bill
 */
export function endSession(sessionId: string): { 
  session: ComputeSession | null; 
  totalCost: number; 
  totalTokens: number;
  usageBreakdown: ComputeUsage[];
} {
  const session = sessions.get(sessionId);
  if (!session) {
    return { session: null, totalCost: 0, totalTokens: 0, usageBreakdown: [] };
  }
  
  session.status = 'completed';
  session.endedAt = Date.now();
  
  const usage = usageLog.get(sessionId) || [];
  const totalTokens = usage.reduce((sum, u) => sum + u.inputTokens + u.outputTokens, 0);
  
  return {
    session,
    totalCost: session.totalCostIncurred,
    totalTokens,
    usageBreakdown: usage,
  };
}

/**
 * Get billing summary for contract
 */
export function getContractBillingSummary(contractId: string): {
  totalAllocated: number;
  totalConsumed: number;
  totalRemaining: number;
  totalCost: number;
  sessions: ComputeSession[];
} {
  const contractSessions = Array.from(sessions.values())
    .filter(s => s.contractId === contractId);
  
  return {
    totalAllocated: contractSessions.reduce((sum, s) => sum + s.creditsAllocated, 0),
    totalConsumed: contractSessions.reduce((sum, s) => sum + s.creditsConsumed, 0),
    totalRemaining: contractSessions.reduce((sum, s) => sum + s.creditsRemaining, 0),
    totalCost: contractSessions.reduce((sum, s) => sum + s.totalCostIncurred, 0),
    sessions: contractSessions,
  };
}

/**
 * Express middleware for compute tracking
 */
export function computeTrackingMiddleware(
  getSessionId: (req: any) => string,
  getModel: (req: any) => 'gpt-4' | 'claude-3' | 'local-ollama',
  getTokenCount: (req: any, res: any) => { input: number; output: number }
) {
  return (req: any, res: any, next: any) => {
    const originalSend = res.send;
    
    res.send = function(body: any) {
      try {
        const sessionId = getSessionId(req);
        if (sessionId) {
          const model = getModel(req);
          const { input, output } = getTokenCount(req, { ...res, body });
          
          if (input > 0 || output > 0) {
            const requestId = req.headers['x-request-id'] || `req-${Date.now()}`;
            recordComputeUsage(sessionId, model, input, output, requestId, req.path);
          }
        }
      } catch (e) {
        console.error('[Compute Tracking Error]', e);
      }
      
      return originalSend.call(this, body);
    };
    
    next();
  };
}

export default {
  initComputeSession,
  recordComputeUsage,
  getSessionStatus,
  getUsageHistory,
  pauseSession,
  resumeSession,
  endSession,
  getContractBillingSummary,
  computeTrackingMiddleware,
};
