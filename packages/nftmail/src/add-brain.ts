#!/usr/bin/env node

/**
 * Add Brain CLI - npx ghostagent-add-brain
 * Add brain to email agent for autonomy - inboxapi.ai has no brain features
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { ethers } from 'ethers';
import { BrainAdder } from './brain';

const program = new Command();

program
  .name('ghostagent-add-brain')
  .description('Add brain to GhostAgent for autonomy')
  .version('1.0.0')
  .option('-a, --agent <id>', 'Agent ID to add brain to')
  .option('-m, --model <model>', 'Brain model (gpt-4|claude-3|llama-3)')
  .option('-w, --wallet <private-key>', 'Wallet private key for funding');

program
  .action(async (options) => {
    console.log(chalk.blue.bold('\n🧠 GhostAgent Brain Addition'));
    console.log(chalk.gray('Add autonomous AI capabilities to your email agent\n'));

    try {
      const brainAdder = new BrainAdder();

      // Get agent ID if not provided
      let agentId = options.agent;
      if (!agentId) {
        const answer = await inquirer.prompt([
          {
            type: 'input',
            name: 'agentId',
            message: 'Enter agent ID:',
            validate: (input: string) => {
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
      const spinner = ora('Checking agent status...').start();
      const currentStatus = await brainAdder.getBrainStatus(agentId);
      spinner.succeed();

      if (currentStatus.installed) {
        console.log(chalk.yellow('\n⚠️  Agent already has a brain installed'));
        console.log(chalk.cyan(`Model: ${currentStatus.model}`));
        console.log(chalk.cyan(`Capabilities: ${currentStatus.capabilities.join(', ')}`));
        console.log(chalk.cyan(`Brain ID: ${currentStatus.brainId}`));
        return;
      }

      // Validate requirements
      spinner.start('Validating requirements...');
      const validation = await brainAdder.validateRequirements(agentId);
      spinner.succeed();

      if (!validation.valid) {
        console.log(chalk.red('\n❌ Requirements not met:'));
        validation.issues.forEach(issue => console.log(chalk.red(`• ${issue}`)));
        console.log(chalk.yellow('\n💡 Recommendations:'));
        validation.recommendations.forEach(rec => console.log(chalk.yellow(`• ${rec}`)));
        return;
      }

      // Show available models
      const models = brainAdder.listAvailableModels();
      console.log(chalk.blue('\n🤖 Available Brain Models:'));
      models.forEach(model => {
        console.log(chalk.cyan(`\n${model.name}:`));
        console.log(chalk.gray(`  ${model.description}`));
        console.log(chalk.gray(`  Cost: ${model.cost}`));
        console.log(chalk.gray(`  Capabilities: ${model.capabilities.join(', ')}`));
      });

      // Select model
      let selectedModel = options.model;
      if (!selectedModel) {
        const answer = await inquirer.prompt([
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

      const modelConfig = models.find(m => m.name === selectedModel)!;

      // Show competitive advantages over inboxapi.ai
      console.log(chalk.yellow('\n📊 Competitive Advantages over inboxapi.ai:'));
      console.log(chalk.gray('• Autonomous AI decisions vs inboxapi.ai: no AI'));
      console.log(chalk.gray('• Self-learning capabilities vs inboxapi.ai: static'));
      console.log(chalk.gray('• Complex reasoning vs inboxapi.ai: basic email'));
      console.log(chalk.gray('• Payment automation vs inboxapi.ai: no payments\n'));

      // Get wallet information
      let privateKey = options.wallet;
      if (!privateKey) {
        const answer = await inquirer.prompt([
          {
            type: 'password',
            name: 'privateKey',
            message: 'Enter your private key (for 0.01 ETH funding):',
            validate: (input: string) => {
              if (!input.startsWith('0x') || input.length !== 66) {
                return 'Please enter a valid private key (0x...)';
              }
              return true;
            }
          }
        ]);
        privateKey = answer.privateKey;
      }

      const wallet = new ethers.Wallet(privateKey);
      console.log(chalk.cyan(`\n🔐 Wallet: ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`));

      // Validate funds
      spinner.start('Checking wallet balance...');
      const provider = new ethers.JsonRpcProvider('https://rpc.gnosischain.com');
      const balance = await provider.getBalance(wallet.address);
      const required = ethers.parseEther('0.01');
      spinner.succeed();

      if (balance < required) {
        console.log(chalk.red(`❌ Insufficient funds:`));
        console.log(chalk.gray(`Balance: ${ethers.formatEther(balance)} ETH`));
        console.log(chalk.gray(`Required: 0.01 ETH`));
        console.log(chalk.red(`Shortfall: ${ethers.formatEther(required - balance)} ETH`));
        return;
      }

      console.log(chalk.green(`✅ Sufficient balance: ${ethers.formatEther(balance)} ETH`));

      // Confirm brain addition
      const confirmation = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: `Confirm adding ${modelConfig.name} brain for 0.01 ETH?`,
          default: true
        }
      ]);

      if (!confirmation.confirmed) {
        console.log(chalk.yellow('❌ Brain addition cancelled'));
        return;
      }

      // Add brain
      spinner.start('Installing brain...');
      const result = await brainAdder.addToAgent(agentId, {
        model: selectedModel as any,
        capabilities: modelConfig.capabilities,
        funding: {
          amount: '0.01',
          wallet: wallet.address
        }
      });
      
      spinner.succeed('Brain installed successfully!');

      // Display results
      console.log(chalk.green.bold('\n✅ Brain Addition Complete!'));
      console.log(chalk.cyan(`🧠 Model: ${result.model}`));
      console.log(chalk.cyan(`🎯 Capabilities: ${result.capabilities.join(', ')}`));
      console.log(chalk.cyan(`🔐 Safe: ${result.safeAddress.slice(0, 6)}...${result.safeAddress.slice(-4)}`));
      console.log(chalk.cyan(`🎭 TBA: ${result.tbaAddress.slice(0, 6)}...${result.tbaAddress.slice(-4)}`));
      console.log(chalk.cyan(`🆔 Brain ID: ${result.brainId}`));
      console.log(chalk.cyan(`📅 Activated: ${result.activationDate}`));
      
      console.log(chalk.blue('\n🎯 Next Steps:'));
      console.log(chalk.gray('• Your agent can now make autonomous decisions'));
      console.log(chalk.gray('• Configure brain behavior in agent settings'));
      console.log(chalk.gray('• Molt to sellable agent: npx ghostagent-molt'));
      console.log(chalk.gray('• Monitor brain activity in dashboard'));
      
      console.log(chalk.magenta('\n📚 Brain Documentation: https://docs.ghostagent.ninja/brain'));
      console.log(chalk.magenta('💬 Support: https://discord.gg/ghostagent'));

    } catch (error) {
      console.error(chalk.red('❌ Brain addition failed:'), error);
      process.exit(1);
    }
  });

program.parse();
