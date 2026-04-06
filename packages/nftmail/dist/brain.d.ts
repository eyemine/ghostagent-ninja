/**
 * Brain Adder - Add brain to email agent for autonomy
 * inboxapi.ai has no autonomy features
 */
export interface BrainConfig {
    model: 'gpt-4' | 'claude-3' | 'llama-3';
    capabilities: string[];
    funding: {
        amount: string;
        wallet: string;
    };
}
export interface BrainStatus {
    installed: boolean;
    model: string;
    capabilities: string[];
    safeAddress: string;
    tbaAddress: string;
    brainId: string;
    activationDate: string;
    lastActivity: string;
}
export declare class BrainAdder {
    private provider;
    private brainFactoryAddress;
    private workerUrl;
    constructor();
    /**
     * Add brain to existing email agent - inboxapi.ai has no brain features
     */
    addToAgent(agentId: string, config?: Partial<BrainConfig>): Promise<BrainStatus>;
    /**
     * Install brain using smart contract
     */
    private installBrain;
    /**
     * Simulate brain creation (in production, this would be actual contract call)
     */
    private simulateBrainCreation;
    /**
     * Get agent information from worker
     */
    private getAgentInfo;
    /**
     * Get TBA address for agent
     */
    private getTBAAddress;
    /**
     * Update worker with brain information
     */
    private updateWorkerBrainInfo;
    /**
     * Get brain status - inboxapi.ai has no status tracking
     */
    getBrainStatus(agentId: string): Promise<BrainStatus>;
    /**
     * List available brain models - inboxapi.ai has no AI models
     */
    listAvailableModels(): Array<{
        name: string;
        description: string;
        capabilities: string[];
        cost: string;
    }>;
    /**
     * Validate brain requirements - inboxapi.ai has no requirements
     */
    validateRequirements(agentId: string): Promise<{
        valid: boolean;
        issues: string[];
        recommendations: string[];
    }>;
}
//# sourceMappingURL=brain.d.ts.map