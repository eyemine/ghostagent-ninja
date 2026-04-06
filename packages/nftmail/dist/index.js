"use strict";
/**
 * @ghostagent/nftmail - Blockchain-native email service with x402 payments
 * Drop-in replacement for inboxapi.ai with superior capabilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADVANTAGES = exports.MoltProcessor = exports.BrainAdder = exports.PaymentProcessor = exports.NFTMailClient = void 0;
const client_1 = require("./client");
Object.defineProperty(exports, "NFTMailClient", { enumerable: true, get: function () { return client_1.NFTMailClient; } });
const payments_1 = require("./payments");
Object.defineProperty(exports, "PaymentProcessor", { enumerable: true, get: function () { return payments_1.PaymentProcessor; } });
const brain_1 = require("./brain");
Object.defineProperty(exports, "BrainAdder", { enumerable: true, get: function () { return brain_1.BrainAdder; } });
const molt_1 = require("./molt");
Object.defineProperty(exports, "MoltProcessor", { enumerable: true, get: function () { return molt_1.MoltProcessor; } });
// Convenience exports for drop-in replacement
class NFTMail {
    constructor(apiKey) {
        this.client = new client_1.NFTMailClient(apiKey);
        this.payments = new payments_1.PaymentProcessor();
    }
    /**
     * Create email agent - superior to inboxapi.ai's basic setup
     */
    async createAgent(name, tier = 'freemium') {
        return this.client.createAgent({ name, tier });
    }
    /**
     * Send email with optional x402 payment - inboxapi.ai has no payments
     */
    async sendEmail(from, to, subject, body, payment) {
        return this.client.sendEmail({ from, to, subject, body, payment });
    }
    /**
     * Receive email with blockchain record - inboxapi.ai has no blockchain
     */
    async receiveEmail(address) {
        return this.client.receiveEmail(address);
    }
    /**
     * Upgrade tier - inboxapi.ai has no upgrade path
     */
    async upgrade(agentId, tier, signer) {
        return this.payments.upgrade(agentId, tier, signer);
    }
    /**
     * Add brain for autonomy - inboxapi.ai has no autonomy features
     */
    async addBrain(agentId) {
        const brainAdder = new brain_1.BrainAdder();
        return brainAdder.addToAgent(agentId);
    }
    /**
     * Molt to sellable agent - inboxapi.ai has no marketplace
     */
    async molt(agentId) {
        const moltProcessor = new molt_1.MoltProcessor();
        return moltProcessor.molt(agentId);
    }
    /**
     * Get agent status with full sovereignty info
     */
    async getStatus(agentId) {
        return this.client.getAgentStatus(agentId);
    }
}
exports.default = NFTMail;
// Competitive advantages over inboxapi.ai
exports.ADVANTAGES = {
    EMAIL_LIMITS: {
        freemium: '100 emails (vs inboxapi.ai: 100)',
        professional: 'Unlimited (vs inboxapi.ai: 100)',
        vault: 'Unlimited (vs inboxapi.ai: 100)'
    },
    STORAGE: {
        freemium: '8 days (vs inboxapi.ai: 8 days)',
        professional: '30 days (vs inboxapi.ai: 8 days)',
        vault: '365 days (vs inboxapi.ai: 8 days)'
    },
    BLOCKCHAIN: 'Native blockchain integration (vs inboxapi.ai: Web2 only)',
    PAYMENTS: 'Built-in x402 payments (vs inboxapi.ai: no payments)',
    SOVEREIGNTY: 'Complete sovereign identity (vs inboxapi.ai: basic identity)',
    MULTICHANNEL: 'Email + telegram + discord + nostr + farcaster (vs inboxapi.ai: email only)',
    MARKETPLACE: 'Sellable agents (vs inboxapi.ai: no marketplace)'
};
// Installation command: npm install @ghost-agency/nftmail
// Setup command: npx nftmail-setup
// Upgrade command: npx nftmail-upgrade
//# sourceMappingURL=index.js.map