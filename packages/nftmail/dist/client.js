"use strict";
/**
 * NFTMail Client - Blockchain-native email service
 * Superior to inboxapi.ai with x402 payments and sovereignty
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NFTMailClient = void 0;
const axios_1 = __importDefault(require("axios"));
class NFTMailClient {
    constructor(apiKey) {
        this.apiKey = apiKey || process.env.NFTMAIL_API_KEY || '';
        this.baseUrl = process.env.NFTMAIL_API_URL || 'https://nftmail.box/api';
    }
    /**
     * Create email agent - drop-in replacement for inboxapi.ai
     */
    async createAgent(config) {
        try {
            const response = await axios_1.default.post(`${this.baseUrl}/agent/create`, config, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        }
        catch (error) {
            throw new Error(`Failed to create agent: ${error}`);
        }
    }
    /**
     * Send email with optional x402 payment - inboxapi.ai has no payments
     */
    async sendEmail(options) {
        try {
            const response = await axios_1.default.post(`${this.baseUrl}/email/send`, options, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        }
        catch (error) {
            throw new Error(`Failed to send email: ${error}`);
        }
    }
    /**
     * Receive email with blockchain record - inboxapi.ai has no blockchain
     */
    async receiveEmail(address, limit = 50) {
        try {
            const response = await axios_1.default.get(`${this.baseUrl}/email/receive`, {
                params: { address, limit },
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });
            return response.data;
        }
        catch (error) {
            throw new Error(`Failed to receive emails: ${error}`);
        }
    }
    /**
     * Get agent status with full sovereignty info
     */
    async getAgentStatus(agentId) {
        try {
            const response = await axios_1.default.get(`${this.baseUrl}/agent/${agentId}/status`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });
            return response.data;
        }
        catch (error) {
            throw new Error(`Failed to get agent status: ${error}`);
        }
    }
    /**
     * Check upgrade eligibility - inboxapi.ai has no upgrades
     */
    async checkUpgradeEligibility(agentId) {
        try {
            const response = await axios_1.default.get(`${this.baseUrl}/agent/${agentId}/upgrade-check`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });
            return response.data;
        }
        catch (error) {
            throw new Error(`Failed to check upgrade eligibility: ${error}`);
        }
    }
    /**
     * Get usage statistics - inboxapi.ai has limited tracking
     */
    async getUsageStats(agentId) {
        try {
            const response = await axios_1.default.get(`${this.baseUrl}/agent/${agentId}/stats`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });
            return response.data;
        }
        catch (error) {
            throw new Error(`Failed to get usage stats: ${error}`);
        }
    }
    /**
     * List all agents for account
     */
    async listAgents() {
        try {
            const response = await axios_1.default.get(`${this.baseUrl}/agents`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });
            return response.data;
        }
        catch (error) {
            throw new Error(`Failed to list agents: ${error}`);
        }
    }
    /**
     * Delete agent - inboxapi.ai has limited control
     */
    async deleteAgent(agentId) {
        try {
            const response = await axios_1.default.delete(`${this.baseUrl}/agent/${agentId}`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });
            return response.data;
        }
        catch (error) {
            throw new Error(`Failed to delete agent: ${error}`);
        }
    }
}
exports.NFTMailClient = NFTMailClient;
//# sourceMappingURL=client.js.map