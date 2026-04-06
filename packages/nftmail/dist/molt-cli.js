#!/usr/bin/env node
"use strict";
/**
 * Molt CLI - npx ghostagent-molt
 * Convert email agent to sellable agent - inboxapi.ai has no molt
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
const molt_1 = require("./molt");
const program = new commander_1.Command();
program
    .name('ghostagent-molt')
    .description('Molt email agent to sellable agent')
    .version('1.0.0')
    .option('-a, --agent <id>', 'Agent ID to molt')
    .option('-t, --tld <tld>', 'Target TLD (gno|eth|base)')
    .option('-w, --wallet <private-key>', 'Wallet private key for payment')
    .option('-p, --price <price>', 'Starting marketplace price')
    .option('--no-list', 'Do not list on marketplace immediately');
program
    .action(async (options) => {
    console.log(chalk_1.default.blue.bold('\n🔥 GhostAgent Molt Process'));
    console.log(chalk_1.default.gray('Convert email agent to sellable autonomous agent\n'));
    try {
        const moltProcessor = new molt_1.MoltProcessor();
        // Get agent ID if not provided
        let agentId = options.agent;
        if (!agentId) {
            const answer = await inquirer_1.default.prompt([
                {
                    type: 'input',
                    name: 'agentId',
                    message: 'Enter agent ID:',
                    validate: (input) => {
                        if (!input.trim()) {
                            return 'Agent ID is required';
                        }
                        return true;
                    }
                }
            ]);
            agentId = answer.agentId;
        }
        // Check molt eligibility
        const spinner = (0, ora_1.default)('Checking molt eligibility...').start();
        const eligibility = await moltProcessor.checkMoltEligibility(agentId);
        spinner.succeed();
        if (!eligibility.eligible) {
            console.log(chalk_1.default.red('\n❌ Agent not eligible for molt:'));
            eligibility.missing.forEach(missing => console.log(chalk_1.default.red(`• ${missing}`)));
            console.log(chalk_1.default.yellow('\n💡 Requirements:'));
            eligibility.requirements.forEach(req => console.log(chalk_1.default.yellow(`• ${req}`)));
            return;
        }
        console.log(chalk_1.default.green('\n✅ Agent eligible for molt!'));
        console.log(chalk_1.default.cyan(`💰 Estimated value: ${eligibility.estimatedValue} ETH`));
        // Get current valuation
        spinner.start('Calculating agent valuation...');
        const valuation = await moltProcessor.calculateValuation(agentId);
        spinner.succeed();
        console.log(chalk_1.default.blue('\n💎 Agent Valuation:'));
        console.log(chalk_1.default.gray(`Base Value: ${valuation.baseValue} ETH`));
        console.log(chalk_1.default.gray(`Brain Value: ${valuation.brainValue} ETH`));
        console.log(chalk_1.default.gray(`Email History: ${valuation.emailHistoryValue} ETH`));
        console.log(chalk_1.default.gray(`Payment History: ${valuation.paymentHistoryValue} ETH`));
        console.log(chalk_1.default.cyan(`Total Components: ${valuation.totalValue} ETH`));
        console.log(chalk_1.default.cyan(`Market Multiplier: ${valuation.marketMultiplier}x`));
        console.log(chalk_1.default.green(`Estimated Sale Price: ${valuation.estimatedSalePrice} ETH`));
        // Select target TLD
        let targetTLD = options.tld;
        if (!targetTLD) {
            const answer = await inquirer_1.default.prompt([
                {
                    type: 'list',
                    name: 'tld',
                    message: 'Select target TLD:',
                    choices: [
                        { name: '🌟 .gno (Gnosis) - Primary marketplace', value: 'gno' },
                        { name: '💎 .eth (Ethereum) - Premium domain', value: 'eth' },
                        { name: '🔷 .base (Base) - Emerging marketplace', value: 'base' }
                    ]
                }
            ]);
            targetTLD = answer.tld;
        }
        // Show competitive advantages over inboxapi.ai
        console.log(chalk_1.default.yellow('\n📊 Competitive Advantages over inboxapi.ai:'));
        console.log(chalk_1.default.gray('• Sellable agent vs inboxapi.ai: not sellable'));
        console.log(chalk_1.default.gray('• Marketplace integration vs inboxapi.ai: no marketplace'));
        console.log(chalk_1.default.gray(`• ${valuation.marketMultiplier}x value multiplier vs inboxapi.ai: 0x`));
        console.log(chalk_1.default.gray(`• ${valuation.estimatedSalePrice} ETH potential vs inboxapi.ai: $0\n`));
        // Marketplace configuration
        let startingPrice = options.price;
        let listImmediately = options.list !== false;
        if (!startingPrice) {
            const answer = await inquirer_1.default.prompt([
                {
                    type: 'list',
                    name: 'priceOption',
                    message: 'Select starting price strategy:',
                    choices: [
                        { name: `Recommended (${valuation.estimatedSalePrice} ETH)`, value: 'recommended' },
                        { name: 'Aggressive (+20%)', value: 'aggressive' },
                        { name: 'Conservative (-20%)', value: 'conservative' },
                        { name: 'Custom price', value: 'custom' }
                    ]
                },
                {
                    type: 'input',
                    name: 'customPrice',
                    message: 'Enter custom price (ETH):',
                    when: (answers) => answers.priceOption === 'custom',
                    validate: (input) => {
                        const price = parseFloat(input);
                        if (isNaN(price) || price <= 0) {
                            return 'Please enter a valid positive number';
                        }
                        return true;
                    }
                }
            ]);
            const basePrice = parseFloat(valuation.estimatedSalePrice);
            switch (answer.priceOption) {
                case 'recommended':
                    startingPrice = valuation.estimatedSalePrice;
                    break;
                case 'aggressive':
                    startingPrice = (basePrice * 1.2).toFixed(4);
                    break;
                case 'conservative':
                    startingPrice = (basePrice * 0.8).toFixed(4);
                    break;
                case 'custom':
                    startingPrice = answer.customPrice;
                    break;
            }
        }
        if (!options.list) {
            const answer = await inquirer_1.default.prompt([
                {
                    type: 'confirm',
                    name: 'list',
                    message: `List immediately on marketplace for ${startingPrice} ETH?`,
                    default: true
                }
            ]);
            listImmediately = answer.list;
        }
        // Get wallet information
        let privateKey = options.wallet;
        if (!privateKey) {
            const answer = await inquirer_1.default.prompt([
                {
                    type: 'password',
                    name: 'privateKey',
                    message: 'Enter your private key (for 0.035 ETH molt fee):',
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
        const provider = new ethers_1.ethers.JsonRpcProvider('https://rpc.gnosischain.com');
        const balance = await provider.getBalance(wallet.address);
        const required = ethers_1.ethers.parseEther('0.035');
        spinner.succeed();
        if (balance < required) {
            console.log(chalk_1.default.red(`❌ Insufficient funds:`));
            console.log(chalk_1.default.gray(`Balance: ${ethers_1.ethers.formatEther(balance)} ETH`));
            console.log(chalk_1.default.gray(`Required: 0.035 ETH`));
            console.log(chalk_1.default.red(`Shortfall: ${ethers_1.ethers.formatEther(required - balance)} ETH`));
            return;
        }
        console.log(chalk_1.default.green(`✅ Sufficient balance: ${ethers_1.ethers.formatEther(balance)} ETH`));
        // Show molt economics
        console.log(chalk_1.default.blue('\n📊 Molt Economics:'));
        console.log(chalk_1.default.gray(`Investment: 0.035 ETH`));
        console.log(chalk_1.default.gray(`Estimated Return: ${valuation.estimatedSalePrice} ETH`));
        console.log(chalk_1.default.green(`Potential ROI: ${((parseFloat(valuation.estimatedSalePrice) - 0.035) / 0.035 * 100).toFixed(1)}%`));
        // Confirm molt
        const confirmation = await inquirer_1.default.prompt([
            {
                type: 'confirm',
                name: 'confirmed',
                message: `Confirm molt to ${agentId}.${targetTLD} for 0.035 ETH?`,
                default: true
            }
        ]);
        if (!confirmation.confirmed) {
            console.log(chalk_1.default.yellow('❌ Molt cancelled'));
            return;
        }
        // Perform molt
        spinner.start('Processing molt...');
        const result = await moltProcessor.molt(agentId, {
            targetTLD,
            marketplace: {
                listImmediately,
                startingPrice,
                description: `Autonomous agent ${agentId} with brain, email capabilities, and payment processing`
            }
        });
        spinner.succeed('Molt completed successfully!');
        // Display results
        console.log(chalk_1.default.green.bold('\n✅ Molt Complete!'));
        console.log(chalk_1.default.cyan(`🔥 New Agent: ${result.newDomain}`));
        console.log(chalk_1.default.cyan(`🆔 New Agent ID: ${result.newAgentId}`));
        console.log(chalk_1.default.cyan(`📝 Transaction: ${result.txHash}`));
        console.log(chalk_1.default.cyan(`💰 Estimated Value: ${result.estimatedValue} ETH`));
        console.log(chalk_1.default.green(`📈 ROI: ${result.roi}%`));
        if (result.marketplaceUrl) {
            console.log(chalk_1.default.cyan(`🏪 Marketplace: ${result.marketplaceUrl}`));
        }
        console.log(chalk_1.default.blue('\n🎯 Next Steps:'));
        console.log(chalk_1.default.gray('• Your agent is now sellable on the marketplace'));
        console.log(chalk_1.default.gray('• Monitor bidding activity in your dashboard'));
        console.log(chalk_1.default.gray('• Transfer ownership to buyer upon sale'));
        console.log(chalk_1.default.gray('• Reinvest profits in new agents'));
        console.log(chalk_1.default.magenta('\n📚 Molt Documentation: https://docs.ghostagent.ninja/molt'));
        console.log(chalk_1.default.magenta('🏪 Marketplace: https://marketplace.ghostagent.ninja'));
        console.log(chalk_1.default.magenta('💬 Support: https://discord.gg/ghostagent'));
    }
    catch (error) {
        console.error(chalk_1.default.red('❌ Molt failed:'), error);
        process.exit(1);
    }
});
program.parse();
//# sourceMappingURL=molt-cli.js.map