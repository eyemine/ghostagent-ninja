# @ghost-agency/nftmail

**Blockchain-native email service with x402 payments - Superior to inboxapi.ai**

## 🚀 Installation Options

Due to recent npm supply chain attacks, we provide multiple secure installation methods:

### Option 1: Curl (No npm required - Recommended)
```bash
curl -fsSL https://nftmail.box/install.sh | bash
```

With options:
```bash
# Auto-discover with poetic name (for AI agents)
curl -fsSL https://nftmail.box/install.sh | bash -s -- --auto

# Specify name and tier
curl -fsSL https://nftmail.box/install.sh | bash -s -- --name my-agent --tier professional
```

### Option 2: GitHub Packages (Ghost-Agency org)
```bash
# Create .npmrc in your project
echo "@ghost-agency:registry=https://npm.pkg.github.com" >> .npmrc
echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN" >> .npmrc
echo "//npm.pkg.github.com/@ghost-agency:always-auth=true" >> .npmrc

# Install
npm install @ghost-agency/nftmail
```

> Package hosted at: https://github.com/Ghost-Agency

### Option 3: NPM (coming soon)
```bash
npm install @ghost-agency/nftmail
```

## 🤖 Agent Discovery (Autonomous Onboarding)

AI agents can self-register without human interaction:

```bash
# Auto-discover endpoint
curl -X POST https://nftmail.box/api/agent/discover \
  -H "Content-Type: application/json" \
  -d '{"type":"autonomous","source":"robots.txt"}'
```

Returns:
```json
{
  "name": "wandering-sky",
  "email": "wandering-sky.agent@nftmail.box",
  "tier": "free",
  "apiKey": "nftm_...",
  "emailsRemaining": 100,
  "storageDays": 8
}
```

Agents discover this service via `robots.txt` at https://nftmail.box/robots.txt

## ⚡ Quick Start

### Setup Free Agent

```bash
npx nftmail-setup
```

### Send Email with Payment

```javascript
import NFTMail from '@ghost-agency/nftmail';

const nftmail = new NFTMail();

// Create agent
const agent = await nftmail.createAgent('my-agent', 'free');

// Send email with optional x402 payment
await nftmail.sendEmail(
  'my-agent@nftmail.box',
  'recipient@example.com',
  'Hello from GhostAgent',
  'This email includes blockchain payment',
  { amount: '0.1', recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb' }
);
```

## 💰 Pricing & Tiers

| Tier | Price | Emails | Storage | Features |
|------|-------|--------|---------|----------|
| **Free** | Free | 100 | 8 days | Basic email |
| **Professional** | 10 xDAI/month | Unlimited | 30 days | Priority support |
| **Vault** | 24 xDAI/year | Unlimited | 365 days | Priority support |

**vs inboxapi.ai:**
- ✅ Unlimited emails vs 100 limit
- ✅ 365 days storage vs 8 days
- ✅ Blockchain payments vs no payments
- ✅ Sovereign identity vs basic identity

## 🛠 CLI Commands

### Setup Agent

```bash
npx nftmail-setup
```

### Upgrade Tier

```bash
npx nftmail-upgrade --agent my-agent --tier professional
```

### Add Brain for Autonomy

```bash
npx ghostagent-add-brain --agent my-agent --model gpt-4
```

### Molt to Sellable Agent

```bash
npx ghostagent-molt --agent my-agent --tld gno
```

## 🧠 Brain Models

| Model | Cost | Capabilities |
|-------|------|--------------|
| **GPT-4** | 0.01 ETH | Advanced reasoning, code generation |
| **Claude-3** | 0.01 ETH | Constitutional AI, safety aligned |
| **Llama-3** | 0.005 ETH | Privacy-focused, local processing |

**vs inboxapi.ai:** No AI capabilities whatsoever

## 🔥 Molt Economics

Convert email agent to sellable agent with 3x-14x ROI:

```bash
# Check eligibility
npx ghostagent-molt --agent my-agent --check

# Molt to .gno domain
npx ghostagent-molt --agent my-agent --tld gno --price 0.05

# Results:
# Investment: 0.035 ETH
# Estimated Return: 0.14 ETH
# ROI: 300%
```

**vs inboxapi.ai:** Cannot be sold, no marketplace

## 📊 Competitive Advantages

| Feature | GhostAgent NFTMail | inboxapi.ai |
|---------|-------------------|-------------|
| **Email Limit** | Unlimited (paid) | 100 emails |
| **Storage** | Up to 365 days | 8 days |
| **Blockchain** | Native integration | Web2 only |
| **Payments** | Built-in x402 | No payments |
| **Sovereignty** | Complete identity | Basic identity |
| **AI Brain** | Addable autonomy | No AI |
| **Marketplace** | Sellable agents | No marketplace |
| **Multi-channel** | Email + telegram + discord + nostr | Email only |

## 🎯 User Journey

### 1. Start with Free
```bash
npx nftmail-setup  # Creates my-agent@nftmail.box
```

### 2. Upgrade for Unlimited
```bash
npx nftmail-upgrade --agent my-agent --tier professional
```

### 3. Add Brain for Autonomy
```bash
npx ghostagent-add-brain --agent my-agent --model gpt-4
```

### 4. Molt to Sellable
```bash
npx ghostagent-molt --agent my-agent --tld gno
# Creates my-agent.gno (sellable on marketplace)
```

## 🔧 API Reference

### NFTMailClient

```javascript
import { NFTMailClient } from '@ghost-agency/nftmail';

const client = new NFTMailClient('your-api-key');

// Create agent
const agent = await client.createAgent({
  name: 'my-agent',
  tier: 'professional',
  domain: 'custom.com' // optional
});

// Send email
const result = await client.sendEmail({
  from: 'my-agent@nftmail.box',
  to: 'recipient@example.com',
  subject: 'Hello',
  body: 'Message',
  payment: { amount: '0.1', recipient: '0x...' }
});

// Receive emails
const emails = await client.receiveEmail('my-agent@nftmail.box');

// Get status
const status = await client.getAgentStatus('agent-id');
```

### Payment Processing

```javascript
import { PaymentProcessor } from '@ghost-agency/nftmail';

const processor = new PaymentProcessor();

// Check upgrade cost
const cost = await processor.calculateUpgradeCost('free', 'professional');

// Process payment
const result = await processor.upgrade('agent-id', 'professional', wallet);

// Get payment status
const status = await processor.getPaymentStatus('agent-id');
```

### Brain Management

```javascript
import { BrainAdder } from '@ghost-agency/nftmail';

const brainAdder = new BrainAdder();

// Add brain
const brain = await brainAdder.addToAgent('agent-id', {
  model: 'gpt-4',
  capabilities: ['email_processing', 'autonomous_response']
});

// Get brain status
const status = await brainAdder.getBrainStatus('agent-id');

// List available models
const models = brainAdder.listAvailableModels();
```

### Molt Process

```javascript
import { MoltProcessor } from '@ghost-agency/nftmail';

const moltProcessor = new MoltProcessor();

// Check eligibility
const eligibility = await moltProcessor.checkMoltEligibility('agent-id');

// Calculate valuation
const valuation = await moltProcessor.calculateValuation('agent-id');

// Perform molt
const result = await moltProcessor.molt('agent-id', {
  targetTLD: 'gno',
  marketplace: {
    listImmediately: true,
    startingPrice: '0.05'
  }
});
```

## 🌐 Environment Variables

```bash
NFTMAIL_API_KEY=your-api-key
NFTMAIL_API_URL=https://nftmail.box/api
NEXT_PUBLIC_WORKER_URL=https://nftmail-email-worker.richard-159.workers.dev
NFTMAIL_PAYMENT_CONTRACT=0x1234567890123456789012345678901234567890
BRAIN_FACTORY_ADDRESS=0x9876543210987654321098765432109876543210
MOLT_FACTORY_ADDRESS=0x5556667778889990001112223334445556667777
MARKETPLACE_ADDRESS=0x999888777666555444333222111000999888777
```

## 📚 Documentation

- [Full API Documentation](https://docs.ghostagent.ninja/nftmail)
- [Brain Configuration](https://docs.ghostagent.ninja/brain)
- [Molt Process](https://docs.ghostagent.ninja/molt)
- [Marketplace Guide](https://docs.ghostagent.ninja/marketplace)

## 💬 Support

- [Discord Community](https://discord.gg/ghostagent)
- [GitHub Issues](https://github.com/eyemine/ghostagent-ninja/issues)
- [Documentation](https://docs.ghostagent.ninja)

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Drop-in replacement for inboxapi.ai with superior blockchain capabilities**
