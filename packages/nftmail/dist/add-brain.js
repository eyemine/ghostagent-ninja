#!/usr/bin/env node
"use strict";
/**
 * Add Brain CLI - npx ghostagent-add-brain
 * Add brain to email agent for autonomy - inboxapi.ai has no brain features
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
const brain_1 = require("./brain");
const program = new commander_1.Command();
program
    .name('ghostagent-add-brain')
    .description('Add brain to GhostAgent for autonomy')
    .version('1.0.0')
    .option('-a, --agent <id>', 'Agent ID to add brain to')
    .option('-m, --model <model>', 'Brain model (gpt-4|claude-3|llama-3)')
    .option('-w, --wallet <private-key>', 'Wallet private key for funding');
program
    .action(async (options) => {
    console.log(chalk_1.default.blue.bold('\n🧠 GhostAgent Brain Addition'));
    console.log(chalk_1.default.gray('Add autonomous AI capabilities to your email agent\n'));
    try {
        const brainAdder = new brain_1.BrainAdder();
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
        // Check current brain status
        const spinner = (0, ora_1.default)('Checking agent status...').start();
        const currentStatus = await brainAdder.getBrainStatus(agentId);
        spinner.succeed();
        if (currentStatus.installed) {
            console.log(chalk_1.default.yellow('\n⚠️  Agent already has a brain installed'));
            console.log(chalk_1.default.cyan(`Model: ${currentStatus.model}`));
            console.log(chalk_1.default.cyan(`Capabilities: ${currentStatus.capabilities.join(', ')}`));
            console.log(chalk_1.default.cyan(`Brain ID: ${currentStatus.brainId}`));
            return;
        }
        // Validate requirements
        spinner.start('Validating requirements...');
        const validation = await brainAdder.validateRequirements(agentId);
        spinner.succeed();
        if (!validation.valid) {
            console.log(chalk_1.default.red('\n❌ Requirements not met:'));
            validation.issues.forEach(issue => console.log(chalk_1.default.red(`• ${issue}`)));
            console.log(chalk_1.default.yellow('\n💡 Recommendations:'));
            validation.recommendations.forEach(rec => console.log(chalk_1.default.yellow(`• ${rec}`)));
            return;
        }
        // Show available models
        const models = brainAdder.listAvailableModels();
        console.log(chalk_1.default.blue('\n🤖 Available Brain Models:'));
        models.forEach(model => {
            console.log(chalk_1.default.cyan(`\n${model.name}:`));
            console.log(chalk_1.default.gray(`  ${model.description}`));
            console.log(chalk_1.default.gray(`  Cost: ${model.cost}`));
            console.log(chalk_1.default.gray(`  Capabilities: ${model.capabilities.join(', ')}`));
        });
        // Select model
        let selectedModel = options.model;
        if (!selectedModel) {
            const answer = await inquirer_1.default.prompt([
                {
                    type: 'list',
                    name: 'model',
                    message: 'Select brain model:',
                    choices: models.map(model => ({
                        name: `${model.name} (${model.cost})`,
                        value: model.name
                    }))
                }
            ]);
            selectedModel = answer.model;
        }
        const modelConfig = models.find(m => m.name === selectedModel);
        // Show competitive advantages over inboxapi.ai
        console.log(chalk_1.default.yellow('\n📊 Competitive Advantages over inboxapi.ai:'));
        console.log(chalk_1.default.gray('• Autonomous AI decisions vs inboxapi.ai: no AI'));
        console.log(chalk_1.default.gray('• Self-learning capabilities vs inboxapi.ai: static'));
        console.log(chalk_1.default.gray('• Complex reasoning vs inboxapi.ai: basic email'));
        console.log(chalk_1.default.gray('• Payment automation vs inboxapi.ai: no payments\n'));
        // Get wallet information
        let privateKey = options.wallet;
        if (!privateKey) {
            const answer = await inquirer_1.default.prompt([
                {
                    type: 'password',
                    name: 'privateKey',
                    message: 'Enter your private key (for 0.01 ETH funding):',
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
        const required = ethers_1.ethers.parseEther('0.01');
        spinner.succeed();
        if (balance < required) {
            console.log(chalk_1.default.red(`❌ Insufficient funds:`));
            console.log(chalk_1.default.gray(`Balance: ${ethers_1.ethers.formatEther(balance)} ETH`));
            console.log(chalk_1.default.gray(`Required: 0.01 ETH`));
            console.log(chalk_1.default.red(`Shortfall: ${ethers_1.ethers.formatEther(required - balance)} ETH`));
            return;
        }
        console.log(chalk_1.default.green(`✅ Sufficient balance: ${ethers_1.ethers.formatEther(balance)} ETH`));
        // Confirm brain addition
        const confirmation = await inquirer_1.default.prompt([
            {
                type: 'confirm',
                name: 'confirmed',
                message: `Confirm adding ${modelConfig.name} brain for 0.01 ETH?`,
                default: true
            }
        ]);
        if (!confirmation.confirmed) {
            console.log(chalk_1.default.yellow('❌ Brain addition cancelled'));
            return;
        }
        // Add brain
        spinner.start('Installing brain...');
        const result = await brainAdder.addToAgent(agentId, {
            model: selectedModel,
            capabilities: modelConfig.capabilities,
            funding: {
                amount: '0.01',
                wallet: wallet.address
            }
        });
        spinner.succeed('Brain installed successfully!');
        // Display results
        console.log(chalk_1.default.green.bold('\n✅ Brain Addition Complete!'));
        console.log(chalk_1.default.cyan(`🧠 Model: ${result.model}`));
        console.log(chalk_1.default.cyan(`🎯 Capabilities: ${result.capabilities.join(', ')}`));
        console.log(chalk_1.default.cyan(`🔐 Safe: ${result.safeAddress.slice(0, 6)}...${result.safeAddress.slice(-4)}`));
        console.log(chalk_1.default.cyan(`🎭 TBA: ${result.tbaAddress.slice(0, 6)}...${result.tbaAddress.slice(-4)}`));
        console.log(chalk_1.default.cyan(`🆔 Brain ID: ${result.brainId}`));
        console.log(chalk_1.default.cyan(`📅 Activated: ${result.activationDate}`));
        console.log(chalk_1.default.blue('\n🎯 Next Steps:'));
        console.log(chalk_1.default.gray('• Your agent can now make autonomous decisions'));
        console.log(chalk_1.default.gray('• Configure brain behavior in agent settings'));
        console.log(chalk_1.default.gray('• Molt to sellable agent: npx ghostagent-molt'));
        console.log(chalk_1.default.gray('• Monitor brain activity in dashboard'));
        console.log(chalk_1.default.magenta('\n📚 Brain Documentation: https://docs.ghostagent.ninja/brain'));
        console.log(chalk_1.default.magenta('💬 Support: https://discord.gg/ghostagent'));
    }
    catch (error) {
        console.error(chalk_1.default.red('❌ Brain addition failed:'), error);
        process.exit(1);
    }
});
program.parse();
//# sourceMappingURL=add-brain.js.map