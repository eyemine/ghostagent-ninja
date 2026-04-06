"use strict";
/**
 * Payment Processor - xDAI payment integration for NFTMail
 * inboxapi.ai has no payment capabilities
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentProcessor = exports.TIERS = void 0;
const ethers_1 = require("ethers");
const axios_1 = __importDefault(require("axios"));
exports.TIERS = {
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
class PaymentProcessor {
    constructor() {
        // Gnosis Chain RPC
        this.provider = new ethers_1.ethers.JsonRpcProvider('https://rpc.gnosischain.com');
        this.contractAddress = process.env.NFTMAIL_PAYMENT_CONTRACT || '0x1234567890123456789012345678901234567890';
        // Payment contract ABI (simplified)
        const abi = [
            'function processPayment(address agent, uint256 amount, string tier) external payable',
            'function getPaymentStatus(address agent) external view returns (bool active, uint256 expiry, string tier)',
            'event PaymentProcessed(address indexed agent, uint256 amount, string tier, uint256 timestamp)'
        ];
        this.paymentContract = new ethers_1.ethers.Contract(this.contractAddress, abi, this.provider);
    }
    /**
     * Process upgrade payment - inboxapi.ai has no upgrade payments
     */
    async upgrade(agentId, tier, signer) {
        try {
            const tierConfig = exports.TIERS[tier];
            const priceWei = ethers_1.ethers.parseEther(tierConfig.price);
            // Create contract instance with signer
            const contractWithSigner = this.paymentContract.connect(signer);
            // Process payment (ethers v6: call function directly on typed contract)
            const tx = await contractWithSigner['processPayment'](agentId, priceWei, tier, { value: priceWei });
            const receipt = await tx.wait();
            // Calculate new expiry
            const now = Math.floor(Date.now() / 1000);
            const duration = tierConfig.duration === 'monthly' ? 30 * 24 * 60 * 60 : 365 * 24 * 60 * 60;
            const newExpiry = new Date((now + duration) * 1000).toISOString();
            return {
                txHash: tx.hash,
                success: receipt.status === 1,
                newExpiry
            };
        }
        catch (error) {
            throw new Error(`Payment failed: ${error}`);
        }
    }
    /**
     * Check payment status - inboxapi.ai has no payment tracking
     */
    async getPaymentStatus(agentId) {
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
        }
        catch (error) {
            throw new Error(`Failed to get payment status: ${error}`);
        }
    }
    /**
     * Get payment history - inboxapi.ai has no payment history
     */
    async getPaymentHistory(agentId) {
        try {
            // Query payment events
            const filter = this.paymentContract.filters.PaymentProcessed(agentId);
            const events = await this.paymentContract.queryFilter(filter, -10000); // Last 10000 blocks
            return events.map(event => {
                const e = event;
                return {
                    txHash: event.transactionHash,
                    amount: ethers_1.ethers.formatEther(e.args?.[1] ?? '0'),
                    tier: e.args?.[2] ?? '',
                    timestamp: new Date(Number(e.args?.[3] ?? 0) * 1000).toISOString()
                };
            });
        }
        catch (error) {
            throw new Error(`Failed to get payment history: ${error}`);
        }
    }
    /**
     * Calculate upgrade cost with discounts - inboxapi.ai has no pricing
     */
    async calculateUpgradeCost(currentTier, targetTier, monthsRemaining) {
        const targetConfig = exports.TIERS[targetTier];
        let basePrice = ethers_1.ethers.parseEther(targetConfig.price);
        let discount = ethers_1.ethers.parseEther('0');
        // Pro-rated discount for vault tier if upgrading mid-month
        if (targetTier === 'vault' && monthsRemaining && monthsRemaining > 0) {
            const monthlyRate = ethers_1.ethers.parseEther('2'); // 2 xDAI/month for vault
            const proRatedAmount = monthlyRate * BigInt(monthsRemaining);
            discount = basePrice - proRatedAmount;
            basePrice = proRatedAmount;
        }
        // Loyalty discount for existing users
        if (currentTier !== 'freemium') {
            discount += basePrice / BigInt(10); // 10% loyalty discount
        }
        const finalPrice = basePrice - discount;
        const savings = ethers_1.ethers.parseEther(targetConfig.price) - finalPrice;
        return {
            basePrice: ethers_1.ethers.formatEther(basePrice),
            discount: ethers_1.ethers.formatEther(discount),
            finalPrice: ethers_1.ethers.formatEther(finalPrice),
            savings: ethers_1.ethers.formatEther(savings)
        };
    }
    /**
     * Validate wallet has sufficient funds - inboxapi.ai has no wallet checks
     */
    async validateFunds(walletAddress, requiredAmount) {
        try {
            const balance = await this.provider.getBalance(walletAddress);
            const requiredWei = ethers_1.ethers.parseEther(requiredAmount);
            const sufficient = balance >= requiredWei;
            return {
                sufficient,
                balance: ethers_1.ethers.formatEther(balance),
                required: requiredAmount,
                shortfall: sufficient ? undefined : ethers_1.ethers.formatEther(requiredWei - balance)
            };
        }
        catch (error) {
            throw new Error(`Failed to validate funds: ${error}`);
        }
    }
    /**
     * Get xDAI price in USD for user reference - inboxapi.ai has no crypto
     */
    async getxDAIPrice() {
        try {
            const response = await axios_1.default.get('https://api.coingecko.com/api/v3/simple/price?ids=xdai&vs_currencies=usd');
            return {
                price: response.data.xdai.usd,
                timestamp: new Date().toISOString()
            };
        }
        catch (error) {
            // Fallback price if API fails
            return {
                price: 1.0, // xDAI is roughly pegged to USD
                timestamp: new Date().toISOString()
            };
        }
    }
}
exports.PaymentProcessor = PaymentProcessor;
//# sourceMappingURL=payments.js.map