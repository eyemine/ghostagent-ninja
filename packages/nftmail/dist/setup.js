#!/usr/bin/env node
"use strict";
/**
 * NFTMail Setup CLI - npx nftmail-setup
 * Creates freemium email agent - superior to inboxapi.ai setup
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const inquirer_1 = __importDefault(require("inquirer"));
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const client_1 = require("./client");
const program = new commander_1.Command();
program
    .name('nftmail-setup')
    .description('Setup GhostAgent NFTMail - blockchain-native email service')
    .version('1.0.0');
program
    .action(async () => {
    console.log(chalk_1.default.blue.bold('\n🚀 GhostAgent NFTMail Setup'));
    console.log(chalk_1.default.gray('Blockchain-native email service - superior to inboxapi.ai\n'));
    try {
        // Get user information
        const answers = await inquirer_1.default.prompt([
            {
                type: 'input',
                name: 'name',
                message: 'Choose your email agent name:',
                default: 'my-agent',
                validate: (input) => {
                    if (!input.match(/^[a-z0-9-]+$/)) {
                        return 'Name must contain only lowercase letters, numbers, and hyphens';
                    }
                    return true;
                }
            },
            {
                type: 'list',
                name: 'tier',
                message: 'Choose your tier:',
                choices: [
                    {
                        name: '🆓 Freemium - 100 emails, 8-day storage (vs inboxapi.ai: 100 emails, 8 days)',
                        value: 'freemium'
                    },
                    {
                        name: '💼 Professional - 10 xDAI/month unlimited, 30-day storage',
                        value: 'professional'
                    },
                    {
                        name: '🏦 Vault - 24 xDAI/year unlimited, 365-day storage',
                        value: 'vault'
                    }
                ],
                default: 'freemium'
            },
            {
                type: 'confirm',
                name: 'customDomain',
                message: 'Use custom domain? (default: nftmail.box)',
                default: false
            },
            {
                type: 'input',
                name: 'domain',
                message: 'Enter your domain:',
                when: (answers) => answers.customDomain,
                validate: (input) => {
                    if (!input.match(/^[a-z0-9.-]+\.[a-z]{2,}$/)) {
                        return 'Please enter a valid domain';
                    }
                    return true;
                }
            }
        ]);
        // Show competitive advantages
        console.log(chalk_1.default.yellow('\n📊 Competitive Advantages over inboxapi.ai:'));
        console.log(chalk_1.default.gray('• Blockchain-native vs Web2 only'));
        console.log(chalk_1.default.gray('• Built-in x402 payments vs no payments'));
        console.log(chalk_1.default.gray('• Complete sovereignty vs basic identity'));
        console.log(chalk_1.default.gray('• Multi-channel vs email only'));
        console.log(chalk_1.default.gray('• Upgrade path vs no upgrades\n'));
        // Create agent
        const spinner = (0, ora_1.default)('Creating your email agent...').start();
        const client = new client_1.NFTMailClient();
        const agent = await client.createAgent({
            name: answers.name,
            tier: answers.tier,
            domain: answers.customDomain ? answers.domain : undefined
        });
        spinner.succeed('Email agent created successfully!');
        // Display results
        console.log(chalk_1.default.green.bold('\n✅ Setup Complete!'));
        console.log(chalk_1.default.cyan(`\n📧 Email Address: ${agent.email}`));
        console.log(chalk_1.default.cyan(`🏷️  Agent ID: ${agent.id}`));
        console.log(chalk_1.default.cyan(`📊 Tier: ${agent.tier}`));
        console.log(chalk_1.default.cyan(`📧 Emails Remaining: ${agent.emailsRemaining}`));
        console.log(chalk_1.default.cyan(`💾 Storage: ${agent.storageDays} days`));
        if (agent.safeAddress) {
            console.log(chalk_1.default.cyan(`🔐 Safe Address: ${agent.safeAddress.slice(0, 6)}...${agent.safeAddress.slice(-4)}`));
        }
        if (agent.tbaAddress) {
            console.log(chalk_1.default.cyan(`🎭 TBA Address: ${agent.tbaAddress.slice(0, 6)}...${agent.tbaAddress.slice(-4)}`));
        }
        // Show upgrade triggers
        if (answers.tier === 'freemium') {
            console.log(chalk_1.default.yellow('\n🔄 Upgrade Triggers:'));
            console.log(chalk_1.default.gray('• At 80 emails used'));
            console.log(chalk_1.default.gray('• At 8 days storage limit'));
            console.log(chalk_1.default.gray('• Run: npx nftmail-upgrade'));
        }
        // Show next steps
        console.log(chalk_1.default.blue('\n🎯 Next Steps:'));
        console.log(chalk_1.default.gray('• Send emails using the NFTMail SDK'));
        console.log(chalk_1.default.gray('• Add brain for autonomy: npx ghostagent-add-brain'));
        console.log(chalk_1.default.gray('• Molt to sellable agent: npx ghostagent-molt'));
        console.log(chalk_1.default.magenta('\n📚 Documentation: https://docs.ghostagent.ninja/nftmail'));
        console.log(chalk_1.default.magenta('💬 Support: https://discord.gg/ghostagent'));
    }
    catch (error) {
        console.error(chalk_1.default.red('❌ Setup failed:'), error);
        process.exit(1);
    }
});
program.parse();
//# sourceMappingURL=setup.js.map