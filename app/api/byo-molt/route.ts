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
import { createWalletClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';
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
import { verifyOwnershipOrDelegate } from '../../utils/delegate-verify';
import { createSafeForByoMolt } from '../../services/create-safe';
import { deployGnosisTba, TOKENBOUND_V3_IMPLEMENTATION, TOKENBOUND_V3_PROXY } from '../../services/gnosis-tba';
import { findRecentKeyMint, gnosisKeyClient, KEY_REGISTRARS } from '../../services/gnosis-key';
import { verifySafeKeyExecution } from '../../services/safe-key';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';
const NFTMAIL_WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const WORKER_SECRET = process.env.WORKER_SECRET ?? '';

const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY ?? '';
const ETH_RPC = ALCHEMY_KEY
  ? `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`
  : 'https://ethereum.publicnode.com';

const NFT_CONTRACTS: Record<string, { contract: string; rpc: string; chain: string }> = {
  chonk:      { contract: '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9', rpc: 'https://mainnet.base.org', chain: 'base' },
  ens:        { contract: '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85', rpc: ETH_RPC, chain: 'mainnet' },
  pownft:     { contract: '0x9abb7bddc43fa67c76a62d8c016513827f59be1b', rpc: ETH_RPC, chain: 'mainnet' },
  normie:     { contract: '0x9eb6e2025b64f340691e424b7fe7022ffde12438', rpc: ETH_RPC, chain: 'mainnet' },
  mooncat:    { contract: '0xc3f733ca98e0dad0386979eb96fb1722a1a05e69', rpc: ETH_RPC, chain: 'mainnet' },
  fakenormie: { contract: '0x1d6b9e2af40322d2311ff0df66dade4490ac4c29', rpc: 'https://rpc.gnosischain.com', chain: 'gnosis' },
};

// Source chain IDs for Gnosis-side mirror TBA derivation
const NFT_SOURCE_CHAIN_ID: Record<string, number> = {
  chonk:      8453, // Base
  normie:     1,    // Ethereum mainnet
  ens:        1,    // Ethereum mainnet
  pownft:     1,
  mooncat:    1,
  fakenormie: 100,  // Gnosis mainnet
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

async function redeemCoupon(code: string, tld?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(NFTMAIL_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(WORKER_SECRET ? { 'X-Worker-Secret': WORKER_SECRET } : {}) },
      body: JSON.stringify({ action: 'redeemCoupon', code: code.toUpperCase(), ...(tld ? { tld } : {}) }),
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
      vaultWallet?: string;
      paymentTxHash?: string;
      couponCode?: string;
      nftType?: string;
      contractAddress?: string;
      nftName?: string;
      moltTarget?: string;
      targetAgent?: string;
      targetTld?: string;
      buildVersion?: string;
      preflight?: boolean;
    };

    const {
      primaryName, tokenId, ownerWallet, vaultWallet, paymentTxHash, couponCode,
      nftType = 'chonk', contractAddress, nftName, moltTarget = 'new-agent', targetAgent, targetTld, buildVersion, preflight
    } = body;

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
    const keyRegistrar = KEY_REGISTRARS[targetNamespace];
    if (!keyRegistrar) {
      return NextResponse.json({ error: 'Unsupported key NFT namespace.' }, { status: 400 });
    }

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

    if (!preflight && !hasCoupon && !hasTxHash) {
      return NextResponse.json({ error: 'Either paymentTxHash or couponCode is required' }, { status: 400 });
    }

    // ── Step 1: Verify NFT ownership ──
    const nftConfig = NFT_CONTRACTS[type];
    // Only known ENS registries may override the collection contract. Accepting
    // any client contract would let an attacker fake ownerOf for a named NFT.
    const ensContracts = [
      NFT_CONTRACTS.ens.contract.toLowerCase(),
      '0xd4416b13d2b3a9abae7acd5d6c2bbdbe25686401',
      '0xf60aba43e1f7f3dab1186ff03b561401c9df85e2',
    ];
    const contract = type === 'ens' && contractAddress && ensContracts.includes(contractAddress.toLowerCase())
      ? contractAddress : nftConfig?.contract ?? contractAddress;
    const rpc = nftConfig?.rpc || 'https://ethereum.publicnode.com';
    if (!contract) {
      return NextResponse.json({ error: 'Missing contract address for NFT type' }, { status: 400 });
    }

    const ownership = await verifyOwnershipOrDelegate({
      contract, tokenId, rpcUrl: rpc,
      connectedWallet: ownerWallet,
      vaultWallet: vaultWallet ?? undefined,
    });
    if (!ownership.verified) {
      return NextResponse.json({
        status: 'error', step: 'ownership',
        error: ownership.error ??
          (ownership.actualOwner
            ? `Wallet does not own ${nftName ?? `#${tokenId}`} — owner is ${ownership.actualOwner}`
            : `Token #${tokenId} not found on-chain`),
      }, { status: 403 });
    }
    // If access is via delegation, record the vault wallet as the actual controller
    const effectiveController = ownership.viaDelegate && ownership.vaultWallet
      ? ownership.vaultWallet
      : ownerWallet.toLowerCase();
    if (isOverlay) {
      // Existing Safe owner changes require the current Safe signers. The old
      // path silently fell back to minting into an arbitrary ownerWallet.
      return NextResponse.json({
        status: 'error', step: 'governance',
        error: 'Existing agents require the Safe retrofit flow. No payment was consumed by this request.',
      }, { status: 409 });
    }

    const cleanName = primaryName.toLowerCase().replace(/_$/, '');
    const beaconPrefix = type === 'pownft' ? 'atom' : type === 'normie' ? 'normie' : type === 'chonk' ? 'chonk' : type === 'mooncat' ? 'mooncat' : type === 'fakenormie' ? 'normie' : 'nft';
    const emailPrefix = beaconPrefix;
    const displayLabel = type === 'ens' ? primaryName.replace(/\.eth$/i, '').toLowerCase() : tokenId.slice(0, 20);
    const beaconLabel = type === 'ens' ? displayLabel : type === 'fakenormie' ? cleanName.replace(/\./g, '-') : `${beaconPrefix}-${displayLabel}`;
    const humanLocalPart = type === 'ens' ? displayLabel : type === 'fakenormie' ? cleanName : `${emailPrefix}.${displayLabel}`;

    // Run before accepting a fee/coupon and expose the same checks to the UI
    // before it asks the user to send USDC.
    try {
      const client = gnosisKeyClient();
      for (const address of [TOKENBOUND_V3_PROXY, TOKENBOUND_V3_IMPLEMENTATION]) {
        const code = await client.getCode({ address });
        if (!code || code === '0x') throw new Error('Canonical Gnosis account contracts are unavailable.');
      }
      await findRecentKeyMint(client, keyRegistrar, beaconLabel, targetNamespace, effectiveController as Address);
    } catch (error: unknown) {
      return NextResponse.json({
        status: 'error', step: 'preflight',
        error: error instanceof Error ? error.message : 'Could not verify the key NFT before payment.',
      }, { status: 409 });
    }
    if (preflight) return NextResponse.json({ status: 'ready', keyName: `${beaconLabel}.${targetNamespace}` });

    // ── Step 2: Verify payment OR redeem coupon ──
    if (hasCoupon) {
      console.log('COUPON DEBUG:', { 
        couponCode: couponCode!.trim(), 
        targetTld, 
        targetNamespace,
        'Are they equal?': targetTld === targetNamespace 
      });
      const couponResult = await redeemCoupon(couponCode!.trim(), targetNamespace);
      console.log('COUPON RESULT:', couponResult);
      if (!couponResult.ok) {
        return NextResponse.json({ status: 'error', step: 'fee', error: couponResult.error ?? 'Coupon invalid or already used' }, { status: 402 });
      }
    } else {
      const feeChain: 'base' | 'mainnet' = type === 'chonk' ? 'base' : 'mainnet';
      const BYO_FEE_USDC = 10; // $10 USDC flat fee for new agents; tier upgrades handled by mini app
      const fee = await verifyUsdcFeePayment(paymentTxHash!, feeChain, BYO_FEE_USDC);
      if (!fee.verified) {
        return NextResponse.json({ status: 'error', step: 'fee', error: fee.error ?? 'Fee verification failed' }, { status: 402 });
      }
      if (fee.fromWallet !== ownerWallet.toLowerCase() && fee.fromWallet !== effectiveController) {
        return NextResponse.json({ status: 'error', step: 'fee', error: 'Payment must come from the NFT owner or authorised delegate.' }, { status: 403 });
      }
    }

    // Safe address and TBA address for new-agent molts (set during beacon/Safe step)
    let safeAddress: string | null = null;
    let tbaAddress: string | null = null;

    // The .gno NFT is the key, held OUTSIDE the Safe. The source NFT is the
    // pairing identity; it is not a same-chain owner oracle.
    const beacon = await mintChonkBeacon(
      tokenId, effectiveController, APP_URL, webhookSecret, beaconLabel, effectiveController, targetNamespace,
    );
    if (!beacon.success || beacon.beaconTokenId == null) {
      return NextResponse.json({ status: 'error', step: 'key-mint', error: beacon.error ?? 'Key mint not confirmed. Retry with the same payment.' }, { status: 502 });
    }
    try {
      const account = privateKeyToAccount(treasuryPrivateKey as `0x${string}`);
      const wallet = createWalletClient({ chain: gnosis, transport: http(process.env.GNOSIS_RPC_URL || 'https://rpc.gnosischain.com'), account });
      const tba = await deployGnosisTba({
        sourceChainId: 100, contractAddress: keyRegistrar, tokenId: BigInt(beacon.beaconTokenId),
      }, wallet);
      if (tba.nftOwner.toLowerCase() !== effectiveController.toLowerCase()) {
        throw new Error('Key NFT owner changed during provisioning.');
      }
      tbaAddress = tba.tbaAddress;
      const safe = await createSafeForByoMolt(`${beaconLabel}.${targetNamespace}`, tbaAddress, treasuryPrivateKey, effectiveController);
      if (!safe.safeAddress) throw new Error(safe.error ?? 'Safe creation failed.');
      safeAddress = safe.safeAddress;
      await verifySafeKeyExecution(gnosisKeyClient(), safeAddress as Address, tba.tbaAddress, tba.nftOwner);
    } catch (error: unknown) {
      return NextResponse.json({
        status: 'error', step: 'governance', beaconNft: beacon.beaconNft, safeAddress, tbaAddress,
        error: `${error instanceof Error ? error.message : 'Key governance verification failed.'} Retry with the same payment.`,
      }, { status: 502 });
    }

    // controller is always the human EOA (ownerWallet) — used to show inboxes in nftmail.box
    // The Safe is stored separately in the safe: field of acct-tier and nftmailgno records

    // ── Step 3d: Determine service tier ──
    // All BYO molts are paid (fee or coupon) → minimum lite tier.
    // POW NFT Gold trait → professional; POW NFT Silver trait → lite (same minimum).
    // Normie Agent type → professional; all else → lite.
    // Chonk/MoonCat/ENS: traits mutable or unavailable → lite (paid minimum).
    let accountTier = 'lite'; // minimum for any paid BYO molt
    try {
      const nftContract = contract;
      const nftChain = (NFT_CONTRACTS[type]?.chain ?? 'mainnet') as 'base' | 'mainnet' | 'gnosis';
      if (nftContract && (type === 'pownft' || type === 'normie')) {
        const traits = await fetchNftTraitsOnChain(nftContract, tokenId, nftChain);
        const traitTier = determineTierFromTraits(type, traits);
        if (traitTier === 'professional') accountTier = 'professional';
        console.log(`[byo-molt] ${type}#${tokenId} traits:`, JSON.stringify(traits), '→ traitTier:', traitTier, '→ accountTier:', accountTier);
      }
    } catch (err) {
      console.error('[byo-molt] trait fetch failed (keeping lite):', err);
    }

    // ── Step 4: Register aliases (both human + agent emails) ──
    // Human HITL email: chonk.123@nftmail.box (dot delimiter, no underscore)
    // Agent A2A email:  chonk.123_@nftmail.box (dot delimiter, trailing underscore)
    // ENS: eyemine@nftmail.box / eyemine_@nftmail.box
    // (The beacon NFT subname chonk-123.agent.gno uses hyphens — see beaconLabel.)
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
            headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
            body: JSON.stringify({
              action: 'createAlias', primaryName: finalPrimaryName, aliasLocalPart: humanLocalPart,
              collectionName: type, tokenId, ownerAddress: ownerWallet.toLowerCase(), displayEmail: 'human',
            }),
          }),
          fetch(NFTMAIL_WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
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
        headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
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
        headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
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
          headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
          body: JSON.stringify({
            action: 'kvPut',
            key: `tba:${finalPrimaryName}`,
            value: JSON.stringify({
              tbaAddress, sourceChainId: 100, nftType: 'gno-key', tokenId: String(beacon.beaconTokenId),
              contract: keyRegistrar, keyName: beacon.beaconNft, governance: 'shared-recovery',
              pairedNft: { sourceChainId: NFT_SOURCE_CHAIN_ID[type] ?? 1, contract, tokenId, nftType: type },
              storedAt: Date.now(),
            }),
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
            headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
            body: JSON.stringify({
              action: 'registerSovereign',
              secret: webhookSecret,
              label: humanLocalPart,
              controller: effectiveController,
              originNft: beacon.beaconNft,
              accountTier,
              safe: safeAddress ?? null,
            }),
          }),
          fetch(NFTMAIL_WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
            body: JSON.stringify({
              action: 'registerSovereign',
              secret: webhookSecret,
              label: agentLocalPart,
              controller: effectiveController,
              originNft: beacon.beaconNft,
              accountTier,
              safe: safeAddress ?? null,
            }),
          }),
        ]);

        // Also store TBA directly on the nftmailgno record so public agent lookups show it
        if (tbaAddress) {
          await Promise.all([
            fetch(NFTMAIL_WORKER_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
              body: JSON.stringify({
                action: 'setAgentRecord',
                secret: webhookSecret,
                agentName: humanLocalPart,
                tba: tbaAddress,
                ...(safeAddress ? { safe: safeAddress } : {}),
              }),
            }),
            fetch(NFTMAIL_WORKER_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
              body: JSON.stringify({
                action: 'setAgentRecord',
                secret: webhookSecret,
                agentName: agentLocalPart,
                tba: tbaAddress,
                ...(safeAddress ? { safe: safeAddress } : {}),
              }),
            }),
          ]);
        }
      } catch {
        // Non-fatal
      }
    }

    // ── Step 5b-ii: Generate ECIES keypair for the HITL human inbox (non-fatal) ──
    // Collection NFT molts provision a sovereign human inbox (humanLocalPart@nftmail.box).
    // upgradeTier auto-generates an ECIES keypair if none exists, enabling darkbox encryption
    // at LITE tier. Never log generated private keys.
    if (!isOverlay) {
      try {
        const eciesRes = await fetch(NFTMAIL_WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
          body: JSON.stringify({
            action: 'upgradeNinjaTier',
            label: humanLocalPart,
            newTier: accountTier,
            safe: safeAddress ?? null,
            secret: webhookSecret,
          }),
        });
        if (eciesRes.ok) {
          await eciesRes.json();
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
        const ENS_META_URL = `https://metadata.ens.domains/mainnet/${contract}/${tokenId}`;
        const imgRes = await fetch(ENS_META_URL);
        if (imgRes.ok) {
          const meta = await imgRes.json() as { image?: string; image_url?: string };
          originImageUrl = meta.image ?? meta.image_url ?? null;
        }
      } else {
        // Use on-chain tokenURI — no API key required, works from any origin
        const chain = (type === 'chonk' || type === 'normie') ? 'base' : 'mainnet';
        const nftContract = contract;
        if (nftContract) {
          const { imageUrl } = await fetchNftImageOnChain(nftContract, tokenId, chain);
          originImageUrl = imageUrl;
        }
      }
      if (originImageUrl) {
        await fetch(NFTMAIL_WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
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
      safeAddress,
      tbaAddress,
      governance: 'shared-recovery',
      keyNft: { chainId: 100, contract: keyRegistrar, tokenId: String(beacon.beaconTokenId), owner: effectiveController },
      executionCheck: 'simulation-passed',
      sourceNftTransferSync: false,
      erc8004AgentId,
      displayEmail: 'alias',
      message: `${humanLocalPart} key and Safe created — recovery signer retained`,
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
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
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
