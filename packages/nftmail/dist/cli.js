#!/usr/bin/env node
"use strict";
/**
 * NFTMail CLI - Zero-auth quickstart with sovereignty hook
 * npx nftmail create <name> - 30-second inbox
 * npx nftmail check <name> - Fetch last 5 emails
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const create_1 = __importDefault(require("./create"));
const check_1 = __importDefault(require("./check"));
const program = new commander_1.Command();
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
    await (0, create_1.default)(name, options);
});
program
    .command('check <name>')
    .description('Check inbox - fetch last 5 parsed emails')
    .option('--domain <domain>', 'Custom domain (default: nftmail.box)', 'nftmail.box')
    .action(async (name, options) => {
    await (0, check_1.default)(name, options);
});
program.parse();
//# sourceMappingURL=cli.js.map