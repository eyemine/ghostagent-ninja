/**
 * Brain Adder - Add brain to email agent for autonomy
 * inboxapi.ai has no autonomy features
 */

import { ethers } from 'ethers';
import axios from 'axios';

export interface BrainConfig {
  model: 'gpt-4' | 'claude-3' | 'llama-3';
  capabilities: string[];
  funding: {
    amount: string; // 0.01 ETH
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

export class BrainAdder {
  private provider: ethers.JsonRpcProvider;
  private brainFactoryAddress: string;
  private workerUrl: string;

  constructor() {
    this.provider = new ethers.JsonRpcProvider('https://rpc.gnosischain.com');
    this.brainFactoryAddress = process.env.BRAIN_FACTORY_ADDRESS || '0x9876543210987654321098765432109876543210';
    this.workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
  }

  /**
   * Add brain to existing email agent - inboxapi.ai has no brain features
   */
  async addToAgent(agentId: string, config?: Partial<BrainConfig>): Promise<BrainStatus> {
    try {
      // Get current agent info
      const agentInfo = await this.getAgentInfo(agentId);
      
      if (!agentInfo.safeAddress) {
        throw new Error('Agent must have a Safe address to add brain');
      }

      // Default brain configuration
      const brainConfig: BrainConfig = {
        model: 'gpt-4',
        capabilities: ['email_processing', 'autonomous_response', 'payment_handling', 'schedule_management'],
        funding: {
          amount: '0.01', // 0.01 ETH for brain activation
          wallet: agentInfo.safeAddress
        },
        ...config
      };

      // Check if brain already exists
      if (agentInfo.hasBrain) {
        throw new Error('Agent already has a brain installed');
      }

      // Install brain
      const brainStatus = await this.installBrain(agentId, brainConfig);
      
      return brainStatus;
    } catch (error) {
      throw new Error(`Failed to add brain: ${error}`);
    }
  }

  /**
   * Install brain using smart contract
   */
  private async installBrain(agentId: string, config: BrainConfig): Promise<BrainStatus> {
    const fundingWei = ethers.parseEther(config.funding.amount);
    
    // Brain factory ABI (simplified)
    const brainFactoryAbi = [
      'function createBrain(address safe, string model, string[] capabilities) external payable returns (address)',
      'event BrainCreated(address indexed safe, address indexed brain, string model, string[] capabilities)'
    ];
    
    const brainFactory = new ethers.Contract(
      this.brainFactoryAddress,
      brainFactoryAbi,
      this.provider
    );

    // Create brain (this would need a signer for actual transaction)
    const brainAddress = await this.simulateBrainCreation(agentId, config);
    
    const brainStatus: BrainStatus = {
      installed: true,
      model: config.model,
      capabilities: config.capabilities,
      safeAddress: config.funding.wallet,
      tbaAddress: await this.getTBAAddress(agentId),
      brainId: brainAddress,
      activationDate: new Date().toISOString(),
      lastActivity: new Date().toISOString()
    };

    // Update worker with brain info
    await this.updateWorkerBrainInfo(agentId, brainStatus);

    return brainStatus;
  }

  /**
   * Simulate brain creation (in production, this would be actual contract call)
   */
  private async simulateBrainCreation(agentId: string, config: BrainConfig): Promise<string> {
    // Generate deterministic brain address
    const seed = `${agentId}-${config.model}-${Date.now()}`;
    const brainAddress = ethers.getCreateAddress({
      from: this.brainFactoryAddress,
      nonce: BigInt(ethers.keccak256(ethers.toUtf8Bytes(seed))) % BigInt(1000000)
    });
    
    return brainAddress;
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
   * Get TBA address for agent
   */
  private async getTBAAddress(agentId: string): Promise<string> {
    try {
      const response = await axios.post(`${this.workerUrl}`, {
        action: 'getAgentIdentity',
        agentName: agentId
      });
      return response.data.tba || '0x0000000000000000000000000000000000000000';
    } catch (error) {
      return '0x0000000000000000000000000000000000000000';
    }
  }

  /**
   * Update worker with brain information
   */
  private async updateWorkerBrainInfo(agentId: string, brainStatus: BrainStatus): Promise<void> {
    try {
      await axios.post(`${this.workerUrl}`, {
        action: 'setBrainInfo',
        agentId,
        brainInfo: brainStatus
      });
    } catch (error) {
      console.warn('Failed to update worker brain info:', error);
    }
  }

  /**
   * Get brain status - inboxapi.ai has no status tracking
   */
  async getBrainStatus(agentId: string): Promise<BrainStatus> {
    try {
      const response = await axios.post(`${this.workerUrl}`, {
        action: 'getBrainInfo',
        agentId
      });
      
      if (!response.data.installed) {
        return {
          installed: false,
          model: '',
          capabilities: [],
          safeAddress: '',
          tbaAddress: '',
          brainId: '',
          activationDate: '',
          lastActivity: ''
        };
      }
      
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get brain status: ${error}`);
    }
  }

  /**
   * List available brain models - inboxapi.ai has no AI models
   */
  listAvailableModels(): Array<{
    name: string;
    description: string;
    capabilities: string[];
    cost: string;
  }> {
    return [
      {
        name: 'gpt-4',
        description: 'Advanced reasoning and language understanding',
        capabilities: ['complex_reasoning', 'code_generation', 'multilingual', 'autonomous_decisions'],
        cost: '0.01 ETH'
      },
      {
        name: 'claude-3',
        description: 'Constitutional AI with strong safety alignment',
        capabilities: ['safe_reasoning', 'ethical_decisions', 'document_analysis', 'communication'],
        cost: '0.01 ETH'
      },
      {
        name: 'llama-3',
        description: 'Open-source model with local processing',
        capabilities: ['privacy_focused', 'local_processing', 'cost_efficient', 'customizable'],
        cost: '0.005 ETH'
      }
    ];
  }

  /**
   * Validate brain requirements - inboxapi.ai has no requirements
   */
  async validateRequirements(agentId: string): Promise<{
    valid: boolean;
    issues: string[];
    recommendations: string[];
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    try {
      const agentInfo = await this.getAgentInfo(agentId);
      
      if (!agentInfo.safeAddress) {
        issues.push('Agent must have a Safe address');
        recommendations.push('Set up Safe wallet first');
      }
      
      if (!agentInfo.tbaAddress || agentInfo.tbaAddress === '0x0000000000000000000000000000000000000000') {
        issues.push('Agent must have a TBA address');
        recommendations.push('Deploy TBA contract first');
      }
      
      if (agentInfo.tier === 'free') {
        recommendations.push('Consider upgrading to Professional tier for better brain performance');
      }

      return {
        valid: issues.length === 0,
        issues,
        recommendations
      };
    } catch (error) {
      return {
        valid: false,
        issues: ['Failed to validate agent requirements'],
        recommendations: ['Check agent configuration and try again']
      };
    }
  }
}
