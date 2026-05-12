/// API Route: BYO NFT Molt
/// POST /api/chonk-molt
///
/// Orchestrates the full BYO NFT molt flow:
///   1. Verify NFT ownership on-chain (any supported type)
///   2. Verify 2 xDAI fee payment on Gnosis  OR  redeem coupon
///   3. Mint beacon NFT: {type}.{tokenId}.nftmail.gno
///   4. Register alias email → primaryName inbox
///   5. Record molt + upgrade tier basic→lite
///
/// Body: { primaryName, tokenId, ownerWallet, paymentTxHash?, couponCode?,
///         nftType, contractAddress?, nftName? }

import { NextRequest, NextResponse } from 'next/server';
import { type Address } from 'viem';
import {
  verifyChonkOwnership,
  verifyFeePayment,
  verifyUsdcFeePayment,
  mintChonkBeacon,
  registerChonkAlias,
  recordChonkMolt,
} from '../../services/chonk-molt';
import { WORKER_URL } from '../../utils/config';
import { fetchNftImageOnChain, fetchNftTraitsOnChain, type NftTrait } from '../../utils/nft-image';
import { createSafeForByoMolt } from '../../services/create-safe';
import { deployGnosisTba } from '../../services/gnosis-tba';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';
const NFTMAIL_WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY ?? '';
const ETH_RPC = ALCHEMY_KEY
  ? `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`
  : 'https://ethereum.publicnode.com';

const NFT_CONTRACTS: Record<string, { contract: string; rpc: string; chain: string }> = {
  chonk:   { contract: '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9', rpc: 'https://mainnet.base.org', chain: 'base' },
  ens:     { contract: '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85', rpc: ETH_RPC, chain: 'mainnet' },
  pownft:  { contract: '0x9abb7bddc43fa67c76a62d8c016513827f59be1b', rpc: ETH_RPC, chain: 'mainnet' },
  normie:  { contract: '0x9eb6e2025b64f340691e424b7fe7022ffde12438', rpc: ETH_RPC, chain: 'mainnet' },
  mooncat: { contract: '0xc3f733ca98e0dad0386979eb96fb1722a1a05e69', rpc: ETH_RPC, chain: 'mainnet' },
};

// Source chain IDs for Gnosis-side mirror TBA derivation
const NFT_SOURCE_CHAIN_ID: Record<string, number> = {
  chonk:   8453, // Base
  normie:  8453, // Base
  ens:     1,    // Ethereum mainnet
  pownft:  1,
  mooncat: 1,
};

// ── Trait-based tier determination ───────────────────────────────────────────
// Tier hierarchy: basic (Basic+) < lite (Lite) < professional (Premium)
//
// POW NFT:   Gold trait → premium | Silver trait → lite | all else → basic+
// Normie:    Agent trait → premium | all else → basic+
// Chonk:     basic+ (traits mutable/transferable — cannot be used for tier)
// MoonCat:   basic+
// ENS / Other: basic+
//
// basic+ = same quota as Farcaster free (10 sends, 8-day decay) but account
//          never expires, gets a Safe + D1 entry (trustless identity).

const TIER_CONFIG: Record<string, { retention: string; sendsRemaining: number; account_ttl: string }> = {
  basic:        { retention: '8-day',  sendsRemaining: 10,  account_ttl: 'never' },
  lite:         { retention: '30-day', sendsRemaining: 50,  account_ttl: 'never' },
  professional: { retention: 'never',  sendsRemaining: 200, account_ttl: 'never' },
};

function determineTierFromTraits(nftType: string, traits: NftTrait[]): string {
  const traitVal = (name: string) =>
    traits.find(t => t.trait_type.toLowerCase() === name.toLowerCase())?.value;

  if (nftType === 'pownft') {
    const material = String(traitVal('Material') ?? traitVal('material') ?? '').toLowerCase();
    if (material === 'gold')   return 'professional'; // Premium
    if (material === 'silver') return 'lite';          // Lite
    return 'basic';                                    // Basic+
  }

  if (nftType === 'normie') {
    const type = String(traitVal('Type') ?? traitVal('type') ?? '').toLowerCase();
    if (type === 'agent') return 'professional'; // Premium
    return 'basic';
  }

  // chonk, mooncat, ens, other: traits mutable or unavailable — always basic+
  return 'basic';
}

async function verifyGenericOwnership(
  contract: string, tokenId: string, rpc: string, claimedOwner: string,
): Promise<{ verified: boolean; actualOwner: string | null }> {
  try {
    const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: contract, data: '0x6352211e' + tokenIdHex }, 'latest'] }),
    });
    const data = await res.json() as { result?: string; error?: unknown };
    if (data.error || !data.result || data.result === '0x' || data.result === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      return { verified: false, actualOwner: null };
    }
    const actualOwner = ('0x' + data.result.slice(26)).toLowerCase();
    return { verified: actualOwner === claimedOwner.toLowerCase(), actualOwner };
  } catch {
    return { verified: false, actualOwner: null };
  }
}

async function redeemCoupon(code: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(NFTMAIL_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'redeemCoupon', code: code.toUpperCase() }),
    });
    return await res.json() as { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: 'Coupon redemption failed' };
  }
}

export async function POST(req: NextRequest) {
  try {
    const treasuryPrivateKey = process.env.TREASURY_PRIVATE_KEY;
    if (!treasuryPrivateKey) {
      return NextResponse.json({ error: 'BYO NFT molt not configured (missing TREASURY_PRIVATE_KEY)' }, { status: 503 });
    }

    const webhookSecret = process.env.NFTMAIL_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return NextResponse.json({ error: 'BYO NFT molt not configured (missing NFTMAIL_WEBHOOK_SECRET)' }, { status: 503 });
    }

    const body = await req.json() as {
      primaryName?: string;
      tokenId?: string;
      ownerWallet?: string;
      paymentTxHash?: string;
      couponCode?: string;
      nftType?: string;
      contractAddress?: string;
      nftName?: string;
      moltTarget?: string;
      targetAgent?: string;
      targetTld?: string;
      buildVersion?: string;
    };

    const {
      primaryName, tokenId, ownerWallet, paymentTxHash, couponCode,
      nftType = 'chonk', contractAddress, nftName, moltTarget = 'new-agent', targetAgent, targetTld, buildVersion
    } = body as any;

    // Debug: Log targetTld to verify it's being sent
    console.log('BYO MOLT DEBUG:', { 
      primaryName, 
      targetTld, 
      couponCode: couponCode ? 'PRESENT' : 'NONE',
      buildVersion,
      timestamp: new Date().toISOString()
    });

    const type = nftType ?? 'chonk';
    const isOverlay = moltTarget === 'existing-agent' && targetAgent;
    const targetNamespace = targetTld ?? (isOverlay ? 'molt.gno' : 'agent.gno');

    if (!primaryName || typeof primaryName !== 'string') {
      return NextResponse.json({ error: 'Missing primaryName' }, { status: 400 });
    }
    if (!tokenId || typeof tokenId !== 'string') {
      return NextResponse.json({ error: 'Missing tokenId' }, { status: 400 });
    }
    if (!ownerWallet || !/^0x[a-fA-F0-9]{40}$/.test(ownerWallet)) {
      return NextResponse.json({ error: 'Invalid ownerWallet address' }, { status: 400 });
    }

    const hasCoupon = couponCode && couponCode.trim().length > 0;
    const hasTxHash = paymentTxHash && /^0x[a-fA-F0-9]{64}$/.test(paymentTxHash);

    if (!hasCoupon && !hasTxHash) {
      return NextResponse.json({ error: 'Either paymentTxHash or couponCode is required' }, { status: 400 });
    }

    // ── Step 1: Verify NFT ownership ──
    const nftConfig = NFT_CONTRACTS[type];
    const contract = nftConfig?.contract ?? contractAddress;
    const rpc = nftConfig?.rpc ?? 'https://ethereum.publicnode.com';
    if (!contract) {
      return NextResponse.json({ error: 'Missing contract address for NFT type' }, { status: 400 });
    }

    const ownership = await verifyGenericOwnership(contract, tokenId, rpc, ownerWallet);
    if (!ownership.verified) {
      return NextResponse.json({
        status: 'error', step: 'ownership',
        error: ownership.actualOwner
          ? `Wallet does not own ${nftName ?? `#${tokenId}`} — owner is ${ownership.actualOwner}`
          : `Token #${tokenId} not found on-chain`,
      }, { status: 403 });
    }

    // ── Step 2: Verify payment OR redeem coupon ──
    if (hasCoupon) {
      console.log('COUPON DEBUG:', { 
        couponCode: couponCode!.trim(), 
        targetTld, 
        targetNamespace,
        'Are they equal?': targetTld === targetNamespace 
      });
      const couponResult = await redeemCoupon(couponCode!.trim());
      console.log('COUPON RESULT:', couponResult);
      if (!couponResult.ok) {
        return NextResponse.json({ status: 'error', step: 'fee', error: couponResult.error ?? 'Coupon invalid or already used' }, { status: 402 });
      }
    } else {
      // Fees paid in USDC on the NFT's native chain (Base for chonk/normie, Ethereum for all others)
      const feeChain: 'base' | 'mainnet' = (type === 'chonk' || type === 'normie') ? 'base' : 'mainnet';
      const BYO_FEE_USDC = 10; // $10 USDC flat fee for new agents; tier upgrades handled by mini app
      const fee = await verifyUsdcFeePayment(paymentTxHash!, feeChain, BYO_FEE_USDC);
      if (!fee.verified) {
        return NextResponse.json({ status: 'error', step: 'fee', error: fee.error ?? 'Fee verification failed' }, { status: 402 });
      }
    }

    // ── Step 3: Mint beacon NFT ──
    // Beacon labels use hyphens (not dots) to avoid sub.sub.name interpretation
    // e.g. chonk-123.nftmail.gno, atom-1234.nftmail.gno, eyemine.nftmail.gno
    const cleanName = primaryName.toLowerCase().replace(/_$/, '');
    const beaconPrefix = type === 'pownft' ? 'atom' : type === 'normie' ? 'normie' : type === 'chonk' ? 'chonk' : type === 'mooncat' ? 'mooncat' : 'nft';
    const emailPrefix  = type === 'pownft' ? 'atom' : type === 'normie' ? 'normie' : type === 'chonk' ? 'chonk' : type === 'mooncat' ? 'mooncat' : 'nft';
    const displayLabel = type === 'ens' && nftName ? nftName.replace(/\.eth$/i, '').toLowerCase() : tokenId.slice(0, 20);
    const beaconLabel = type === 'ens' ? displayLabel : `${beaconPrefix}-${displayLabel}`;

    // Calculate humanLocalPart early - needed for Safe creation saltNonce
    const humanLocalPart = type === 'ens'
      ? (nftName ?? `ens.${tokenId.slice(0, 8)}`)
      : `${emailPrefix}.${displayLabel}`;

    // Safe address and TBA address for new-agent molts (set during beacon/Safe step)
    let safeAddress: string | null = null;
    let tbaAddress: string | null = null;

    let beacon: { success: boolean; beaconNft?: string; txHash?: string; beaconTokenId?: number | null; error?: string };
    if (isOverlay) {
      // Overlay: still mint beacon NFT for provenance, but to the agent's Safe
      safeAddress = ownerWallet; // fallback to owner if Safe lookup fails
      try {
        const identityRes = await fetch(NFTMAIL_WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getAgentIdentity', name: targetAgent }),
        });
        if (identityRes.ok) {
          const identity = await identityRes.json() as { safeAddress?: string };
          if (identity.safeAddress) safeAddress = identity.safeAddress;
        }
      } catch {
        // Safe lookup failed, mint to owner wallet instead
      }
      beacon = await mintChonkBeacon(tokenId, ownerWallet, APP_URL, webhookSecret, beaconLabel, safeAddress ?? undefined, targetNamespace);
      if (!beacon.success) {
        return NextResponse.json({ status: 'error', step: 'beacon-mint', error: beacon.error ?? 'Beacon mint failed' }, { status: 502 });
      }
    } else {
      // New agent: deploy Gnosis-side mirror TBA for the BYO NFT, use it as sole Safe signer.
      // This makes ownership trustless: NFT transfer → new holder controls TBA → controls Safe.
      // The EOA is NOT added to the Safe — only the TBA is the signer.
      const treasuryKey = process.env.TREASURY_PRIVATE_KEY;
      if (treasuryKey) {
        const nftContract = NFT_CONTRACTS[type]?.contract ?? contractAddress;
        const sourceChainId = NFT_SOURCE_CHAIN_ID[type] ?? 1;

        // ── Step 3a: Deploy Gnosis-side mirror TBA for the BYO NFT ──
        // Universal: ALL keystone NFTs (ENS, BYO collections, Chonks) get a Gnosis mirror TBA.
        // The NFT stays on its native chain — the mirror TBA controls the Safe on Gnosis.
        // Transfer the NFT → new owner controls TBA → controls Safe → agent identity transfers.
        if (nftContract) {
          try {
            const { createWalletClient, http } = await import('viem');
            const { privateKeyToAccount } = await import('viem/accounts');
            const { gnosis } = await import('viem/chains');
            const account = privateKeyToAccount(treasuryKey as `0x${string}`);
            const wc = createWalletClient({ chain: gnosis, transport: http(), account });

            const tbaResult = await deployGnosisTba(
              { sourceChainId, contractAddress: nftContract as Address, tokenId: BigInt(tokenId) },
              wc,
            );
            tbaAddress = tbaResult.tbaAddress;
            console.log(`Gnosis TBA for ${type}#${tokenId}: ${tbaAddress} (deployed=${!tbaResult.alreadyDeployed})`);
          } catch (err) {
            console.error('TBA deployment failed (non-fatal, falling back to EOA):', err);
          }
        }

        // ── Step 3b: Create Safe with TBA as sole signer (or EOA fallback for ENS) ──
        const safeOwner = tbaAddress ?? ownerWallet;
        const safeResult = await createSafeForByoMolt(humanLocalPart, safeOwner, treasuryKey);
        if (safeResult.safeAddress) {
          safeAddress = safeResult.safeAddress;
          console.log(`Safe created for ${humanLocalPart}: ${safeAddress} (owner=${safeOwner})`);

          // ── Step 3c: Register BYO NFT as governor of Safe in GhostRegistry ──
          try {
            if (nftContract && safeAddress) {
              const ghostRegistry = '0x194f200b2C624e27a14865292d1C50cF46211565'; // GhostRegistry v2
              const { createWalletClient, http, encodeFunctionData } = await import('viem');
              const { privateKeyToAccount } = await import('viem/accounts');
              const { gnosis } = await import('viem/chains');

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
            }
          } catch (err) {
            console.error('BYO governor registration failed (non-fatal):', err);
          }
        } else {
          console.error('Safe creation failed (non-fatal):', safeResult.error);
        }
      }
      // Mint beacon NFT to the Safe (not the user's wallet).
      // The Safe holds feature beacons; the keystone NFT (in user's wallet) governs the Safe via mirror TBA.
      const beaconRecipient = safeAddress ?? ownerWallet;
      beacon = await mintChonkBeacon(tokenId, ownerWallet, APP_URL, webhookSecret, beaconLabel, beaconRecipient, targetNamespace);
      if (!beacon.success) {
        return NextResponse.json({ status: 'error', step: 'beacon-mint', error: beacon.error ?? 'Beacon mint failed' }, { status: 502 });
      }
    }

    // controller is always the human EOA (ownerWallet) — used to show inboxes in nftmail.box
    // The Safe is stored separately in the safe: field of acct-tier and nftmailgno records

    // ── Step 3d: Fetch on-chain traits to determine service tier ──
    // POW NFT: Gold → premium (professional), Silver → lite, else → basic+
    // Normie:  Agent type → premium, else → basic+
    // Chonk/MoonCat/Other: basic+ (traits mutable or unavailable)
    let accountTier = 'basic';
    try {
      const nftContract = NFT_CONTRACTS[type]?.contract ?? contractAddress;
      const nftChain = (NFT_CONTRACTS[type]?.chain ?? 'mainnet') as 'base' | 'mainnet' | 'gnosis';
      if (nftContract && (type === 'pownft' || type === 'normie')) {
        const traits = await fetchNftTraitsOnChain(nftContract, tokenId, nftChain);
        accountTier = determineTierFromTraits(type, traits);
        console.log(`[byo-molt] ${type}#${tokenId} traits:`, JSON.stringify(traits), '→ tier:', accountTier);
      }
    } catch (err) {
      console.error('[byo-molt] trait fetch failed (defaulting to basic):', err);
    }

    // ── Step 4: Register aliases (both human + agent emails) ──
    // Human HITL email: chonk.123@nftmail.box (dot separator, no underscore)
    // Agent A2A email:  chonk.123_@nftmail.box (dot separator, trailing underscore)
    // ENS: eyemine.eth@nftmail.box / eyemine.eth_@nftmail.box
    const agentLocalPart = `${humanLocalPart}_`;
    const humanEmail = `${humanLocalPart}@nftmail.box`;
    const agentEmail = `${agentLocalPart}@nftmail.box`;

    // For overlays, the primaryName is the existing agent (targetAgent)
    // For new-agent BYO molts, the primary is the dot-format NFT name (atom.158, chonk.676)
    // NOT the base cleanName (atom, chonk) which belongs to the original agent brain
    const finalPrimaryName = isOverlay ? targetAgent! : humanLocalPart;

    // For overlay molts: createAlias so the NFT identity (atom.158, atom.158_) forwards
    // into the existing target agent's inbox.
    // For new-agent molts: skip createAlias — registerSovereign (step 4b) creates two
    // standalone inbox accounts (atom.158@ and atom.158_@) owned by the EOA wallet,
    // exactly like ghostagent@ and ghostagent_@ are separate accounts.
    if (isOverlay) {
      try {
        await Promise.all([
          fetch(NFTMAIL_WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'createAlias', primaryName: finalPrimaryName, aliasLocalPart: humanLocalPart,
              collectionName: type, tokenId, ownerAddress: ownerWallet.toLowerCase(), displayEmail: 'human',
            }),
          }),
          fetch(NFTMAIL_WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'createAlias', primaryName: finalPrimaryName, aliasLocalPart: agentLocalPart,
              collectionName: type, tokenId, ownerAddress: ownerWallet.toLowerCase(), displayEmail: 'agent',
            }),
          }),
        ]);
      } catch {
        // Non-fatal
      }
    }

    // ── Step 5: Set TLD in KV for dashboard listing ──
    // BYO NFT molts need tld:* KV entry to appear in dashboard "My Agents"
    try {
      await fetch(NFTMAIL_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setTld',
          agentName: finalPrimaryName,
          tld: targetNamespace,
        }),
      });
    } catch {
      // Non-fatal — dashboard listing is best-effort
    }

    // ── Step 5a: Store NFT owner wallet as principal + tbaAddress in KV ──
    // ownerWallet is the human who holds the BYO NFT — they are the principal.
    // tbaAddress (if set) is the on-chain key that governs the Safe.
    try {
      await fetch(NFTMAIL_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setPrincipal',
          agentName: finalPrimaryName,
          principal: ownerWallet.toLowerCase(),
          secret: webhookSecret,
        }),
      });
    } catch {
      // Non-fatal
    }

    // Store tbaAddress so dashboard/OSINT can surface it
    if (!isOverlay && tbaAddress) {
      try {
        await fetch(NFTMAIL_WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'kvPut',
            key: `tba:${finalPrimaryName}`,
            value: JSON.stringify({ tbaAddress, sourceChainId: NFT_SOURCE_CHAIN_ID[type] ?? 1, nftType: type, tokenId, storedAt: Date.now() }),
            ownerAddress: ownerWallet.toLowerCase(),
            webhookSecret,
          }),
        });
      } catch {
        // Non-fatal
      }
    }

    // ── Step 5b: Register nftmailgno accounts so emails appear in nftmail.box dropdown ──
    // Uses registerSovereign with WEBHOOK_SECRET which bypasses the account limit.
    // controller = ownerWallet (human EOA) so inbox shows up when that wallet connects to nftmail.box.
    // Safe is passed separately in the safe: field.
    if (!isOverlay) {
      try {
        await Promise.all([
          fetch(NFTMAIL_WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'registerSovereign',
              secret: webhookSecret,
              label: humanLocalPart,
              controller: ownerWallet.toLowerCase(),
              originNft: beacon.beaconNft,
              accountTier,
              safe: safeAddress ?? null,
            }),
          }),
          fetch(NFTMAIL_WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'registerSovereign',
              secret: webhookSecret,
              label: agentLocalPart,
              controller: ownerWallet.toLowerCase(),
              originNft: beacon.beaconNft,
              accountTier,
              safe: safeAddress ?? null,
            }),
          }),
        ]);
      } catch {
        // Non-fatal
      }
    }

    // ── Step 5b-ii: Generate ECIES keypair for the HITL human inbox (non-fatal) ──
    // Collection NFT molts provision a sovereign human inbox (humanLocalPart@nftmail.box).
    // upgradeTier auto-generates an ECIES keypair if none exists, enabling darkbox encryption
    // at LITE tier. The private key is logged server-side only (not returned to client).
    if (!isOverlay) {
      try {
        const eciesRes = await fetch(NFTMAIL_WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'upgradeTier',
            label: humanLocalPart,
            newTier: accountTier,
            safe: safeAddress ?? null,
            secret: webhookSecret,
          }),
        });
        if (eciesRes.ok) {
          const eciesData = await eciesRes.json() as { eciesPublicKey?: string; eciesPrivateKey?: string };
          if (eciesData.eciesPrivateKey) {
            console.log(`[byo-molt] ECIES keypair generated for ${humanLocalPart} — store private key securely:`, eciesData.eciesPrivateKey);
          }
        }
      } catch {
        // Non-fatal — ECIES provisioning is best-effort
      }
    }

    // ── Step 5c: Register ERC-8004 identity (non-fatal) ──
    // Every BYO molt agent should have an ERC-8004 on-chain identity
    let erc8004AgentId: number | null = null;
    try {
      const sld = targetNamespace.replace(/\.gno$/, ''); // 'agent.gno' → 'agent', 'molt.gno' → 'molt'
      const erc8004Res = await fetch(`${APP_URL}/api/erc8004/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: finalPrimaryName,
          sld,
          ownerWallet,
          safeAddress: safeAddress ?? undefined,
        }),
      });
      if (erc8004Res.ok) {
        const erc8004Data = await erc8004Res.json() as { agentId?: number };
        erc8004AgentId = erc8004Data.agentId ?? null;
        console.log(`ERC-8004 registered for ${finalPrimaryName}: agentId=${erc8004AgentId}`);
      } else {
        const errData = await erc8004Res.json().catch(() => ({})) as { error?: string };
        console.error(`ERC-8004 registration failed (non-fatal): ${errData.error ?? erc8004Res.status}`);
      }
    } catch (err) {
      console.error('ERC-8004 registration failed (non-fatal):', err);
    }

    // ── Step 6: Record molt + upgrade tier ──
    await recordChonkMolt(finalPrimaryName, tokenId, ownerWallet, beacon.beaconNft!, beacon.txHash!, webhookSecret);

    // ── Step 6 (non-fatal): Fetch + store origin NFT image URL for agent card display ──
    // Stored under KV key byo-origin-image:{agentName} — read by /api/agent-card to override default genome image.
    try {
      let originImageUrl: string | null = null;
      if (type === 'ens') {
        const ENS_META_URL = `https://metadata.ens.domains/mainnet/0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85/${tokenId}`;
        const imgRes = await fetch(ENS_META_URL);
        if (imgRes.ok) {
          const meta = await imgRes.json() as { image?: string; image_url?: string };
          originImageUrl = meta.image ?? meta.image_url ?? null;
        }
      } else {
        // Use on-chain tokenURI — no API key required, works from any origin
        const chain = (type === 'chonk' || type === 'normie') ? 'base' : 'mainnet';
        const nftContract = NFT_CONTRACTS[type]?.contract ?? contractAddress;
        if (nftContract) {
          const { imageUrl } = await fetchNftImageOnChain(nftContract, tokenId, chain);
          originImageUrl = imageUrl;
        }
      }
      if (originImageUrl) {
        await fetch(NFTMAIL_WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'kvPut',
            key: `byo-origin-image:${finalPrimaryName}`,
            value: JSON.stringify({ imageUrl: originImageUrl, nftType: type, storedAt: Date.now() }),
            ownerAddress: ownerWallet.toLowerCase(),
            webhookSecret,
          }),
        });
      }
    } catch {
      // Non-fatal — image storage is best-effort
    }

    return NextResponse.json({
      status: 'ok',
      primaryEmail: isOverlay ? `${finalPrimaryName}_@nftmail.box` : `${humanLocalPart}@nftmail.box`,
      humanEmail,
      agentEmail,
      aliasEmail: agentEmail,
      beaconNft: beacon.beaconNft,
      beaconTxHash: beacon.txHash,
      beaconTokenId: beacon.beaconTokenId ?? null,
      erc8004AgentId,
      displayEmail: 'alias',
      message: `BYO NFT Molt Complete: Now ${humanLocalPart}`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[chonk-molt]', msg);
    return NextResponse.json({ error: msg, status: 'error', step: 'worker' }, { status: 500 });
  }
}

/// GET /api/chonk-molt?primaryName=paymastr
/// Returns existing molt record for a primary agent, if any.
export async function GET(req: NextRequest) {
  const primaryName = req.nextUrl.searchParams.get('primaryName');
  if (!primaryName) {
    return NextResponse.json({ error: 'Missing primaryName' }, { status: 400 });
  }


  try {
    // Check alias record
    const aliasRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAlias', primaryName }),
    });

    if (aliasRes.status === 404) {
      return NextResponse.json({ molted: false, primaryName });
    }

    const aliasData = await aliasRes.json() as any;
    if (!aliasData.exists || aliasData.collectionName !== 'chonk') {
      return NextResponse.json({ molted: false, primaryName });
    }

    return NextResponse.json({
      molted: true,
      primaryName,
      primaryEmail: `${primaryName}_@nftmail.box`,
      aliasEmail: `${aliasData.aliasLocalPart}@nftmail.box`,
      beaconNft: `chonk.${aliasData.tokenId}.nftmail.gno`,
      tokenId: aliasData.tokenId,
      displayEmail: aliasData.displayEmail,
    });
  } catch {
    return NextResponse.json({ error: 'Worker unavailable' }, { status: 502 });
  }
}
