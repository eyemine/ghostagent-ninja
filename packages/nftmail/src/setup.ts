#!/usr/bin/env node

/**
 * NFTMail Setup CLI - npx nftmail-setup
 * Creates free email agent - superior to inboxapi.ai setup
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { NFTMailClient } from './client';

const program = new Command();

program
  .name('nftmail-setup')
  .description('Setup GhostAgent NFTMail - blockchain-native email service')
  .version('1.0.0');

program
  .action(async () => {
    console.log(chalk.blue.bold('\n🚀 GhostAgent NFTMail Setup'));
    console.log(chalk.gray('Blockchain-native email service - superior to inboxapi.ai\n'));

    try {
      // Get user information
      const answers = await inquirer.prompt([
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
              name: '🆓 Free - 100 emails, 8-day storage (vs inboxapi.ai: 100 emails, 8 days)',
              value: 'free'
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
          default: 'free'
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
      console.log(chalk.yellow('\n📊 Competitive Advantages over inboxapi.ai:'));
      console.log(chalk.gray('• Blockchain-native vs Web2 only'));
      console.log(chalk.gray('• Built-in x402 payments vs no payments'));
      console.log(chalk.gray('• Complete sovereignty vs basic identity'));
      console.log(chalk.gray('• Multi-channel vs email only'));
      console.log(chalk.gray('• Upgrade path vs no upgrades\n'));

      // Create agent
      const spinner = ora('Creating your email agent...').start();
      const client = new NFTMailClient();
      
      const agent = await client.createAgent({
        name: answers.name,
        tier: answers.tier,
        domain: answers.customDomain ? answers.domain : undefined
      });

      spinner.succeed('Email agent created successfully!');

      // Display results
      console.log(chalk.green.bold('\n✅ Setup Complete!'));
      console.log(chalk.cyan(`\n📧 Email Address: ${agent.email}`));
      console.log(chalk.cyan(`🏷️  Agent ID: ${agent.id}`));
      console.log(chalk.cyan(`📊 Tier: ${agent.tier}`));
      console.log(chalk.cyan(`📧 Emails Remaining: ${agent.emailsRemaining}`));
      console.log(chalk.cyan(`💾 Storage: ${agent.storageDays} days`));
      
      if (agent.safeAddress) {
        console.log(chalk.cyan(`🔐 Safe Address: ${agent.safeAddress.slice(0, 6)}...${agent.safeAddress.slice(-4)}`));
      }
      
      if (agent.tbaAddress) {
        console.log(chalk.cyan(`🎭 TBA Address: ${agent.tbaAddress.slice(0, 6)}...${agent.tbaAddress.slice(-4)}`));
      }

      // Show upgrade triggers
      if (answers.tier === 'free') {
        console.log(chalk.yellow('\n🔄 Upgrade Triggers:'));
        console.log(chalk.gray('• At 80 emails used'));
        console.log(chalk.gray('• At 8 days storage limit'));
        console.log(chalk.gray('• Run: npx nftmail-upgrade'));
      }

      // Show next steps
      console.log(chalk.blue('\n🎯 Next Steps:'));
      console.log(chalk.gray('• Send emails using the NFTMail SDK'));
      console.log(chalk.gray('• Add brain for autonomy: npx ghostagent-add-brain'));
      console.log(chalk.gray('• Molt to sellable agent: npx ghostagent-molt'));
      
      console.log(chalk.magenta('\n📚 Documentation: https://docs.ghostagent.ninja/nftmail'));
      console.log(chalk.magenta('💬 Support: https://discord.gg/ghostagent'));

    } catch (error) {
      console.error(chalk.red('❌ Setup failed:'), error);
      process.exit(1);
    }
  });

program.parse();
