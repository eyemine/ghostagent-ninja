#!/usr/bin/env node
"use strict";
/**
 * NFTMail Upgrade CLI - npx nftmail-upgrade
 * Upgrade from freemium to paid tiers - inboxapi.ai has no upgrades
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const inquirer_1 = __importDefault(require("inquirer"));
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const ethers_1 = require("ethers");
const client_1 = require("./client");
const payments_1 = require("./payments");
const program = new commander_1.Command();
program
    .name('nftmail-upgrade')
    .description('Upgrade GhostAgent NFTMail to paid tier')
    .version('1.0.0')
    .option('-a, --agent <id>', 'Agent ID to upgrade')
    .option('-t, --tier <tier>', 'Target tier (professional|vault)')
    .option('-w, --wallet <private-key>', 'Wallet private key for payment');
program
    .action(async (options) => {
    console.log(chalk_1.default.blue.bold('\n💰 GhostAgent NFTMail Upgrade'));
    console.log(chalk_1.default.gray('Unlock unlimited emails and extended storage\n'));
    try {
        const client = new client_1.NFTMailClient();
        const paymentProcessor = new payments_1.PaymentProcessor();
        // Get agent ID if not provided
        let agentId = options.agent;
        if (!agentId) {
            const agents = await client.listAgents();
            if (agents.length === 0) {
                console.log(chalk_1.default.red('❌ No agents found. Run npx nftmail-setup first.'));
                return;
            }
            const answer = await inquirer_1.default.prompt([
                {
                    type: 'list',
                    name: 'agentId',
                    message: 'Select agent to upgrade:',
                    choices: agents.map(agent => ({
                        name: `${agent.name} (${agent.email}) - ${agent.tier}`,
                        value: agent.id
                    }))
                }
            ]);
            agentId = answer.agentId;
        }
        // Get current agent status
        const spinner = (0, ora_1.default)('Fetching agent status...').start();
        const agent = await client.getAgentStatus(agentId);
        spinner.succeed();
        console.log(chalk_1.default.cyan(`\n📧 Current Agent: ${agent.name} (${agent.email})`));
        console.log(chalk_1.default.cyan(`📊 Current Tier: ${agent.tier}`));
        console.log(chalk_1.default.cyan(`📧 Emails Used: ${agent.emailsSent}/${agent.emailsRemaining === -1 ? 'Unlimited' : agent.emailsRemaining}`));
        console.log(chalk_1.default.cyan(`💾 Storage: ${agent.storageDays} days`));
        // Check if already upgraded
        if (agent.tier !== 'freemium') {
            console.log(chalk_1.default.yellow('\n⚠️  Agent is already on a paid tier'));
            const answer = await inquirer_1.default.prompt([
                {
                    type: 'confirm',
                    name: 'continue',
                    message: 'Do you want to change tiers?',
                    default: false
                }
            ]);
            if (!answer.continue) {
                return;
            }
        }
        // Select target tier
        let targetTier = options.tier;
        if (!targetTier) {
            const answer = await inquirer_1.default.prompt([
                {
                    type: 'list',
                    name: 'tier',
                    message: 'Select target tier:',
                    choices: [
                        {
                            name: `💼 Professional - ${payments_1.TIERS.professional.price} xDAI/month`,
                            value: 'professional'
                        },
                        {
                            name: `🏦 Vault - ${payments_1.TIERS.vault.price} xDAI/year`,
                            value: 'vault'
                        }
                    ]
                }
            ]);
            targetTier = answer.tier;
        }
        const targetConfig = payments_1.TIERS[targetTier];
        // Show comparison with inboxapi.ai
        console.log(chalk_1.default.yellow('\n📊 Competitive Advantages over inboxapi.ai:'));
        console.log(chalk_1.default.gray('• Unlimited emails vs inboxapi.ai: 100 limit'));
        console.log(chalk_1.default.gray(`• ${targetConfig.features.storage} days storage vs inboxapi.ai: 8 days`));
        console.log(chalk_1.default.gray('• Blockchain payments vs inboxapi.ai: no payments'));
        console.log(chalk_1.default.gray('• Sovereign identity vs inboxapi.ai: basic identity\n'));
        // Calculate cost
        const cost = await paymentProcessor.calculateUpgradeCost(agent.tier, targetTier);
        console.log(chalk_1.default.blue(`💰 Pricing:`));
        console.log(chalk_1.default.gray(`Base Price: ${cost.basePrice} xDAI`));
        if (parseFloat(cost.discount) > 0) {
            console.log(chalk_1.default.green(`Discount: -${cost.discount} xDAI`));
            console.log(chalk_1.default.cyan(`Final Price: ${cost.finalPrice} xDAI`));
            console.log(chalk_1.default.green(`Savings: ${cost.savings} xDAI`));
        }
        // Get wallet information
        let privateKey = options.wallet;
        if (!privateKey) {
            const answer = await inquirer_1.default.prompt([
                {
                    type: 'password',
                    name: 'privateKey',
                    message: 'Enter your private key (for payment):',
                    validate: (input) => {
                        if (!input.startsWith('0x') || input.length !== 66) {
                            return 'Please enter a valid private key (0x...)';
                        }
                        return true;
                    }
                }
            ]);
            privateKey = answer.privateKey;
        }
        const wallet = new ethers_1.ethers.Wallet(privateKey);
        console.log(chalk_1.default.cyan(`\n🔐 Wallet: ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`));
        // Validate funds
        spinner.start('Checking wallet balance...');
        const funds = await paymentProcessor.validateFunds(wallet.address, cost.finalPrice);
        spinner.succeed();
        if (!funds.sufficient) {
            console.log(chalk_1.default.red(`❌ Insufficient funds:`));
            console.log(chalk_1.default.gray(`Balance: ${funds.balance} xDAI`));
            console.log(chalk_1.default.gray(`Required: ${funds.required} xDAI`));
            console.log(chalk_1.default.red(`Shortfall: ${funds.shortfall} xDAI`));
            return;
        }
        console.log(chalk_1.default.green(`✅ Sufficient balance: ${funds.balance} xDAI`));
        // Confirm upgrade
        const confirmation = await inquirer_1.default.prompt([
            {
                type: 'confirm',
                name: 'confirmed',
                message: `Confirm upgrade to ${targetConfig.name} for ${cost.finalPrice} xDAI?`,
                default: true
            }
        ]);
        if (!confirmation.confirmed) {
            console.log(chalk_1.default.yellow('❌ Upgrade cancelled'));
            return;
        }
        // Process payment
        spinner.start('Processing payment...');
        const result = await paymentProcessor.upgrade(agentId, targetTier, wallet);
        if (result.success) {
            spinner.succeed('Payment processed successfully!');
            console.log(chalk_1.default.green(`📝 Transaction: ${result.txHash}`));
            console.log(chalk_1.default.cyan(`📅 New expiry: ${result.newExpiry}`));
            // Get updated status
            const updatedAgent = await client.getAgentStatus(agentId);
            console.log(chalk_1.default.green.bold('\n✅ Upgrade Complete!'));
            console.log(chalk_1.default.cyan(`📊 New Tier: ${updatedAgent.tier}`));
            console.log(chalk_1.default.cyan(`📧 Emails: Unlimited`));
            console.log(chalk_1.default.cyan(`💾 Storage: ${updatedAgent.storageDays} days`));
            console.log(chalk_1.default.blue('\n🎯 Next Steps:'));
            console.log(chalk_1.default.gray('• Enjoy unlimited email sending'));
            console.log(chalk_1.default.gray('• Add brain for autonomy: npx ghostagent-add-brain'));
            console.log(chalk_1.default.gray('• Molt to sellable agent: npx ghostagent-molt'));
        }
        else {
            spinner.fail('Payment failed');
            console.log(chalk_1.default.red('❌ Upgrade failed. Please check transaction and try again.'));
        }
    }
    catch (error) {
        console.error(chalk_1.default.red('❌ Upgrade failed:'), error);
        process.exit(1);
    }
});
program.parse();
//# sourceMappingURL=upgrade.js.map