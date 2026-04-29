#!/usr/bin/env node

/**
 * NFTMail Check CLI - npx nftmail check <name>
 * Fetch last 5 parsed emails and display in table format
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import Table from 'cli-table3';
import { ethers } from 'ethers';

const program = new Command();

export default async function checkCommand(name: string, options: { domain: string }) {
  const spinner = ora('Fetching inbox...').start();

  try {
    const workerUrl = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
    
    // Fetch inbox via worker
    const response = await axios.post(workerUrl, {
      action: 'getInbox',
      localPart: name,
      inboxDomain: options.domain === 'nftmail.box' ? 'nftmail' : options.domain
    });

    spinner.succeed('Inbox fetched');

    const messages = response.data?.messages || [];
    
    if (messages.length === 0) {
      console.log(chalk.yellow('\n📭 No emails yet'));
      console.log(chalk.gray(`Send an email to ${name}@${options.domain} to activate your inbox`));
      console.log(chalk.bold.cyan('\n🔮 YOUR FUTURE SOVEREIGNTY'));
      console.log(chalk.gray('  Predicted Gnosis Safe:'), chalk.yellow(calculateDeterministicSafe(name)));
      console.log(chalk.gray('  Status:'), chalk.red('LOCKED'));
      console.log(chalk.gray('  Unlock at: https://ghostagent.ninja/dashboard/molt'));
      return;
    }

    // Display last 5 emails in table format
    console.log(chalk.bold.cyan(`\n📧 Inbox: ${name}@${options.domain}`));
    console.log(chalk.gray(`Showing ${Math.min(messages.length, 5)} of ${messages.length} messages\n`));

    const table = new Table({
      head: [
        chalk.bold.white('From'),
        chalk.bold.white('Subject'),
        chalk.bold.white('Date'),
        chalk.bold.white('Status')
      ],
      colWidths: [30, 40, 20, 12],
      wordWrap: true
    });

    // Show last 5 messages
    const recentMessages = messages.slice(-5).reverse();
    
    recentMessages.forEach((msg: any) => {
      const from = msg.from || 'unknown';
      const subject = msg.subject || '(no subject)';
      const date = msg.timestamp ? new Date(msg.timestamp).toLocaleDateString() : 'N/A';
      const status = msg.read ? chalk.gray('read') : chalk.green('new');
      
      table.push([
        from.substring(0, 28),
        subject.substring(0, 38),
        date,
        status
      ]);
    });

    console.log(table.toString());

    // CLI Funnel
    console.log(chalk.bold.yellow('\n🚀 UPGRADE PATH'));
    console.log(chalk.gray('• Status: Glassbox (Free)'));
    console.log(chalk.gray('• Molt to Darkbox: https://ghostagent.ninja/dashboard/molt'));
    console.log(chalk.gray('• Unlock your Gnosis Safe: 0.1 xDAI'));

  } catch (error: any) {
    spinner.fail('Fetch failed');
    console.error(chalk.red('Error:'), error.response?.data?.error || error.message);
    process.exit(1);
  }
}

/**
 * Calculate deterministic Gnosis Safe address (same as create.ts)
 */
function calculateDeterministicSafe(name: string): string {
  const salt = ethers.id(`ghostagent-safe-${name}`);
  const hash = ethers.keccak256(ethers.solidityPacked(['string', 'bytes32'], [name, salt]));
  return ethers.getAddress(`0x${hash.slice(26)}`);
}

// Allow direct execution
if (require.main === module) {
  program
    .name('nftmail check')
    .description('Check inbox - fetch last 5 parsed emails')
    .version('1.0.0')
    .argument('<name>', 'Agent name')
    .option('--domain <domain>', 'Custom domain (default: nftmail.box)', 'nftmail.box')
    .action(checkCommand);
  
  program.parse();
}
