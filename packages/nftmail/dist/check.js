#!/usr/bin/env node
"use strict";
/**
 * NFTMail Check CLI - npx nftmail check <name>
 * Fetch last 5 parsed emails and display in table format
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = checkCommand;
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const axios_1 = __importDefault(require("axios"));
const cli_table3_1 = __importDefault(require("cli-table3"));
const ethers_1 = require("ethers");
const program = new commander_1.Command();
async function checkCommand(name, options) {
    const spinner = (0, ora_1.default)('Fetching inbox...').start();
    try {
        const workerUrl = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
        // Fetch inbox via worker
        const response = await axios_1.default.post(workerUrl, {
            action: 'getInbox',
            localPart: name,
            inboxDomain: options.domain === 'nftmail.box' ? 'nftmail' : options.domain
        });
        spinner.succeed('Inbox fetched');
        const messages = response.data?.messages || [];
        if (messages.length === 0) {
            console.log(chalk_1.default.yellow('\n📭 No emails yet'));
            console.log(chalk_1.default.gray(`Send an email to ${name}@${options.domain} to activate your inbox`));
            console.log(chalk_1.default.bold.cyan('\n🔮 YOUR FUTURE SOVEREIGNTY'));
            console.log(chalk_1.default.gray('  Predicted Gnosis Safe:'), chalk_1.default.yellow(calculateDeterministicSafe(name)));
            console.log(chalk_1.default.gray('  Status:'), chalk_1.default.red('LOCKED'));
            console.log(chalk_1.default.gray('  Unlock at: https://ghostagent.ninja/dashboard/molt'));
            return;
        }
        // Display last 5 emails in table format
        console.log(chalk_1.default.bold.cyan(`\n📧 Inbox: ${name}@${options.domain}`));
        console.log(chalk_1.default.gray(`Showing ${Math.min(messages.length, 5)} of ${messages.length} messages\n`));
        const table = new cli_table3_1.default({
            head: [
                chalk_1.default.bold.white('From'),
                chalk_1.default.bold.white('Subject'),
                chalk_1.default.bold.white('Date'),
                chalk_1.default.bold.white('Status')
            ],
            colWidths: [30, 40, 20, 12],
            wordWrap: true
        });
        // Show last 5 messages
        const recentMessages = messages.slice(-5).reverse();
        recentMessages.forEach((msg) => {
            const from = msg.from || 'unknown';
            const subject = msg.subject || '(no subject)';
            const date = msg.timestamp ? new Date(msg.timestamp).toLocaleDateString() : 'N/A';
            const status = msg.read ? chalk_1.default.gray('read') : chalk_1.default.green('new');
            table.push([
                from.substring(0, 28),
                subject.substring(0, 38),
                date,
                status
            ]);
        });
        console.log(table.toString());
        // CLI Funnel
        console.log(chalk_1.default.bold.yellow('\n🚀 UPGRADE PATH'));
        console.log(chalk_1.default.gray('• Status: Glassbox (Free)'));
        console.log(chalk_1.default.gray('• Molt to Darkbox: https://ghostagent.ninja/dashboard/molt'));
        console.log(chalk_1.default.gray('• Unlock your Gnosis Safe: 0.1 xDAI'));
    }
    catch (error) {
        spinner.fail('Fetch failed');
        console.error(chalk_1.default.red('Error:'), error.response?.data?.error || error.message);
        process.exit(1);
    }
}
/**
 * Calculate deterministic Gnosis Safe address (same as create.ts)
 */
function calculateDeterministicSafe(name) {
    const salt = ethers_1.ethers.id(`ghostagent-safe-${name}`);
    const hash = ethers_1.ethers.keccak256(ethers_1.ethers.solidityPacked(['string', 'bytes32'], [name, salt]));
    return ethers_1.ethers.getAddress(`0x${hash.slice(26)}`);
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
//# sourceMappingURL=check.js.map