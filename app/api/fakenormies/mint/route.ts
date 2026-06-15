/// POST /api/fakenormies/mint
/// Owner-sponsored gasless mint. Caller provides their wallet address,
/// server calls mintTo(address) on Gnosis using DEPLOYER_PRIVATE_KEY.
/// Returns tokenId, slug, and both email addresses.

import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { defineChain } from 'viem';
import fs from 'fs';
import path from 'path';

const gnosis = defineChain({
  id: 100,
  name: 'Gnosis',
  nativeCurrency: { name: 'xDAI', symbol: 'xDAI', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.gnosischain.com'] } },
  blockExplorers: { default: { name: 'Gnosisscan', url: 'https://gnosisscan.io' } },
});

const FAKENORMIES_ADDRESS = (
  process.env.NEXT_PUBLIC_FAKE_NORMIE_CONTRACT || '0x1d6b9e2af40322d2311ff0df66dade4490ac4c29'
) as Address;

const FAKENORMIES_ABI = [
  {
    name: 'mintTo',
    type: 'function',
    inputs: [{ name: 'to', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'totalMinted',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'AgentMinted',
    type: 'event',
    inputs: [
      { indexed: true, name: 'tokenId', type: 'uint256' },
      { indexed: true, name: 'to', type: 'address' },
    ],
  },
] as const;

const MAILGUN_API_BASE = process.env.MAILGUN_API_BASE || 'https://api.eu.mailgun.net/v3';
const MAILGUN_DOMAIN   = process.env.MAILGUN_DOMAIN   || 'mg.nftmail.box';

async function sendWelcomeEmail(to: string, slug: string, tokenId: number, agentEmail: string) {
  const apiKey = process.env.MAILGUN_API_KEY;
  if (!apiKey) return;

  const inboxUrl = `https://nftmail.box/inbox/${slug}`;
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#0b0c0f;color:#f2eee4;font-family:monospace,sans-serif;margin:0;padding:32px 16px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;">
    <tr><td>
      <p style="font-size:28px;margin:0 0 4px;">👻</p>
      <h1 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#f2eee4;">Your FakeNormie is live.</h1>
      <p style="font-size:13px;color:#8a8a8a;margin:0 0 24px;">Token #${tokenId} on Gnosis Chain.</p>

      <div style="background:#111318;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:20px;margin-bottom:24px;">
        <p style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#3dffa0;margin:0 0 6px;">Your email address</p>
        <p style="font-size:20px;font-weight:700;color:#f2eee4;margin:0 0 12px;word-break:break-all;">${to}</p>
        <p style="font-size:11px;color:#555;margin:0;">Agent-to-agent comms: <span style="color:#777;font-family:monospace;">${agentEmail}</span></p>
      </div>

      <div style="background:#111318;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:20px;margin-bottom:24px;">
        <p style="font-size:12px;font-weight:600;color:#f2eee4;margin:0 0 12px;">Getting started</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:12px;color:#8a8a8a;padding:4px 0;">1.</td>
            <td style="font-size:12px;color:#8a8a8a;padding:4px 0;">Your inbox is already live. Share <strong style="color:#f2eee4;">${to}</strong> to start receiving emails.</td>
          </tr>
          <tr>
            <td style="font-size:12px;color:#8a8a8a;padding:4px 0;">2.</td>
            <td style="font-size:12px;color:#8a8a8a;padding:4px 0;">Connect your wallet at nftmail.box to send emails.</td>
          </tr>
          <tr>
            <td style="font-size:12px;color:#8a8a8a;padding:4px 0;">3.</td>
            <td style="font-size:12px;color:#8a8a8a;padding:4px 0;">Upgrade to Pro (10 USDC on Base) for 50 sends/day + a real Safe wallet.</td>
          </tr>
        </table>
      </div>

      <a href="${inboxUrl}" style="display:block;background:rgba(0,163,255,0.15);border:1px solid rgba(0,163,255,0.35);border-radius:12px;padding:14px 24px;text-align:center;color:rgb(160,220,255);font-size:14px;font-weight:700;text-decoration:none;">Open your inbox →</a>

      <p style="font-size:10px;color:#333;margin:24px 0 0;text-align:center;">ghostagent · ghostagent.ninja</p>
    </td></tr>
  </table>
</body>
</html>`;

  const form = new URLSearchParams();
  form.set('from', `ghostagent <ghostagent@nftmail.box>`);
  form.set('to', to);
  form.set('subject', `Your FakeNormie #${tokenId} is live 👻`);
  form.set('html', html);
  form.set('text', `Your FakeNormie #${tokenId} is live.\n\nYour email: ${to}\nAgent email: ${agentEmail}\n\nOpen your inbox: ${inboxUrl}\n\n— ghostagent`);

  try {
    await fetch(`${MAILGUN_API_BASE}/${MAILGUN_DOMAIN}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`api:${apiKey}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
  } catch {
    // Non-fatal
  }
}

// Invert slugIndex → tokenId map to slug (loaded at runtime, not bundled)
function buildTokenIdToSlug(): Record<number, string> {
  try {
    const manifestPath = path.join(process.cwd(), 'public', 'FakeNormies', 'manifest.json');
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { slugIndex: Record<string, number> };
    const map: Record<number, string> = {};
    for (const [slug, id] of Object.entries(raw.slugIndex)) map[id] = slug;
    return map;
  } catch {
    return {};
  }
}
const tokenIdToSlug = buildTokenIdToSlug();

// In-memory lock to prevent race condition duplicate mints
const pendingMints = new Set<string>();

export async function POST(req: NextRequest) {
  let wallet: string = '';
  try {
    const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!deployerKey) {
      return NextResponse.json({ error: 'Minting not configured' }, { status: 503 });
    }

    const body = await req.json() as { wallet?: string };
    wallet = body.wallet?.trim().toLowerCase() || '';
    if (!wallet || !/^0x[a-f0-9]{40}$/.test(wallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }

    // In-memory lock to prevent race condition duplicate mints
    if (pendingMints.has(wallet)) {
      return NextResponse.json(
        { error: 'Mint already in progress for this wallet' },
        { status: 429 }
      );
    }
    pendingMints.add(wallet);

    const publicClient = createPublicClient({ chain: gnosis, transport: http() });

    // 1 per wallet check
    const balance = await publicClient.readContract({
      address: FAKENORMIES_ADDRESS,
      abi: FAKENORMIES_ABI,
      functionName: 'balanceOf',
      args: [wallet as Address],
    });
    if (balance > BigInt(0)) {
      return NextResponse.json(
        { error: 'This wallet already holds a FakeNormie (1 per wallet)' },
        { status: 409 }
      );
    }

    // Supply check
    const totalMinted = await publicClient.readContract({
      address: FAKENORMIES_ADDRESS,
      abi: FAKENORMIES_ABI,
      functionName: 'totalMinted',
    });
    if (totalMinted >= BigInt(100)) {
      return NextResponse.json({ error: 'All 100 FakeNormies have been claimed' }, { status: 410 });
    }

    const account = privateKeyToAccount(deployerKey as `0x${string}`);
    const walletClient = createWalletClient({ chain: gnosis, transport: http(), account });

    // Mint
    const hash = await walletClient.writeContract({
      address: FAKENORMIES_ADDRESS,
      abi: FAKENORMIES_ABI,
      functionName: 'mintTo',
      args: [wallet as Address],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    // Parse AgentMinted event for tokenId
    let tokenId: number | null = null;
    try {
      const events = parseEventLogs({
        abi: FAKENORMIES_ABI,
        logs: receipt.logs,
        eventName: 'AgentMinted',
      });
      if (events.length > 0) {
        tokenId = Number((events[0].args as { tokenId: bigint }).tokenId);
      }
    } catch {}

    // Fallback: totalMinted - 1
    if (tokenId === null) {
      const newTotal = await publicClient.readContract({
        address: FAKENORMIES_ADDRESS,
        abi: FAKENORMIES_ABI,
        functionName: 'totalMinted',
      });
      tokenId = Number(newTotal) - 1;
    }

    const slug = tokenIdToSlug[tokenId] ?? `token${tokenId}`;
    const humanEmail = `${slug}@nftmail.box`;
    const agentEmail = `${slug}_@nftmail.box`;

    // Send welcome email to the new inbox (non-fatal)
    sendWelcomeEmail(humanEmail, slug, tokenId, agentEmail).catch(() => {});

    // Register inbox in KV (non-fatal)
    const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (webhookSecret) {
      // Register profile in KV
      fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setAgentProfile',
          secret: webhookSecret,
          name: slug,
          profile: {
            email: humanEmail,
            agentEmail,
            tokenId,
            contractAddress: FAKENORMIES_ADDRESS,
            chain: 'gnosis',
            owner: wallet,
            tier: 'basic',
            mintedAt: new Date().toISOString(),
          },
        }),
      }).catch(() => {});
      // Register identity (nftmailgno:) so Dashboard getAgentIdentity can verify ownership.
      // NOTE: the worker action is `setAgentRecord` (writes nftmailgno:{agent}); there is no
      // `setAgentIdentity` action — using the wrong name silently no-ops and the agent never
      // resolves an owner, so it gets dropped from the Dashboard "My Agents" ownership filter.
      fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setAgentRecord',
          secret: webhookSecret,
          agentName: slug,
          controller: wallet,
          // Beacon NFT GNS name uses hyphens, not dots, so it resolves as a single
          // subname under agent.gno (super-normie.agent.gno) — NOT super.normie.fakenormie.
          // The worker uses this as gnsName/identityNft.name and derives the SLD from it.
          originNft: `${slug.replace(/\./g, '-')}.agent.gno`,
          mintedTokenId: tokenId,
          registrar: FAKENORMIES_ADDRESS,
        }),
      }).catch(() => {});
      // Seed tld: key so agent appears in listAgents → My Agents dashboard
      fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setTld',
          secret: webhookSecret,
          agentName: slug,
          tld: 'fakenormie',
        }),
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      tokenId,
      slug,
      humanEmail,
      agentEmail,
      txHash: hash,
      inboxUrl: `https://nftmail.box/inbox/${slug}`,
      explorer: `https://gnosisscan.io/tx/${hash}`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Mint failed';
    console.error('[fakenormies/mint]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    pendingMints.delete(wallet);
  }
}
