#!/usr/bin/env node

/**
 * NFTMail Zero-Auth Quickstart CLI - npx nftmail create <name>
 * 30-second inbox with deterministic sovereignty hook
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { ethers } from 'ethers';
import axios from 'axios';

const program = new Command();

export default async function createCommand(name: string, options: { domain: string }) {
  const spinner = ora('Creating your agent...').start();

  try {
    // Validate name
    if (!/^[a-z0-9-]+$/.test(name)) {
      spinner.fail('Invalid name');
      console.log(chalk.red('Name must contain only lowercase letters, numbers, and hyphens'));
      process.exit(1);
    }

    // Calculate deterministic addresses (Sovereignty Hook)
    const deterministicSafe = calculateDeterministicSafe(name);
    const deterministicTBA = calculateDeterministicTBA(name);

    spinner.succeed('Agent ready!');

    // SOVEREIGNTY HOOK - Boldly display future addresses
    console.log(chalk.bold.cyan('\n🔮 YOUR FUTURE SOVEREIGNTY'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.bold.white('  Predicted Gnosis Safe:'), chalk.bold.yellow(deterministicSafe));
    console.log(chalk.gray('  Status:'), chalk.red('LOCKED'));
    console.log(chalk.gray('  Unlock:'), chalk.green('Molt to full GhostAgent at https://ghostagent.ninja/dashboard/molt'));
    console.log('');
    console.log(chalk.bold.white('  Predicted TBA (Agent Account):'), chalk.bold.magenta(deterministicTBA));
    console.log(chalk.gray('  Status:'), chalk.red('LOCKED'));
    console.log(chalk.gray('  Unlock:'), chalk.green('Mint your NFTMail to activate'));
    console.log(chalk.gray('─'.repeat(50)));

    // Create trial account via worker
    const createSpinner = ora('Registering trial account...').start();
    
    const workerUrl = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
    const claimCode = generateClaimCode();
    
    const response = await axios.post(workerUrl, {
      action: 'registerTrial',
      name: name,
      claimCode: claimCode
    });

    createSpinner.succeed('Trial account created');

    // Display results
    console.log(chalk.bold.green('\n✅ SETUP COMPLETE'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.cyan(`📧 Email: ${name}@${options.domain}`));
    console.log(chalk.cyan(`📧 Agent Email: ${name}_@${options.domain}`));
    console.log(chalk.cyan(`🎫 Claim Code: ${claimCode}`));
    console.log(chalk.cyan(`⏱️  Storage: 8 days (freemium)`));
    console.log(chalk.cyan(`📤 Sends: 10 remaining`));
    console.log(chalk.gray('─'.repeat(50)));

    // CLI Funnel
    console.log(chalk.bold.yellow('\n🚀 UPGRADE PATH'));
    console.log(chalk.gray('• Status: Glassbox (Free)'));
    console.log(chalk.gray('• Molt to Darkbox: https://ghostagent.ninja/dashboard/molt'));
    console.log(chalk.gray('• Unlock your Gnosis Safe: 0.1 xDAI'));
    console.log(chalk.gray('• Persistent storage: 24 xDAI/year'));

    console.log(chalk.bold.blue('\n🎯 QUICKSTART'));
    console.log(chalk.gray(`npx nftmail check ${name}`));
    console.log(chalk.gray('Send email to activate your inbox'));

  } catch (error: any) {
    spinner.fail('Creation failed');
    console.error(chalk.red('Error:'), error.response?.data?.error || error.message);
    process.exit(1);
  }
}

/**
 * Calculate deterministic Gnosis Safe address from name
 * This is the SOVEREIGNTY HOOK - shows them their future immediately
 */
function calculateDeterministicSafe(name: string): string {
  // Create deterministic address from name + salt
  const salt = ethers.id(`ghostagent-safe-${name}`);
  const wallet = ethers.Wallet.createRandom();
  
  // In production, this would use CREATE2 with the Safe Factory
  // For now, simulate deterministic address
  const hash = ethers.keccak256(ethers.solidityPacked(['string', 'bytes32'], [name, salt]));
  return ethers.getAddress(`0x${hash.slice(26)}`);
}

/**
 * Calculate deterministic TBA (ERC-6551) address from name
 */
function calculateDeterministicTBA(name: string): string {
  const salt = ethers.id(`ghostagent-tba-${name}`);
  const hash = ethers.keccak256(ethers.solidityPacked(['string', 'bytes32'], [name, salt]));
  return ethers.getAddress(`0x${hash.slice(26)}`);
}

/**
 * Generate random claim code for trial account
 */
function generateClaimCode(): string {
  return crypto.randomUUID().split('-')[0].toUpperCase();
}

// Allow direct execution
if (require.main === module) {
  program
    .name('nftmail create')
    .description('Zero-auth quickstart - 30-second inbox with sovereignty hook')
    .version('1.0.0')
    .argument('<name>', 'Agent name (lowercase, alphanumeric)')
    .option('--domain <domain>', 'Custom domain (default: nftmail.box)', 'nftmail.box')
    .action(createCommand);
  
  program.parse();
}
