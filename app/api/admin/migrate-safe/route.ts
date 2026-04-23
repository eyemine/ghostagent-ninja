/// API Route: Migrate existing BYO NFT molts to Safe-first architecture
/// POST /api/admin/migrate-safe
///
/// Retroactively creates Safes for existing BYO NFT molts that were created
/// before the Safe-first architecture. This ensures:
///   1. BYO NFT (beacon) stays in principal wallet (key)
///   2. Safe is created as vessel for the agent
///   3. BYO NFT is registered as governor of Safe in GhostRegistry (Gnosis only)
///   4. Safe address is stored in KV for display
///
/// Note: BYO governor registration only works for NFTs on Gnosis (chainId 100).
/// For cross-chain NFTs (Base, Ethereum, etc.), skip governor registration.
///
/// Body: { secret, entries: [{ agentName, ownerWallet, nftType, tokenId, nftContract?, chainId? }] }

import { NextRequest, NextResponse } from 'next/server';
import { createSafeForByoMolt } from '../../../services/create-safe';
import { WORKER_URL } from '../../../utils/config';

const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET;
const GNOSIS_CHAIN_ID = 100;

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    secret?: string;
    entries?: Array<{
      agentName: string;
      ownerWallet: string;
      nftType: string;
      tokenId: string;
      nftContract?: string;
      chainId?: number;  // Optional: if not provided, assume Gnosis
    }>;
  };

  if (!body.secret || body.secret !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!body.entries || body.entries.length === 0) {
    return NextResponse.json({ error: 'No entries provided' }, { status: 400 });
  }

  const treasuryKey = process.env.TREASURY_PRIVATE_KEY;
  if (!treasuryKey) {
    return NextResponse.json({ error: 'Treasury key not configured' }, { status: 503 });
  }

  const results: Array<{ agentName: string; success: boolean; safeAddress?: string; error?: string }> = [];

  for (const entry of body.entries) {
    const { agentName, ownerWallet, nftType, tokenId, nftContract, chainId = GNOSIS_CHAIN_ID } = entry;

    try {
      // Step 1: Create Safe for the agent
      const safeResult = await createSafeForByoMolt(agentName, ownerWallet, treasuryKey);

      if (!safeResult.safeAddress) {
        results.push({
          agentName,
          success: false,
          error: safeResult.error ?? 'Safe creation failed',
        });
        continue;
      }

      const safeAddress = safeResult.safeAddress;

      // Step 2: Store Safe address in KV
      try {
        await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'setAcctTier',
            localPart: agentName,
            tld: 'agent.gno',
            tier: 'pupa',
            safe: safeAddress,
          }),
        });
      } catch (kvErr) {
        console.error(`Failed to store Safe address in KV for ${agentName}:`, kvErr);
        // Non-fatal, continue
      }

      // Step 3: Register BYO NFT as governor of Safe in GhostRegistry v2 (Gnosis only)
      // Skip for cross-chain NFTs (Base, Ethereum, etc.)
      if (nftContract && chainId === GNOSIS_CHAIN_ID) {
        try {
          const { createWalletClient, http, encodeFunctionData, Address } = await import('viem');
          const { privateKeyToAccount } = await import('viem/accounts');
          const { gnosis } = await import('viem/chains');

          const ghostRegistry = '0x194f200b2C624e27a14865292d1C50cF46211565'; // GhostRegistry v2
          const account = privateKeyToAccount(treasuryKey as `0x${string}`);
          const walletClient = createWalletClient({ chain: gnosis, transport: http(), account });

          await walletClient.writeContract({
            address: ghostRegistry as Address,
            abi: [{
              name: 'registerByoGovernor',
              type: 'function',
              inputs: [
                { name: 'byoContract', type: 'address' },
                { name: 'byoTokenId', type: 'uint256' },
                { name: 'safe', type: 'address' },
              ],
              outputs: [],
              stateMutability: 'nonpayable',
            }],
            functionName: 'registerByoGovernor',
            args: [nftContract as Address, BigInt(tokenId), safeAddress as Address],
          });

          console.log(`BYO NFT ${nftContract}#${tokenId} registered as governor of Safe ${safeAddress}`);
        } catch (regErr) {
          console.error(`Failed to register BYO governor for ${agentName}:`, regErr);
          // Non-fatal, continue
        }
      } else if (nftContract && chainId !== GNOSIS_CHAIN_ID) {
        console.log(`Skipping BYO governor registration for ${agentName}: NFT is on chain ${chainId}, not Gnosis (100)`);
      }

      results.push({
        agentName,
        success: true,
        safeAddress,
      });
    } catch (err: any) {
      results.push({
        agentName,
        success: false,
        error: err?.message ?? 'Migration failed',
      });
    }
  }

  return NextResponse.json({
    total: results.length,
    succeeded: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  });
}
