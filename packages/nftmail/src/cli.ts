#!/usr/bin/env node

/**
 * NFTMail CLI - Zero-auth quickstart with sovereignty hook
 * npx nftmail create <name> - 30-second inbox
 * npx nftmail check <name> - Fetch last 5 emails
 */

import { Command } from 'commander';
import chalk from 'chalk';
import createCommand from './create';
import checkCommand from './check';

const program = new Command();

program
  .name('nftmail')
  .description('Blockchain-native email service - zero-auth quickstart')
  .version('1.0.0');

// Import subcommands
program
  .command('create <name>')
  .description('Create agent with sovereignty hook (30-second inbox)')
  .option('--domain <domain>', 'Custom domain (default: nftmail.box)', 'nftmail.box')
  .action(async (name, options) => {
    await createCommand(name, options);
  });

program
  .command('check <name>')
  .description('Check inbox - fetch last 5 parsed emails')
  .option('--domain <domain>', 'Custom domain (default: nftmail.box)', 'nftmail.box')
  .action(async (name, options) => {
    await checkCommand(name, options);
  });

program.parse();
