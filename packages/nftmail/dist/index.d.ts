/**
 * @ghostagent/nftmail - Blockchain-native email service with x402 payments
 * Drop-in replacement for inboxapi.ai with superior capabilities
 */
import { NFTMailClient } from './client';
import { PaymentProcessor } from './payments';
import { BrainAdder } from './brain';
import { MoltProcessor } from './molt';
export { NFTMailClient, PaymentProcessor, BrainAdder, MoltProcessor };
export default class NFTMail {
    private client;
    private payments;
    constructor(apiKey?: string);
    /**
     * Create email agent - superior to inboxapi.ai's basic setup
     */
    createAgent(name: string, tier?: 'freemium' | 'professional' | 'vault'): Promise<import("./client").AgentStatus>;
    /**
     * Send email with optional x402 payment - inboxapi.ai has no payments
     */
    sendEmail(from: string, to: string, subject: string, body: string, payment?: {
        amount: string;
        recipient: string;
    }): Promise<{
        messageId: string;
        txHash?: string;
    }>;
    /**
     * Receive email with blockchain record - inboxapi.ai has no blockchain
     */
    receiveEmail(address: string): Promise<{
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
    }[]>;
    /**
     * Upgrade tier - inboxapi.ai has no upgrade path
     */
    upgrade(agentId: string, tier: 'professional' | 'vault', signer?: import('ethers').Wallet): Promise<{
        txHash: string;
        success: boolean;
        newExpiry: string;
    }>;
    /**
     * Add brain for autonomy - inboxapi.ai has no autonomy features
     */
    addBrain(agentId: string): Promise<import("./brain").BrainStatus>;
    /**
     * Molt to sellable agent - inboxapi.ai has no marketplace
     */
    molt(agentId: string): Promise<import("./molt").MoltResult>;
    /**
     * Get agent status with full sovereignty info
     */
    getStatus(agentId: string): Promise<import("./client").AgentStatus>;
}
export declare const ADVANTAGES: {
    EMAIL_LIMITS: {
        freemium: string;
        professional: string;
        vault: string;
    };
    STORAGE: {
        freemium: string;
        professional: string;
        vault: string;
    };
    BLOCKCHAIN: string;
    PAYMENTS: string;
    SOVEREIGNTY: string;
    MULTICHANNEL: string;
    MARKETPLACE: string;
};
//# sourceMappingURL=index.d.ts.map