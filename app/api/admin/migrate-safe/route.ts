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
/// Note: BYO governor registration works for NFTs on Gnosis (chainId 100).
/// For cross-chain NFTs (Base, Ethereum, etc.), we add the TBA (ERC-6551) as Safe owner instead.
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
            tier: 'lite',
            safe: safeAddress,
          }),
        });
      } catch (kvErr) {
        console.error(`Failed to store Safe address in KV for ${agentName}:`, kvErr);
        // Non-fatal, continue
      }

      // Step 3: Register BYO NFT as governor of Safe in GhostRegistry v2 (Gnosis only)
      // For cross-chain NFTs, add TBA as Safe owner instead
      if (nftContract) {
        try {
          const { createWalletClient, http, encodeFunctionData, createPublicClient } = await import('viem');
          const { privateKeyToAccount } = await import('viem/accounts');
          const { gnosis } = await import('viem/chains');

          const ERC6551_REGISTRY = '0x000000006551c19487814612e58FE06813775758' as `0x${string}`;
          const ERC6551_ACCOUNT_IMPL = '0x878E703A93b6e0aaD92f9907332c68fb09765697' as `0x${string}`;
          const ZERO_SALT = '0x0000000000000000000000000000000000000000000000000000000000000000';

          const account = privateKeyToAccount(treasuryKey as `0x${string}`);
          const walletClient = createWalletClient({ chain: gnosis, transport: http(), account });
          const publicClient = createPublicClient({ chain: gnosis, transport: http() });

          if (chainId === GNOSIS_CHAIN_ID) {
            // Gnosis NFT: register BYO governor in GhostRegistry v2
            const ghostRegistry = '0x194f200b2C624e27a14865292d1C50cF46211565' as `0x${string}`;
            await walletClient.writeContract({
              address: ghostRegistry,
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
              args: [nftContract as `0x${string}`, BigInt(tokenId), safeAddress as `0x${string}`],
            });
            console.log(`BYO NFT ${nftContract}#${tokenId} registered as governor of Safe ${safeAddress}`);
          } else {
            // Cross-chain NFT: compute TBA on Gnosis and add as Safe owner
            // ERC-6551 v0.3: account(impl, salt, chainId, tokenContract, tokenId)
            const accountCallData = encodeFunctionData({
              abi: [{
                name: 'account',
                type: 'function',
                inputs: [
                  { name: 'implementation', type: 'address' },
                  { name: 'salt', type: 'bytes32' },
                  { name: 'chainId', type: 'uint256' },
                  { name: 'tokenContract', type: 'address' },
                  { name: 'tokenId', type: 'uint256' },
                ],
                outputs: [{ name: 'account', type: 'address' }],
                stateMutability: 'view',
              }],
              functionName: 'account',
              args: [ERC6551_ACCOUNT_IMPL, ZERO_SALT, BigInt(chainId), nftContract as `0x${string}`, BigInt(tokenId)],
            });

            const tbaAddress = await publicClient.readContract({
              address: ERC6551_REGISTRY,
              abi: [{
                name: 'account',
                type: 'function',
                inputs: [
                  { name: 'implementation', type: 'address' },
                  { name: 'salt', type: 'bytes32' },
                  { name: 'chainId', type: 'uint256' },
                  { name: 'tokenContract', type: 'address' },
                  { name: 'tokenId', type: 'uint256' },
                ],
                outputs: [{ name: 'account', type: 'address' }],
                stateMutability: 'view',
              }],
              functionName: 'account',
              args: [ERC6551_ACCOUNT_IMPL, ZERO_SALT, BigInt(chainId), nftContract as `0x${string}`, BigInt(tokenId)],
            }) as `0x${string}`;

            console.log(`TBA for ${nftContract}#${tokenId} (chain ${chainId}): ${tbaAddress}`);

            // Add TBA as Safe owner via Safe transaction
            const addOwnerData = encodeFunctionData({
              abi: [{
                name: 'addOwnerWithThreshold',
                type: 'function',
                inputs: [
                  { name: 'owner', type: 'address' },
                  { name: '_threshold', type: 'uint256' },
                ],
                outputs: [],
                stateMutability: 'nonpayable',
              }],
              functionName: 'addOwnerWithThreshold',
              args: [tbaAddress, BigInt(1)],
            });

            // Use treasury key as owner signature (1-of-1 Safe setup)
            const ownerSig = (
              account.address.toLowerCase().padEnd(66, '0').slice(0, 66) +
              '0000000000000000000000000000000000000000000000000000000000000000' +
              '01'
            ) as `0x${string}`;

            await walletClient.writeContract({
              address: safeAddress as `0x${string}`,
              abi: [{
                name: 'execTransaction',
                type: 'function',
                inputs: [
                  { name: 'to', type: 'address' },
                  { name: 'value', type: 'uint256' },
                  { name: 'data', type: 'bytes' },
                  { name: 'operation', type: 'uint8' },
                  { name: 'safeTxGas', type: 'uint256' },
                  { name: 'baseGas', type: 'uint256' },
                  { name: 'gasPrice', type: 'uint256' },
                  { name: 'gasToken', type: 'address' },
                  { name: 'refundReceiver', type: 'address' },
                  { name: 'signatures', type: 'bytes' },
                ],
                outputs: [{ name: 'success', type: 'bool' }],
                stateMutability: 'nonpayable',
              }],
              functionName: 'execTransaction',
              args: [
                safeAddress as `0x${string}`,
                BigInt(0),
                addOwnerData,
                0,
                BigInt(0),
                BigInt(0),
                BigInt(0),
                '0x0000000000000000000000000000000000000000' as `0x${string}`,
                '0x0000000000000000000000000000000000000000' as `0x${string}`,
                ownerSig,
              ],
            });

            console.log(`TBA ${tbaAddress} added as owner of Safe ${safeAddress}`);
          }
        } catch (regErr) {
          console.error(`Failed to register BYO governor for ${agentName}:`, regErr);
          // Non-fatal, continue
        }
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
