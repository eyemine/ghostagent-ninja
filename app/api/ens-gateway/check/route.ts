/**
 * GET /api/ens-gateway/check?address={walletAddress}
 *
 * Checks if a wallet owns an ENS name and returns gateway benefits
 * for BaseMail → NFTmail migration.
 *
 * ENS Gateway Benefits:
 * - Free .agent.gno mint (gasless, via treasury)
 * - Priority namespace reservation
 * - ENS-linked agent card (alice.eth → alice.agent.gno)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, namehash } from 'viem';
import { mainnet } from 'viem/chains';

const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENS_BASE_REGISTRAR = '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85';

const ENS_REGISTRY_ABI = [{
  name: 'resolver',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'node', type: 'bytes32' }],
  outputs: [{ name: '', type: 'address' }],
}] as const;

const ENS_RESOLVER_ABI = [{
  name: 'name',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'node', type: 'bytes32' }],
  outputs: [{ name: '', type: 'string' }],
}, {
  name: 'addr',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'node', type: 'bytes32' }],
  outputs: [{ name: '', type: 'address' }],
}] as const;

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.ETH_RPC_URL || 'https://eth.llamarpc.com'),
});

interface ENSGatewayResponse {
  hasENS: boolean;
  ensName?: string;
  ensNode?: string;
  ownerAddress: string;
  resolverAddress?: string;
  eligibleForFreeMint: boolean;
  suggestedAgentName: string;
  gatewayBenefits: string[];
  migrationPath: 'ens-gateway' | 'standard';
  metadata: {
    checkedAt: string;
    chainId: number;
    blockNumber: bigint;
  };
}

/**
 * Reverse resolve ENS name from address
 * Uses the official ENS reverse registrar
 */
async function reverseResolveENS(address: string): Promise<string | null> {
  try {
    // Reverse node: addr.reverse
    const reverseNode = namehash(`${address.slice(2)}.addr.reverse`);
    
    // Get resolver for reverse node
    const resolverAddr = await publicClient.readContract({
      address: ENS_REGISTRY,
      abi: ENS_REGISTRY_ABI,
      functionName: 'resolver',
      args: [reverseNode],
    });
    
    if (!resolverAddr || resolverAddr === '0x0000000000000000000000000000000000000000') {
      return null;
    }
    
    // Get name from resolver
    const name = await publicClient.readContract({
      address: resolverAddr as `0x${string}`,
      abi: ENS_RESOLVER_ABI,
      functionName: 'name',
      args: [reverseNode],
    });
    
    // Verify forward resolution matches
    if (name) {
      const forwardNode = namehash(name);
      const forwardAddr = await publicClient.readContract({
        address: resolverAddr as `0x${string}`,
        abi: ENS_RESOLVER_ABI,
        functionName: 'addr',
        args: [forwardNode],
      });
      
      if ((forwardAddr as string).toLowerCase() === address.toLowerCase()) {
        return name;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Reverse ENS lookup failed:', error);
    return null;
  }
}

/**
 * Generate suggested agent name from ENS name
 */
function generateAgentName(ensName: string): string {
  // Remove .eth and normalize
  const baseName = ensName.replace(/\.eth$/, '').toLowerCase();
  
  // Clean up special characters
  const cleanName = baseName.replace(/[^a-z0-9-]/g, '');
  
  return cleanName;
}

export async function GET(req: NextRequest) {
  const walletAddress = req.nextUrl.searchParams.get('address')?.toLowerCase();
  
  if (!walletAddress) {
    return NextResponse.json(
      { error: 'Missing wallet address' },
      { status: 400 }
    );
  }
  
  // Validate Ethereum address
  if (!/^0x[a-f0-9]{40}$/i.test(walletAddress)) {
    return NextResponse.json(
      { error: 'Invalid wallet address format' },
      { status: 400 }
    );
  }
  
  try {
    const blockNumber = await publicClient.getBlockNumber();
    
    // Check for ENS reverse resolution
    const ensName = await reverseResolveENS(walletAddress);
    
    if (!ensName) {
      // No ENS - standard migration path
      const response: ENSGatewayResponse = {
        hasENS: false,
        ownerAddress: walletAddress,
        eligibleForFreeMint: false,
        suggestedAgentName: '',
        gatewayBenefits: [],
        migrationPath: 'standard',
        metadata: {
          checkedAt: new Date().toISOString(),
          chainId: mainnet.id,
          blockNumber,
        },
      };
      
      return NextResponse.json(response, {
        headers: {
          'Cache-Control': 'public, max-age=300',
        },
      });
    }
    
    // ENS found - gateway benefits
    const suggestedAgentName = generateAgentName(ensName);
    
    const response: ENSGatewayResponse = {
      hasENS: true,
      ensName,
      ensNode: namehash(ensName),
      ownerAddress: walletAddress,
      eligibleForFreeMint: true,
      suggestedAgentName,
      gatewayBenefits: [
        `Free .agent.gno mint: ${suggestedAgentName}.agent.gno`,
        'Gasless treasury-sponsored deployment',
        'ENS-verified agent card on notapaperclip.red',
        'Priority access to HITL module deployment',
        'Cross-platform recognition (ENS ↔ ERC-8004)',
      ],
      migrationPath: 'ens-gateway',
      metadata: {
        checkedAt: new Date().toISOString(),
        chainId: mainnet.id,
        blockNumber,
      },
    };
    
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, max-age=300',
      },
    });
    
  } catch (error: any) {
    console.error('ENS gateway check error:', error);
    return NextResponse.json(
      { 
        error: 'ENS verification failed', 
        details: error?.message,
        hasENS: false,
        ownerAddress: walletAddress,
        eligibleForFreeMint: false,
        migrationPath: 'standard',
      },
      { status: 500 }
    );
  }
}
