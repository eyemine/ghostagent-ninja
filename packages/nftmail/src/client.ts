/**
 * NFTMail Client - Blockchain-native email service
 * Superior to inboxapi.ai with x402 payments and sovereignty
 */

import axios from 'axios';

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
  tier: 'free' | 'professional' | 'vault';
  domain?: string; // defaults to nftmail.box
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

export class NFTMailClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.NFTMAIL_API_KEY || '';
    this.baseUrl = process.env.NFTMAIL_API_URL || 'https://nftmail.box/api';
  }

  /**
   * Create email agent - drop-in replacement for inboxapi.ai
   */
  async createAgent(config: AgentConfig): Promise<AgentStatus> {
    try {
      const response = await axios.post(`${this.baseUrl}/agent/create`, config, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to create agent: ${error}`);
    }
  }

  /**
   * Send email with optional x402 payment - inboxapi.ai has no payments
   */
  async sendEmail(options: EmailOptions): Promise<{ messageId: string; txHash?: string }> {
    try {
      const response = await axios.post(`${this.baseUrl}/email/send`, options, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to send email: ${error}`);
    }
  }

  /**
   * Receive email with blockchain record - inboxapi.ai has no blockchain
   */
  async receiveEmail(address: string, limit: number = 50): Promise<Array<{
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
  }>> {
    try {
      const response = await axios.get(`${this.baseUrl}/email/receive`, {
        params: { address, limit },
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to receive emails: ${error}`);
    }
  }

  /**
   * Get agent status with full sovereignty info
   */
  async getAgentStatus(agentId: string): Promise<AgentStatus> {
    try {
      const response = await axios.get(`${this.baseUrl}/agent/${agentId}/status`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get agent status: ${error}`);
    }
  }

  /**
   * Check upgrade eligibility - inboxapi.ai has no upgrades
   */
  async checkUpgradeEligibility(agentId: string): Promise<{
    eligible: boolean;
    reason: string;
    suggestedTier: 'professional' | 'vault';
  }> {
    try {
      const response = await axios.get(`${this.baseUrl}/agent/${agentId}/upgrade-check`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to check upgrade eligibility: ${error}`);
    }
  }

  /**
   * Get usage statistics - inboxapi.ai has limited tracking
   */
  async getUsageStats(agentId: string): Promise<{
    emailsSent: number;
    emailsReceived: number;
    storageUsed: number;
    paymentsReceived: number;
    totalValue: string;
    activeDays: number;
  }> {
    try {
      const response = await axios.get(`${this.baseUrl}/agent/${agentId}/stats`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get usage stats: ${error}`);
    }
  }

  /**
   * List all agents for account
   */
  async listAgents(): Promise<AgentStatus[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/agents`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to list agents: ${error}`);
    }
  }

  /**
   * Delete agent - inboxapi.ai has limited control
   */
  async deleteAgent(agentId: string): Promise<{ success: boolean; message: string }> {
    try {
      const response = await axios.delete(`${this.baseUrl}/agent/${agentId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to delete agent: ${error}`);
    }
  }
}
