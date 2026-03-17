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

    // ── ERC-8004 registration — fire-and-forget on all three chains ──
    const erc8004Owner = ownerWallet ?? tbaAddress;
    const erc8004Body = { agentName, sld, ownerWallet: erc8004Owner };
    // Gnosis mainnet (chainId 100) — primary identity
    fetch(`${APP_URL}/api/erc8004/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(erc8004Body),
    }).catch(() => { /* non-fatal */ });
    // Base mainnet (chainId 8453) — Synthesis hackathon
    fetch(`${APP_URL}/api/erc8004/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...erc8004Body, network: 'base' }),
    }).catch(() => { /* non-fatal */ });
    // Base Sepolia (chainId 84532) — Trustless Agents hackathon / trading competition
    fetch(`${APP_URL}/api/erc8004/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...erc8004Body, network: 'baseSepolia' }),
    }).catch(() => { /* non-fatal */ });

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
