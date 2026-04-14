import { NextResponse } from 'next/server';
import { mintCreationIP } from '../../lib/story-mint';

/// POST /api/provision-agent
/// Called after user mints [name].agent.gno on Gnosis and gets a TBA address.
/// Server-side: mints [name].creation.ip on Story L1 → same TBA
/// Email routing ([name]_@nftmail.box) is handled by the CF worker KV inbox (free tier).
/// Zoho mailbox provisioning is a paid tier upgrade.
///
/// Body: { agentName: string, tbaAddress: `0x${string}`, sld?: string, ownerWallet?: string }

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ghostagent.ninja';
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      agentName?: string;
      tbaAddress?: string;
      sld?: string;
      ownerWallet?: string;
    };
    const { agentName, tbaAddress, sld = 'agent', ownerWallet } = body;

    if (!agentName || typeof agentName !== 'string') {
      return NextResponse.json({ error: 'Missing agentName' }, { status: 400 });
    }
    if (!tbaAddress || !/^0x[a-fA-F0-9]{40}$/.test(tbaAddress)) {
      return NextResponse.json({ error: 'Invalid tbaAddress' }, { status: 400 });
    }

    // Mint [name].creation.ip on Story L1 (treasury wallet signs)
    const storyMint = await mintCreationIP(agentName, tbaAddress as `0x${string}`);

    // Free tier email: [name]_@nftmail.box is already routed by CF worker → KV inbox
    const email = `${agentName}_@nftmail.box`;

    // ── Basic email routing (larva tier) ───────────────────────────────────────
    // Sets up nftmailgno KV so email works at basic tier (10 sends, 8-day history)
    fetch(WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        action:    'registerSovereign',
        label:     agentName,
        controller: ownerWallet ?? tbaAddress,
        origin_nft:`${agentName}.${sld}.gno`,
        tld:       `${sld}.gno`,
        tier:      'basic',
        secret:    WEBHOOK_SECRET,
      }),
    }).catch(() => { /* non-fatal */ });

    // Note: ERC-8004 registration (agent brain) happens at PUPA molt upgrade

    return NextResponse.json({
      success: true,
      agentName,
      tbaAddress,
      storyMint,
      email,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
