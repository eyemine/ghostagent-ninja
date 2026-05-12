#!/usr/bin/env node

/**
 * NFTMail Upgrade CLI - npx nftmail-upgrade
 * Upgrade from free to paid tiers - inboxapi.ai has no upgrades
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { ethers } from 'ethers';
import { NFTMailClient } from './client';
import { PaymentProcessor, TIERS } from './payments';

const program = new Command();

program
  .name('nftmail-upgrade')
  .description('Upgrade GhostAgent NFTMail to paid tier')
  .version('1.0.0')
  .option('-a, --agent <id>', 'Agent ID to upgrade')
  .option('-t, --tier <tier>', 'Target tier (professional|vault)')
  .option('-w, --wallet <private-key>', 'Wallet private key for payment');

program
  .action(async (options) => {
    console.log(chalk.blue.bold('\n💰 GhostAgent NFTMail Upgrade'));
    console.log(chalk.gray('Unlock unlimited emails and extended storage\n'));

    try {
      const client = new NFTMailClient();
      const paymentProcessor = new PaymentProcessor();

      // Get agent ID if not provided
      let agentId = options.agent;
      if (!agentId) {
        const agents = await client.listAgents();
        if (agents.length === 0) {
          console.log(chalk.red('❌ No agents found. Run npx nftmail-setup first.'));
          return;
        }

        const answer = await inquirer.prompt([
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
      const spinner = ora('Fetching agent status...').start();
      const agent = await client.getAgentStatus(agentId);
      spinner.succeed();

      console.log(chalk.cyan(`\n📧 Current Agent: ${agent.name} (${agent.email})`));
      console.log(chalk.cyan(`📊 Current Tier: ${agent.tier}`));
      console.log(chalk.cyan(`📧 Emails Used: ${agent.emailsSent}/${agent.emailsRemaining === -1 ? 'Unlimited' : agent.emailsRemaining}`));
      console.log(chalk.cyan(`💾 Storage: ${agent.storageDays} days`));

      // Check if already upgraded
      if (agent.tier !== 'free') {
        console.log(chalk.yellow('\n⚠️  Agent is already on a paid tier'));
        
        const answer = await inquirer.prompt([
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
      let targetTier = options.tier as 'professional' | 'vault';
      if (!targetTier) {
        const answer = await inquirer.prompt([
          {
            type: 'list',
            name: 'tier',
            message: 'Select target tier:',
            choices: [
              {
                name: `💼 Professional - ${TIERS.professional.price} xDAI/month`,
                value: 'professional'
              },
              {
                name: `🏦 Vault - ${TIERS.vault.price} xDAI/year`,
                value: 'vault'
              }
            ]
          }
        ]);
        targetTier = answer.tier;
      }

      const targetConfig = TIERS[targetTier];

      // Show comparison with inboxapi.ai
      console.log(chalk.yellow('\n📊 Competitive Advantages over inboxapi.ai:'));
      console.log(chalk.gray('• Unlimited emails vs inboxapi.ai: 100 limit'));
      console.log(chalk.gray(`• ${targetConfig.features.storage} days storage vs inboxapi.ai: 8 days`));
      console.log(chalk.gray('• Blockchain payments vs inboxapi.ai: no payments'));
      console.log(chalk.gray('• Sovereign identity vs inboxapi.ai: basic identity\n'));

      // Calculate cost
      const cost = await paymentProcessor.calculateUpgradeCost(agent.tier, targetTier);
      console.log(chalk.blue(`💰 Pricing:`));
      console.log(chalk.gray(`Base Price: ${cost.basePrice} xDAI`));
      if (parseFloat(cost.discount) > 0) {
        console.log(chalk.green(`Discount: -${cost.discount} xDAI`));
        console.log(chalk.cyan(`Final Price: ${cost.finalPrice} xDAI`));
        console.log(chalk.green(`Savings: ${cost.savings} xDAI`));
      }

      // Get wallet information
      let privateKey = options.wallet;
      if (!privateKey) {
        const answer = await inquirer.prompt([
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

      const wallet = new ethers.Wallet(privateKey);
      console.log(chalk.cyan(`\n🔐 Wallet: ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`));

      // Validate funds
      spinner.start('Checking wallet balance...');
      const funds = await paymentProcessor.validateFunds(wallet.address, cost.finalPrice);
      spinner.succeed();

      if (!funds.sufficient) {
        console.log(chalk.red(`❌ Insufficient funds:`));
        console.log(chalk.gray(`Balance: ${funds.balance} xDAI`));
        console.log(chalk.gray(`Required: ${funds.required} xDAI`));
        console.log(chalk.red(`Shortfall: ${funds.shortfall} xDAI`));
        return;
      }

      console.log(chalk.green(`✅ Sufficient balance: ${funds.balance} xDAI`));

      // Confirm upgrade
      const confirmation = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: `Confirm upgrade to ${targetConfig.name} for ${cost.finalPrice} xDAI?`,
          default: true
        }
      ]);

      if (!confirmation.confirmed) {
        console.log(chalk.yellow('❌ Upgrade cancelled'));
        return;
      }

      // Process payment
      spinner.start('Processing payment...');
      const result = await paymentProcessor.upgrade(agentId, targetTier, wallet);
      
      if (result.success) {
        spinner.succeed('Payment processed successfully!');
        console.log(chalk.green(`📝 Transaction: ${result.txHash}`));
        console.log(chalk.cyan(`📅 New expiry: ${result.newExpiry}`));
        
        // Get updated status
        const updatedAgent = await client.getAgentStatus(agentId);
        console.log(chalk.green.bold('\n✅ Upgrade Complete!'));
        console.log(chalk.cyan(`📊 New Tier: ${updatedAgent.tier}`));
        console.log(chalk.cyan(`📧 Emails: Unlimited`));
        console.log(chalk.cyan(`💾 Storage: ${updatedAgent.storageDays} days`));
        
        console.log(chalk.blue('\n🎯 Next Steps:'));
        console.log(chalk.gray('• Enjoy unlimited email sending'));
        console.log(chalk.gray('• Add brain for autonomy: npx ghostagent-add-brain'));
        console.log(chalk.gray('• Molt to sellable agent: npx ghostagent-molt'));
        
      } else {
        spinner.fail('Payment failed');
        console.log(chalk.red('❌ Upgrade failed. Please check transaction and try again.'));
      }

    } catch (error) {
      console.error(chalk.red('❌ Upgrade failed:'), error);
      process.exit(1);
    }
  });

program.parse();
