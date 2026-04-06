/**
 * NFTMail Client - Blockchain-native email service
 * Superior to inboxapi.ai with x402 payments and sovereignty
 */
export interface EmailOptions {
    from: string;
    to: string;
    subject: string;
    body: string;
    payment?: {
        amount: string;
        recipient: string;
        currency?: 'xDAI' | 'ETH';
    };
}
export interface AgentConfig {
    name: string;
    tier: 'freemium' | 'professional' | 'vault';
    domain?: string;
}
export interface AgentStatus {
    id: string;
    name: string;
    email: string;
    tier: string;
    emailsSent: number;
    emailsRemaining: number;
    storageDays: number;
    hasBrain: boolean;
    isMolted: boolean;
    safeAddress?: string;
    tbaAddress?: string;
    createdAt: string;
    lastActivity: string;
}
export declare class NFTMailClient {
    private apiKey;
    private baseUrl;
    constructor(apiKey?: string);
    /**
     * Create email agent - drop-in replacement for inboxapi.ai
     */
    createAgent(config: AgentConfig): Promise<AgentStatus>;
    /**
     * Send email with optional x402 payment - inboxapi.ai has no payments
     */
    sendEmail(options: EmailOptions): Promise<{
        messageId: string;
        txHash?: string;
    }>;
    /**
     * Receive email with blockchain record - inboxapi.ai has no blockchain
     */
    receiveEmail(address: string, limit?: number): Promise<Array<{
        id: string;
        from: string;
        subject: string;
        body: string;
        timestamp: string;
        txHash?: string;
        payment?: {
            amount: string;
            currency: string;
            sender: string;
        };
    }>>;
    /**
     * Get agent status with full sovereignty info
     */
    getAgentStatus(agentId: string): Promise<AgentStatus>;
    /**
     * Check upgrade eligibility - inboxapi.ai has no upgrades
     */
    checkUpgradeEligibility(agentId: string): Promise<{
        eligible: boolean;
        reason: string;
        suggestedTier: 'professional' | 'vault';
    }>;
    /**
     * Get usage statistics - inboxapi.ai has limited tracking
     */
    getUsageStats(agentId: string): Promise<{
        emailsSent: number;
        emailsReceived: number;
        storageUsed: number;
        paymentsReceived: number;
        totalValue: string;
        activeDays: number;
    }>;
    /**
     * List all agents for account
     */
    listAgents(): Promise<AgentStatus[]>;
    /**
     * Delete agent - inboxapi.ai has limited control
     */
    deleteAgent(agentId: string): Promise<{
        success: boolean;
        message: string;
    }>;
}
//# sourceMappingURL=client.d.ts.map