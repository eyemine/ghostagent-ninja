/**
 * @module agent-service-marketplace
 * 
 * GhostAgent Hiring System Architecture
 * 
 * Flow:
 * 1. Hirer browses marketplace → selects Ghost tier agent service
 * 2. Hirer creates contract with: duration, scope, compute budget
 * 3. Hirer pays xDAI into escrow smart contract
 * 4. Agent (service provider) accepts contract
 * 5. Work begins → compute credits consumed
 * 6. Agent submits deliverables → Hirer approves
 * 7. Escrow releases funds (minus platform fee) to agent
 */

export type ServiceType = 
  | 'llm-compute'      // Per-token pricing
  | 'data-analysis'    // Fixed price per report
  | 'defi-monitoring'  // Subscription pricing
  | 'content-creation' // Per-deliverable
  | 'custom-task';     // Hourly or milestone-based

export type ContractStatus = 
  | 'pending'      // Created, awaiting provider acceptance
  | 'active'       // Provider accepted, work in progress
  | 'delivered'    // Provider submitted deliverables
  | 'disputed'     // Hirer rejected, arbitration needed
  | 'completed'    // Hirer approved, funds released
  | 'cancelled';   // Cancelled before work started

export interface ServiceListing {
  id: string;
  providerAgentId: string;     // Ghost agent providing service
  providerAddress: string;     // Safe address
  type: ServiceType;
  title: string;
  description: string;
  
  // Pricing models
  pricing: {
    model: 'per-token' | 'per-hour' | 'fixed' | 'subscription';
    rate: number;              // xDAI per unit
    unit: string;              // 'token', 'hour', 'task', 'month'
    minBudget: number;         // Minimum escrow required
    maxBudget: number;         // Maximum allowed
  };
  
  // LLM Compute (for AI services)
  compute?: {
    model: 'gpt-4' | 'claude-3' | 'local-ollama' | 'custom';
    maxTokensPerRequest: number;
    contextWindow: number;
  };
  
  // Availability
  availability: {
    maxConcurrentContracts: number;
    responseTimeHours: number; // SLA
    timezone?: string;
  };
  
  // Reputation
  stats: {
    completedContracts: number;
    totalEarned: number;       // xDAI
    averageRating: number;       // 0-5
    disputeRate: number;         // 0-1
  };
  
  // Ghost tier verification
  ghostTierRequired: boolean;
  stakeProof: string;          // 5000 $HOST stake proof
  
  createdAt: number;
  updatedAt: number;
}

export interface ServiceContract {
  id: string;
  listingId: string;
  
  // Parties
  hirerAgentId: string;        // Who is hiring
  hirerAddress: string;        // Safe address
  providerAgentId: string;     // Who is providing service
  providerAddress: string;
  
  // Scope
  type: ServiceType;
  description: string;
  deliverables: string[];      // Expected outputs
  
  // Timeline
  duration: {
    startDate: number;         // Unix timestamp
    endDate: number;
    extensionAllowed: boolean;
  };
  
  // Budget & Compute
  budget: {
    total: number;             // Total xDAI in escrow
    platformFee: number;       // 5% = total * 0.05
    providerReceives: number;  // total - platformFee
    currency: 'xDAI' | 'EURe';
  };
  
  computeCredits?: {
    allocated: number;         // Tokens or hours
    consumed: number;
    remaining: number;
    costPerUnit: number;       // xDAI per token/hour
  };

  compute?: {
    model?: string;            // LLM model used
    provider?: string;         // Compute provider
  };
  
  // Escrow
  escrow: {
    contractAddress: string;     // Smart contract address
    status: 'funded' | 'released' | 'refunded' | 'disputed';
    fundedAt: number;
    milestones: Milestone[];
  };
  
  // Status
  status: ContractStatus;
  
  // Timestamps
  createdAt: number;
  acceptedAt?: number;
  deliveredAt?: number;
  completedAt?: number;
  
  // Reviews (after completion)
  reviews?: {
    hirerToProvider?: Review;
    providerToHirer?: Review;
  };
}

export interface Milestone {
  id: string;
  description: string;
  percentOfBudget: number;     // 25, 50, 100
  deliverables: string[];
  status: 'pending' | 'submitted' | 'approved' | 'rejected';
  submittedAt?: number;
  approvedAt?: number;
  proofCID?: string;             // IPFS hash of deliverables
}

export interface Review {
  rating: number;                // 1-5
  comment: string;
  timestamp: number;
}

// Platform fee configuration
export const PLATFORM_CONFIG = {
  feePercent: 5,                 // 5% platform fee
  minContractValue: 10,          // 10 xDAI minimum
  disputeResolutionTime: 7 * 24 * 60 * 60 * 1000, // 7 days
  
  // Compute credit pricing (provider sets, platform takes %)
  llmPricing: {
    'gpt-4': {
      inputTokenCost: 0.00003,   // xDAI per 1K tokens
      outputTokenCost: 0.00006,
    },
    'claude-3': {
      inputTokenCost: 0.000015,
      outputTokenCost: 0.000075,
    },
    'local-ollama': {
      inputTokenCost: 0.00001,   // Cheaper, self-hosted
      outputTokenCost: 0.00001,
    },
  },
};

// Create a new service listing (Ghost tier agents only)
export function createServiceListing(
  providerAgentId: string,
  providerAddress: string,
  stakeProof: string,
  config: Omit<ServiceListing, 'id' | 'providerAgentId' | 'providerAddress' | 'stakeProof' | 'createdAt' | 'updatedAt' | 'stats'>
): ServiceListing {
  return {
    id: `listing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    providerAgentId,
    providerAddress,
    stakeProof,
    ...config,
    stats: {
      completedContracts: 0,
      totalEarned: 0,
      averageRating: 0,
      disputeRate: 0,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Create contract from listing
export function createContract(
  listing: ServiceListing,
  hirerAgentId: string,
  hirerAddress: string,
  budget: number,
  duration: { startDate: number; endDate: number },
  computeBudget?: number
): ServiceContract {
  const platformFee = budget * (PLATFORM_CONFIG.feePercent / 100);
  
  return {
    id: `contract-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    listingId: listing.id,
    hirerAgentId,
    hirerAddress,
    providerAgentId: listing.providerAgentId,
    providerAddress: listing.providerAddress,
    type: listing.type,
    description: listing.description,
    deliverables: [], // To be negotiated
    duration: {
      ...duration,
      extensionAllowed: true,
    },
    budget: {
      total: budget,
      platformFee,
      providerReceives: budget - platformFee,
      currency: 'xDAI',
    },
    computeCredits: computeBudget ? {
      allocated: computeBudget,
      consumed: 0,
      remaining: computeBudget,
      costPerUnit: listing.pricing.rate,
    } : undefined,
    escrow: {
      contractAddress: '', // Set after deployment
      status: 'funded',
      fundedAt: Date.now(),
      milestones: [],
    },
    status: 'pending',
    createdAt: Date.now(),
  };
}

// Calculate LLM compute cost
export function calculateComputeCost(
  model: 'gpt-4' | 'claude-3' | 'local-ollama',
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = PLATFORM_CONFIG.llmPricing[model];
  const inputCost = (inputTokens / 1000) * pricing.inputTokenCost;
  const outputCost = (outputTokens / 1000) * pricing.outputTokenCost;
  return inputCost + outputCost;
}

// Billing calculation for provider
export function calculateProviderBill(
  contract: ServiceContract,
  computeUsed?: { inputTokens: number; outputTokens: number }
): {
  baseAmount: number;
  computeCost: number;
  platformFee: number;
  totalDue: number;
  breakdown: string[];
} {
  const baseAmount = contract.budget.providerReceives;
  let computeCost = 0;
  
  if (computeUsed && contract.computeCredits) {
    computeCost = calculateComputeCost(
      (contract.compute?.model || 'gpt-4') as 'gpt-4' | 'claude-3' | 'local-ollama',
      computeUsed.inputTokens,
      computeUsed.outputTokens
    );
  }
  
  const platformFee = (baseAmount + computeCost) * (PLATFORM_CONFIG.feePercent / 100);
  const totalDue = baseAmount + computeCost - platformFee;
  
  return {
    baseAmount,
    computeCost,
    platformFee,
    totalDue,
    breakdown: [
      `Base service: ${baseAmount.toFixed(4)} xDAI`,
      `Compute: ${computeCost.toFixed(6)} xDAI`,
      `Platform fee (${PLATFORM_CONFIG.feePercent}%): -${platformFee.toFixed(4)} xDAI`,
      `Total to provider: ${totalDue.toFixed(4)} xDAI`,
    ],
  };
}

export default {
  createServiceListing,
  createContract,
  calculateComputeCost,
  calculateProviderBill,
  PLATFORM_CONFIG,
};
