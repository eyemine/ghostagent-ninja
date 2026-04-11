import { NextRequest, NextResponse } from 'next/server';

const ETH_RPC = 'https://ethereum.publicnode.com';
const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';

// Keccak-256 round constants
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
];

// Rotation offsets for rho step
const R = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

// Keccak-f[1600] permutation
function keccakF1600(state: BigUint64Array): void {
  const temp = new BigUint64Array(25);
  const C = new BigUint64Array(5);

  for (let round = 0; round < 24; round++) {
    // Theta
    for (let i = 0; i < 5; i++) {
      C[i] = state[i] ^ state[i + 5] ^ state[i + 10] ^ state[i + 15] ^ state[i + 20];
    }
    for (let i = 0; i < 5; i++) {
      const D = C[(i + 4) % 5] ^ ((C[(i + 1) % 5] << 1n) | (C[(i + 1) % 5] >> 63n));
      for (let j = 0; j < 25; j += 5) {
        state[i + j] ^= D;
      }
    }

    // Rho and Pi
    temp[0] = state[0];
    for (let i = 1; i < 25; i++) {
      const r = R[i];
      temp[i] = (state[i] << BigInt(r)) | (state[i] >> BigInt(64 - r));
    }
    for (let i = 0; i < 25; i++) {
      state[i] = temp[(i * 7) % 25];
    }

    // Chi
    for (let j = 0; j < 25; j += 5) {
      for (let i = 0; i < 5; i++) {
        C[i] = state[j + i];
      }
      for (let i = 0; i < 5; i++) {
        state[j + i] ^= (~C[(i + 1) % 5]) & C[(i + 2) % 5];
      }
    }

    // Iota
    state[0] ^= RC[round];
  }
}

// Keccak-256 hash function
function keccak256(input: Uint8Array): Uint8Array {
  const state = new BigUint64Array(25);
  const blockSize = 136; // r = 1088 bits = 136 bytes for keccak-256

  // Absorb all full blocks
  for (let i = 0; i < input.length; i += blockSize) {
    const block = input.slice(i, Math.min(i + blockSize, input.length));
    for (let j = 0; j < block.length; j++) {
      state[j >> 3] ^= BigInt(block[j]) << BigInt((j & 7) * 8);
    }
    if (block.length === blockSize) {
      keccakF1600(state);
    }
  }

  // Final block with padding
  const lastBlockStart = Math.floor(input.length / blockSize) * blockSize;
  const remaining = input.length - lastBlockStart;
  const lastBlock = new Uint8Array(blockSize);
  for (let i = 0; i < remaining; i++) {
    lastBlock[i] = input[lastBlockStart + i];
  }
  lastBlock[remaining] = 0x01; // Padding start
  lastBlock[blockSize - 1] |= 0x80; // Padding end

  for (let j = 0; j < blockSize; j++) {
    state[j >> 3] ^= BigInt(lastBlock[j]) << BigInt((j & 7) * 8);
  }
  keccakF1600(state);

  // Squeeze output (256 bits = 32 bytes)
  const output = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    output[i] = Number((state[i >> 3] >> BigInt((i & 7) * 8)) & 0xffn);
  }
  return output;
}

// Compute labelhash (keccak256 of the label)
function labelhash(label: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(label.toLowerCase());
  const hash = keccak256(data);
  return '0x' + Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Compute ENS namehash
function namehash(name: string): string {
  let node = '0x0000000000000000000000000000000000000000000000000000000000000000';
  if (!name) return node;

  const labels = name.split('.');
  for (let i = labels.length - 1; i >= 0; i--) {
    const hash = labelhash(labels[i]);
    const nodeBytes = hexToBytes(node.slice(2));
    const hashBytes = hexToBytes(hash.slice(2));
    const combined = new Uint8Array(64);
    combined.set(nodeBytes);
    combined.set(hashBytes, 32);
    const newHash = keccak256(combined);
    node = '0x' + Array.from(newHash).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return node;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')?.toLowerCase().trim();
  
  if (!name || name.length < 2) {
    return NextResponse.json({ error: 'Name too short' }, { status: 400 });
  }

  try {
    // Remove .eth suffix if present
    const label = name.replace(/\.eth$/, '');
    
    // Compute namehash for label.eth using proper keccak256
    const node = namehash(`${label}.eth`);
    
    // ENS registry owner(bytes32 node) = 0x02571be3
    const data = '0x02571be3' + node.slice(2).padStart(64, '0');
    
    const resp = await fetch(ETH_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: ENS_REGISTRY, data }, 'latest']
      }),
    });
    
    const json: any = await resp.json();
    const result: string = json.result || '0x';
    const owner = result !== '0x' && result !== '0x' + '0'.repeat(64) ? '0x' + result.slice(-40) : null;
    const registered = !!owner && owner !== '0x0000000000000000000000000000000000000000';
    
    return NextResponse.json({ 
      registered, 
      owner,
      name: `${label}.eth`
    });
  } catch (error) {
    console.error('[check-ens] Error:', error);
    return NextResponse.json({ registered: false, error: 'Check failed' });
  }
}
