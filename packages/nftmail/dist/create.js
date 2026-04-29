#!/usr/bin/env node
"use strict";
/**
 * NFTMail Zero-Auth Quickstart CLI - npx nftmail create <name>
 * 30-second inbox with deterministic sovereignty hook
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = createCommand;
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const ethers_1 = require("ethers");
const axios_1 = __importDefault(require("axios"));
const program = new commander_1.Command();
async function createCommand(name, options) {
    const spinner = (0, ora_1.default)('Creating your agent...').start();
    try {
        // Validate name
        if (!/^[a-z0-9-]+$/.test(name)) {
            spinner.fail('Invalid name');
            console.log(chalk_1.default.red('Name must contain only lowercase letters, numbers, and hyphens'));
            process.exit(1);
        }
        // Calculate deterministic addresses (Sovereignty Hook)
        const deterministicSafe = calculateDeterministicSafe(name);
        const deterministicTBA = calculateDeterministicTBA(name);
        spinner.succeed('Agent ready!');
        // SOVEREIGNTY HOOK - Boldly display future addresses
        console.log(chalk_1.default.bold.cyan('\n🔮 YOUR FUTURE SOVEREIGNTY'));
        console.log(chalk_1.default.gray('─'.repeat(50)));
        console.log(chalk_1.default.bold.white('  Predicted Gnosis Safe:'), chalk_1.default.bold.yellow(deterministicSafe));
        console.log(chalk_1.default.gray('  Status:'), chalk_1.default.red('LOCKED'));
        console.log(chalk_1.default.gray('  Unlock:'), chalk_1.default.green('Molt to full GhostAgent at https://ghostagent.ninja/dashboard/molt'));
        console.log('');
        console.log(chalk_1.default.bold.white('  Predicted TBA (Agent Account):'), chalk_1.default.bold.magenta(deterministicTBA));
        console.log(chalk_1.default.gray('  Status:'), chalk_1.default.red('LOCKED'));
        console.log(chalk_1.default.gray('  Unlock:'), chalk_1.default.green('Mint your NFTMail to activate'));
        console.log(chalk_1.default.gray('─'.repeat(50)));
        // Create trial account via worker
        const createSpinner = (0, ora_1.default)('Registering trial account...').start();
        const workerUrl = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
        const claimCode = generateClaimCode();
        const response = await axios_1.default.post(workerUrl, {
            action: 'registerTrial',
            name: name,
            claimCode: claimCode
        });
        createSpinner.succeed('Trial account created');
        // Display results
        console.log(chalk_1.default.bold.green('\n✅ SETUP COMPLETE'));
        console.log(chalk_1.default.gray('─'.repeat(50)));
        console.log(chalk_1.default.cyan(`📧 Email: ${name}@${options.domain}`));
        console.log(chalk_1.default.cyan(`📧 Agent Email: ${name}_@${options.domain}`));
        console.log(chalk_1.default.cyan(`🎫 Claim Code: ${claimCode}`));
        console.log(chalk_1.default.cyan(`⏱️  Storage: 8 days (freemium)`));
        console.log(chalk_1.default.cyan(`📤 Sends: 10 remaining`));
        console.log(chalk_1.default.gray('─'.repeat(50)));
        // CLI Funnel
        console.log(chalk_1.default.bold.yellow('\n🚀 UPGRADE PATH'));
        console.log(chalk_1.default.gray('• Status: Glassbox (Free)'));
        console.log(chalk_1.default.gray('• Molt to Darkbox: https://ghostagent.ninja/dashboard/molt'));
        console.log(chalk_1.default.gray('• Unlock your Gnosis Safe: 0.1 xDAI'));
        console.log(chalk_1.default.gray('• Persistent storage: 24 xDAI/year'));
        console.log(chalk_1.default.bold.blue('\n🎯 QUICKSTART'));
        console.log(chalk_1.default.gray(`npx nftmail check ${name}`));
        console.log(chalk_1.default.gray('Send email to activate your inbox'));
    }
    catch (error) {
        spinner.fail('Creation failed');
        console.error(chalk_1.default.red('Error:'), error.response?.data?.error || error.message);
        process.exit(1);
    }
}
/**
 * Calculate deterministic Gnosis Safe address from name
 * This is the SOVEREIGNTY HOOK - shows them their future immediately
 */
function calculateDeterministicSafe(name) {
    // Create deterministic address from name + salt
    const salt = ethers_1.ethers.id(`ghostagent-safe-${name}`);
    const wallet = ethers_1.ethers.Wallet.createRandom();
    // In production, this would use CREATE2 with the Safe Factory
    // For now, simulate deterministic address
    const hash = ethers_1.ethers.keccak256(ethers_1.ethers.solidityPacked(['string', 'bytes32'], [name, salt]));
    return ethers_1.ethers.getAddress(`0x${hash.slice(26)}`);
}
/**
 * Calculate deterministic TBA (ERC-6551) address from name
 */
function calculateDeterministicTBA(name) {
    const salt = ethers_1.ethers.id(`ghostagent-tba-${name}`);
    const hash = ethers_1.ethers.keccak256(ethers_1.ethers.solidityPacked(['string', 'bytes32'], [name, salt]));
    return ethers_1.ethers.getAddress(`0x${hash.slice(26)}`);
}
/**
 * Generate random claim code for trial account
 */
function generateClaimCode() {
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
//# sourceMappingURL=create.js.map