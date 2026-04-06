/**
 * Molt Processor - Convert email agent to sellable agent
 * inboxapi.ai has no marketplace or molt capabilities
 */
export interface MoltConfig {
    agentId: string;
    targetTLD: 'gno' | 'eth' | 'base';
    pricing: {
        baseFee: string;
        brainFee: string;
        registrationFee: string;
    };
    marketplace: {
        listImmediately: boolean;
        startingPrice: string;
        description: string;
    };
}
export interface MoltResult {
    success: boolean;
    newAgentId: string;
    newDomain: string;
    txHash: string;
    marketplaceUrl?: string;
    estimatedValue: string;
    roi: string;
}
export interface ValuationData {
    baseValue: string;
    brainValue: string;
    emailHistoryValue: string;
    paymentHistoryValue: string;
    totalValue: string;
    marketMultiplier: number;
    estimatedSalePrice: string;
}
export declare class MoltProcessor {
    private provider;
    private moltFactoryAddress;
    private marketplaceAddress;
    private workerUrl;
    constructor();
    /**
     * Molt email agent to sellable agent - inboxapi.ai has no molt
     */
    molt(agentId: string, config?: Partial<MoltConfig>): Promise<MoltResult>;
    /**
     * Perform the actual molt process
     */
    private performMolt;
    /**
     * Simulate molt process (in production, this would be actual contract call)
     */
    private simulateMolt;
    /**
     * Calculate agent valuation - inboxapi.ai has no valuation
     */
    calculateValuation(agentId: string): Promise<ValuationData>;
    /**
     * Calculate market multiplier based on agent characteristics
     */
    private calculateMarketMultiplier;
    /**
     * Calculate ROI on molt investment
     */
    private calculateROI;
    /**
     * List agent on marketplace - inboxapi.ai has no marketplace
     */
    private listOnMarketplace;
    /**
     * Get agent information from worker
     */
    private getAgentInfo;
    /**
     * Get agent statistics
     */
    private getAgentStats;
    /**
     * Update worker with molt information
     */
    private updateWorkerMoltInfo;
    /**
     * Get molt history - inboxapi.ai has no history
     */
    getMoltHistory(agentId: string): Promise<Array<{
        txHash: string;
        moltDate: string;
        fromDomain: string;
        toDomain: string;
        price: string;
    }>>;
    /**
     * Check molt eligibility - inboxapi.ai has no eligibility checks
     */
    checkMoltEligibility(agentId: string): Promise<{
        eligible: boolean;
        requirements: string[];
        missing: string[];
        estimatedValue: string;
    }>;
}
//# sourceMappingURL=molt.d.ts.map