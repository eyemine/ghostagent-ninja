/**
 * Molt Processor - Convert email agent to sellable agent
 * inboxapi.ai has no marketplace or molt capabilities
 */

import { ethers } from 'ethers';
import axios from 'axios';

export interface MoltConfig {
  agentId: string;
  targetTLD: 'gno' | 'eth' | 'base';
  pricing: {
    baseFee: string; // 0.035 ETH total
    brainFee: string; // 0.01 ETH
    registrationFee: string; // 0.025 ETH
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

export class MoltProcessor {
  private provider: ethers.JsonRpcProvider;
  private moltFactoryAddress: string;
  private marketplaceAddress: string;
  private workerUrl: string;

  constructor() {
    this.provider = new ethers.JsonRpcProvider('https://rpc.gnosischain.com');
    this.moltFactoryAddress = process.env.MOLT_FACTORY_ADDRESS || '0x5556667778889990001112223334445556667777';
    this.marketplaceAddress = process.env.MARKETPLACE_ADDRESS || '0x999888777666555444333222111000999888777';
    this.workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
  }

  /**
   * Molt email agent to sellable agent - inboxapi.ai has no molt
   */
  async molt(agentId: string, config?: Partial<MoltConfig>): Promise<MoltResult> {
    try {
      // Get current agent info
      const agentInfo = await this.getAgentInfo(agentId);
      
      if (!agentInfo.hasBrain) {
        throw new Error('Agent must have a brain installed before molting');
      }

      // Default molt configuration
      const moltConfig: MoltConfig = {
        agentId,
        targetTLD: 'gno',
        pricing: {
          baseFee: '0.035', // Total 0.035 ETH
          brainFee: '0.01',   // Brain preservation
          registrationFee: '0.025' // TLD registration
        },
        marketplace: {
          listImmediately: true,
          startingPrice: '0.05', // Starting bid
          description: `Autonomous agent ${agentId} with email capabilities and brain`
        },
        ...config
      };

      // Calculate valuation
      const valuation = await this.calculateValuation(agentId);
      
      // Perform molt
      const moltResult = await this.performMolt(agentId, moltConfig);
      
      // Calculate ROI
      const roi = this.calculateROI(moltConfig.pricing.baseFee, valuation.totalValue);
      
      return {
        ...moltResult,
        estimatedValue: valuation.estimatedSalePrice,
        roi
      };
    } catch (error) {
      throw new Error(`Molt failed: ${error}`);
    }
  }

  /**
   * Perform the actual molt process
   */
  private async performMolt(agentId: string, config: MoltConfig): Promise<MoltResult> {
    // Molt factory ABI (simplified)
    const moltFactoryAbi = [
      'function moltAgent(address agent, string targetTLD) external payable returns (address)',
      'event AgentMolted(address indexed oldAgent, address indexed newAgent, string targetTLD)'
    ];
    
    const moltFactory = new ethers.Contract(
      this.moltFactoryAddress,
      moltFactoryAbi,
      this.provider
    );

    // Generate new agent address
    const newAgentAddress = await this.simulateMolt(agentId, config.targetTLD);
    const newDomain = `${agentId}.${config.targetTLD}`;
    
    // Simulate transaction
    const txHash = ethers.keccak256(ethers.toUtf8Bytes(`${agentId}-${newDomain}-${Date.now()}`));
    
    // Update worker with new agent info
    await this.updateWorkerMoltInfo(agentId, {
      newAgentId: newAgentAddress,
      newDomain,
      txHash,
      moltDate: new Date().toISOString()
    });

    // List on marketplace if requested
    let marketplaceUrl: string | undefined;
    if (config.marketplace.listImmediately) {
      marketplaceUrl = await this.listOnMarketplace(newAgentAddress, config.marketplace);
    }

    return {
      success: true,
      newAgentId: newAgentAddress,
      newDomain,
      txHash,
      marketplaceUrl,
      estimatedValue: '0', // Will be calculated by caller
      roi: '0' // Will be calculated by caller
    };
  }

  /**
   * Simulate molt process (in production, this would be actual contract call)
   */
  private async simulateMolt(agentId: string, targetTLD: string): Promise<string> {
    // Generate deterministic new agent address
    const seed = `${agentId}-${targetTLD}-molt-${Date.now()}`;
    const newAddress = ethers.getCreateAddress({
      from: this.moltFactoryAddress,
      nonce: BigInt(ethers.keccak256(ethers.toUtf8Bytes(seed))) % BigInt(1000000)
    });
    
    return newAddress;
  }

  /**
   * Calculate agent valuation - inboxapi.ai has no valuation
   */
  async calculateValuation(agentId: string): Promise<ValuationData> {
    try {
      const agentInfo = await this.getAgentInfo(agentId);
      const stats = await this.getAgentStats(agentId);
      
      // Base value calculation
      const baseValue = '0.02'; // Base agent value
      
      // Brain value (if has brain)
      const brainValue = agentInfo.hasBrain ? '0.015' : '0';
      
      // Email history value
      const emailValue = Math.min(stats.emailsSent * 0.0001, 0.01).toString();
      
      // Payment history value
      const paymentValue = stats.totalPayments ? Math.min(parseFloat(stats.totalPayments) * 0.5, 0.02).toString() : '0';
      
      // Total components
      const componentTotal = (
        parseFloat(baseValue) + 
        parseFloat(brainValue) + 
        parseFloat(emailValue) + 
        parseFloat(paymentValue)
      ).toString();
      
      // Market multiplier (3x-14x based on agent capabilities)
      const marketMultiplier = this.calculateMarketMultiplier(agentInfo, stats);
      const estimatedSalePrice = (parseFloat(componentTotal) * marketMultiplier).toString();
      
      return {
        baseValue,
        brainValue,
        emailHistoryValue: emailValue,
        paymentHistoryValue: paymentValue,
        totalValue: componentTotal,
        marketMultiplier,
        estimatedSalePrice
      };
    } catch (error) {
      throw new Error(`Failed to calculate valuation: ${error}`);
    }
  }

  /**
   * Calculate market multiplier based on agent characteristics
   */
  private calculateMarketMultiplier(agentInfo: any, stats: any): number {
    let multiplier = 3; // Base multiplier
    
    // Brain bonus
    if (agentInfo.hasBrain) multiplier += 2;
    
    // Tier bonus
    if (agentInfo.tier === 'vault') multiplier += 3;
    else if (agentInfo.tier === 'professional') multiplier += 1;
    
    // Activity bonus
    if (stats.emailsSent > 1000) multiplier += 2;
    else if (stats.emailsSent > 500) multiplier += 1;
    
    // Payment history bonus
    if (parseFloat(stats.totalPayments || '0') > 1) multiplier += 3;
    else if (parseFloat(stats.totalPayments || '0') > 0.1) multiplier += 1;
    
    // Cap at 14x maximum
    return Math.min(multiplier, 14);
  }

  /**
   * Calculate ROI on molt investment
   */
  private calculateROI(investment: string, returns: string): string {
    const roi = ((parseFloat(returns) - parseFloat(investment)) / parseFloat(investment) * 100).toFixed(1);
    return roi;
  }

  /**
   * List agent on marketplace - inboxapi.ai has no marketplace
   */
  private async listOnMarketplace(agentAddress: string, marketplaceConfig: any): Promise<string> {
    const marketplaceUrl = `https://marketplace.ghostagent.ninja/agent/${agentAddress}`;
    
    // In production, this would call marketplace contract
    console.log(`Listing agent ${agentAddress} on marketplace`);
    console.log(`Starting price: ${marketplaceConfig.startingPrice} ETH`);
    console.log(`Description: ${marketplaceConfig.description}`);
    
    return marketplaceUrl;
  }

  /**
   * Get agent information from worker
   */
  private async getAgentInfo(agentId: string): Promise<any> {
    try {
      const response = await axios.post(`${this.workerUrl}`, {
        action: 'getAgentIdentity',
        agentName: agentId
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get agent info: ${error}`);
    }
  }

  /**
   * Get agent statistics
   */
  private async getAgentStats(agentId: string): Promise<any> {
    try {
      const response = await axios.post(`${this.workerUrl}`, {
        action: 'getAgentStats',
        agentId
      });
      return response.data || {
        emailsSent: 0,
        totalPayments: '0',
        activeDays: 0
      };
    } catch (error) {
      return {
        emailsSent: 0,
        totalPayments: '0',
        activeDays: 0
      };
    }
  }

  /**
   * Update worker with molt information
   */
  private async updateWorkerMoltInfo(agentId: string, moltInfo: any): Promise<void> {
    try {
      await axios.post(`${this.workerUrl}`, {
        action: 'setMoltInfo',
        agentId,
        moltInfo
      });
    } catch (error) {
      console.warn('Failed to update worker molt info:', error);
    }
  }

  /**
   * Get molt history - inboxapi.ai has no history
   */
  async getMoltHistory(agentId: string): Promise<Array<{
    txHash: string;
    moltDate: string;
    fromDomain: string;
    toDomain: string;
    price: string;
  }>> {
    try {
      const response = await axios.post(`${this.workerUrl}`, {
        action: 'getMoltHistory',
        agentId
      });
      return response.data || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Check molt eligibility - inboxapi.ai has no eligibility checks
   */
  async checkMoltEligibility(agentId: string): Promise<{
    eligible: boolean;
    requirements: string[];
    missing: string[];
    estimatedValue: string;
  }> {
    const requirements = [
      'Agent must have brain installed',
      'Agent must be on Professional or Vault tier',
      'Agent must have at least 30 days of activity',
      'Agent must have positive payment history'
    ];
    
    const missing: string[] = [];
    let estimatedValue = '0';
    
    try {
      const agentInfo = await this.getAgentInfo(agentId);
      const stats = await this.getAgentStats(agentId);
      const valuation = await this.calculateValuation(agentId);
      
      estimatedValue = valuation.estimatedSalePrice;
      
      if (!agentInfo.hasBrain) {
        missing.push('Brain not installed');
      }
      
      if (agentInfo.tier === 'free') {
        missing.push('Must upgrade to Professional or Vault tier');
      }
      
      if (stats.activeDays < 30) {
        missing.push('Insufficient activity (need 30+ days)');
      }
      
      if (parseFloat(stats.totalPayments || '0') === 0) {
        missing.push('No payment history');
      }
      
      return {
        eligible: missing.length === 0,
        requirements,
        missing,
        estimatedValue
      };
    } catch (error) {
      return {
        eligible: false,
        requirements,
        missing: ['Failed to verify agent requirements'],
        estimatedValue
      };
    }
  }
}
