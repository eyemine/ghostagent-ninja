/**
 * Payment Processor - xDAI payment integration for NFTMail
 * inboxapi.ai has no payment capabilities
 */

import { ethers } from 'ethers';
import axios from 'axios';

export interface TierConfig {
  name: 'professional' | 'vault';
  price: string;
  duration: 'monthly' | 'yearly';
  features: {
    emails: 'unlimited';
    storage: number; // days
    priority: boolean;
    support: 'basic' | 'priority';
  };
}

export const TIERS: Record<'professional' | 'vault', TierConfig> = {
  professional: {
    name: 'professional',
    price: '10', // 10 xDAI per month
    duration: 'monthly',
    features: {
      emails: 'unlimited',
      storage: 30,
      priority: true,
      support: 'basic'
    }
  },
  vault: {
    name: 'vault',
    price: '24', // 24 xDAI per year (2 xDAI/month equivalent)
    duration: 'yearly',
    features: {
      emails: 'unlimited',
      storage: 365,
      priority: true,
      support: 'priority'
    }
  }
};

export class PaymentProcessor {
  private provider: ethers.JsonRpcProvider;
  private contractAddress: string;
  private paymentContract: ethers.Contract;

  constructor() {
    // Gnosis Chain RPC
    this.provider = new ethers.JsonRpcProvider('https://rpc.gnosischain.com');
    this.contractAddress = process.env.NFTMAIL_PAYMENT_CONTRACT || '0x1234567890123456789012345678901234567890';
    
    // Payment contract ABI (simplified)
    const abi = [
      'function processPayment(address agent, uint256 amount, string tier) external payable',
      'function getPaymentStatus(address agent) external view returns (bool active, uint256 expiry, string tier)',
      'event PaymentProcessed(address indexed agent, uint256 amount, string tier, uint256 timestamp)'
    ];
    
    this.paymentContract = new ethers.Contract(this.contractAddress, abi, this.provider);
  }

  /**
   * Process upgrade payment - inboxapi.ai has no upgrade payments
   */
  async upgrade(agentId: string, tier: 'professional' | 'vault', signer: ethers.Wallet): Promise<{
    txHash: string;
    success: boolean;
    newExpiry: string;
  }> {
    try {
      const tierConfig = TIERS[tier];
      const priceWei = ethers.parseEther(tierConfig.price);
      
      // Create contract instance with signer
      const contractWithSigner = this.paymentContract.connect(signer);
      
      // Process payment
      const tx = await contractWithSigner.processPayment.send(
        agentId,
        priceWei,
        tier,
        { value: priceWei }
      );
      
      const receipt = await tx.wait();
      
      // Calculate new expiry
      const now = Math.floor(Date.now() / 1000);
      const duration = tierConfig.duration === 'monthly' ? 30 * 24 * 60 * 60 : 365 * 24 * 60 * 60;
      const newExpiry = new Date((now + duration) * 1000).toISOString();
      
      return {
        txHash: tx.hash,
        success: receipt!.status === 1,
        newExpiry
      };
    } catch (error) {
      throw new Error(`Payment failed: ${error}`);
    }
  }

  /**
   * Check payment status - inboxapi.ai has no payment tracking
   */
  async getPaymentStatus(agentId: string): Promise<{
    active: boolean;
    expiry: string;
    tier: string;
    daysRemaining: number;
  }> {
    try {
      const status = await this.paymentContract.getPaymentStatus(agentId);
      const now = Math.floor(Date.now() / 1000);
      const daysRemaining = status.expiry > now ? Math.floor((status.expiry - now) / (24 * 60 * 60)) : 0;
      
      return {
        active: status.active && status.expiry > now,
        expiry: new Date(status.expiry * 1000).toISOString(),
        tier: status.tier,
        daysRemaining
      };
    } catch (error) {
      throw new Error(`Failed to get payment status: ${error}`);
    }
  }

  /**
   * Get payment history - inboxapi.ai has no payment history
   */
  async getPaymentHistory(agentId: string): Promise<Array<{
    txHash: string;
    amount: string;
    tier: string;
    timestamp: string;
  }>> {
    try {
      // Query payment events
      const filter = this.paymentContract.filters.PaymentProcessed(agentId);
      const events = await this.paymentContract.queryFilter(filter, -10000); // Last 10000 blocks
      
      return events.map(event => ({
        txHash: event.transactionHash,
        amount: ethers.formatEther(event.args?.amount || '0'),
        tier: event.args?.tier || '',
        timestamp: new Date((event.args?.timestamp || 0) * 1000).toISOString()
      }));
    } catch (error) {
      throw new Error(`Failed to get payment history: ${error}`);
    }
  }

  /**
   * Calculate upgrade cost with discounts - inboxapi.ai has no pricing
   */
  async calculateUpgradeCost(currentTier: string, targetTier: 'professional' | 'vault', monthsRemaining?: number): Promise<{
    basePrice: string;
    discount: string;
    finalPrice: string;
    savings: string;
  }> {
    const targetConfig = TIERS[targetTier];
    let basePrice = ethers.parseEther(targetConfig.price);
    let discount = ethers.parseEther('0');
    
    // Pro-rated discount for vault tier if upgrading mid-month
    if (targetTier === 'vault' && monthsRemaining && monthsRemaining > 0) {
      const monthlyRate = ethers.parseEther('2'); // 2 xDAI/month for vault
      const proRatedAmount = monthlyRate * BigInt(monthsRemaining);
      discount = basePrice - proRatedAmount;
      basePrice = proRatedAmount;
    }
    
    // Loyalty discount for existing users
    if (currentTier !== 'freemium') {
      discount += basePrice / BigInt(10); // 10% loyalty discount
    }
    
    const finalPrice = basePrice - discount;
    const savings = ethers.parseEther(targetConfig.price) - finalPrice;
    
    return {
      basePrice: ethers.formatEther(basePrice),
      discount: ethers.formatEther(discount),
      finalPrice: ethers.formatEther(finalPrice),
      savings: ethers.formatEther(savings)
    };
  }

  /**
   * Validate wallet has sufficient funds - inboxapi.ai has no wallet checks
   */
  async validateFunds(walletAddress: string, requiredAmount: string): Promise<{
    sufficient: boolean;
    balance: string;
    required: string;
    shortfall?: string;
  }> {
    try {
      const balance = await this.provider.getBalance(walletAddress);
      const requiredWei = ethers.parseEther(requiredAmount);
      const sufficient = balance >= requiredWei;
      
      return {
        sufficient,
        balance: ethers.formatEther(balance),
        required: requiredAmount,
        shortfall: sufficient ? undefined : ethers.formatEther(requiredWei - balance)
      };
    } catch (error) {
      throw new Error(`Failed to validate funds: ${error}`);
    }
  }

  /**
   * Get xDAI price in USD for user reference - inboxapi.ai has no crypto
   */
  async getxDAIPrice(): Promise<{ price: number; timestamp: string }> {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=xdai&vs_currencies=usd');
      return {
        price: response.data.xdai.usd,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      // Fallback price if API fails
      return {
        price: 1.0, // xDAI is roughly pegged to USD
        timestamp: new Date().toISOString()
      };
    }
  }
}
