/**
 * Payment Processor - xDAI payment integration for NFTMail
 * inboxapi.ai has no payment capabilities
 */
import { ethers } from 'ethers';
export interface TierConfig {
    name: 'professional' | 'vault';
    price: string;
    duration: 'monthly' | 'yearly';
    features: {
        emails: 'unlimited';
        storage: number;
        priority: boolean;
        support: 'basic' | 'priority';
    };
}
export declare const TIERS: Record<'professional' | 'vault', TierConfig>;
export declare class PaymentProcessor {
    private provider;
    private contractAddress;
    private paymentContract;
    constructor();
    /**
     * Process upgrade payment - inboxapi.ai has no upgrade payments
     */
    upgrade(agentId: string, tier: 'professional' | 'vault', signer: ethers.Wallet): Promise<{
        txHash: string;
        success: boolean;
        newExpiry: string;
    }>;
    /**
     * Check payment status - inboxapi.ai has no payment tracking
     */
    getPaymentStatus(agentId: string): Promise<{
        active: boolean;
        expiry: string;
        tier: string;
        daysRemaining: number;
    }>;
    /**
     * Get payment history - inboxapi.ai has no payment history
     */
    getPaymentHistory(agentId: string): Promise<Array<{
        txHash: string;
        amount: string;
        tier: string;
        timestamp: string;
    }>>;
    /**
     * Calculate upgrade cost with discounts - inboxapi.ai has no pricing
     */
    calculateUpgradeCost(currentTier: string, targetTier: 'professional' | 'vault', monthsRemaining?: number): Promise<{
        basePrice: string;
        discount: string;
        finalPrice: string;
        savings: string;
    }>;
    /**
     * Validate wallet has sufficient funds - inboxapi.ai has no wallet checks
     */
    validateFunds(walletAddress: string, requiredAmount: string): Promise<{
        sufficient: boolean;
        balance: string;
        required: string;
        shortfall?: string;
    }>;
    /**
     * Get xDAI price in USD for user reference - inboxapi.ai has no crypto
     */
    getxDAIPrice(): Promise<{
        price: number;
        timestamp: string;
    }>;
}
//# sourceMappingURL=payments.d.ts.map