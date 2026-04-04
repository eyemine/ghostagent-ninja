/**
 * @ghostagent/nftmail - Blockchain-native email service with x402 payments
 * Drop-in replacement for inboxapi.ai with superior capabilities
 */

import { NFTMailClient } from './client';
import { PaymentProcessor } from './payments';
import { BrainAdder } from './brain';
import { MoltProcessor } from './molt';

export { NFTMailClient, PaymentProcessor, BrainAdder, MoltProcessor };

// Convenience exports for drop-in replacement
export default class NFTMail {
  private client: NFTMailClient;
  private payments: PaymentProcessor;

  constructor(apiKey?: string) {
    this.client = new NFTMailClient(apiKey);
    this.payments = new PaymentProcessor();
  }

  /**
   * Create email agent - superior to inboxapi.ai's basic setup
   */
  async createAgent(name: string, tier: 'freemium' | 'professional' | 'vault' = 'freemium') {
    return this.client.createAgent(name, tier);
  }

  /**
   * Send email with optional x402 payment - inboxapi.ai has no payments
   */
  async sendEmail(from: string, to: string, subject: string, body: string, payment?: { amount: string; recipient: string }) {
    return this.client.sendEmail({ from, to, subject, body, payment });
  }

  /**
   * Receive email with blockchain record - inboxapi.ai has no blockchain
   */
  async receiveEmail(address: string) {
    return this.client.receiveEmail(address);
  }

  /**
   * Upgrade tier - inboxapi.ai has no upgrade path
   */
  async upgrade(agentId: string, tier: 'professional' | 'vault') {
    return this.payments.upgrade(agentId, tier);
  }

  /**
   * Add brain for autonomy - inboxapi.ai has no autonomy features
   */
  async addBrain(agentId: string) {
    const brainAdder = new BrainAdder();
    return brainAdder.addToAgent(agentId);
  }

  /**
   * Molt to sellable agent - inboxapi.ai has no marketplace
   */
  async molt(agentId: string) {
    const moltProcessor = new MoltProcessor();
    return moltProcessor.molt(agentId);
  }

  /**
   * Get agent status with full sovereignty info
   */
  async getStatus(agentId: string) {
    return this.client.getAgentStatus(agentId);
  }
}

// Competitive advantages over inboxapi.ai
export const ADVANTAGES = {
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

// Installation command: npm install @ghostagent/nftmail
// Setup command: npx nftmail-setup
// Upgrade command: npx nftmail-upgrade
