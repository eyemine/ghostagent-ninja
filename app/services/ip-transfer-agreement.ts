/// @module ip-transfer-agreement
/// Generates EIP-712 typed data for marketplace IP transfer agreements.
/// The signed hash is pinned to IPFS and logged to GlassBox.

export const AGREEMENT_VERSION = 'v1.0-2026-03-09';
export const CHAIN_ID = 100; // Gnosis Chain

// ── EIP-712 domain ────────────────────────────────────────────────────────────

export const EIP712_DOMAIN = {
  name: 'GhostAgent Marketplace',
  version: '1',
  chainId: CHAIN_ID,
} as const;

export const EIP712_TYPES = {
  IPTransferAgreement: [
    { name: 'agentName',        type: 'string'  },
    { name: 'safeAddress',      type: 'address' },
    { name: 'listingPriceXdai', type: 'uint256' },
    { name: 'seller',           type: 'address' },
    { name: 'agreementVersion', type: 'string'  },
    { name: 'agreementHash',    type: 'bytes32' },
    { name: 'timestamp',        type: 'uint256' },
  ],
} as const;

// ── Agreement text generator ──────────────────────────────────────────────────

export interface AgreementParams {
  agentName: string;
  safeAddress: string;
  listingPriceXdai: number;
  seller: string;
}

export interface AgreementDocument {
  text: string;
  textHash: string; // keccak256 of text as hex string
  params: AgreementParams;
  timestamp: number;
  version: string;
}

export function buildAgreementText(p: AgreementParams, timestamp: number): string {
  const date = new Date(timestamp).toISOString();
  return `MARKETPLACE IP TRANSFER AGREEMENT
Version: ${AGREEMENT_VERSION}
Date: ${date}

PARTIES:
  Transferor (Seller): ${p.seller}
  Transferee (Buyer):  [wallet completing purchase transaction]
  Platform:            GhostAgent.ninja, operated by Eyemine Pty Ltd, Australia

ASSET BEING TRANSFERRED:
  Agent Identity:    ${p.agentName}
  Gnosis Safe:       ${p.safeAddress}
  Listing Price:     ${p.listingPriceXdai} xDAI

TERMS:

1. TRANSFER OF OWNERSHIP
The Seller hereby agrees to transfer to the Buyer full legal and beneficial ownership of:
(a) the AI agent identity "${p.agentName}" including its on-chain subname registration,
    associated NFT, and all metadata;
(b) all intellectual property rights subsisting in or associated with "${p.agentName}"
    owned by or exclusively licenced to the Seller, to the extent transferable;
(c) ownership and control of the Gnosis Safe at ${p.safeAddress}, including all digital
    assets held therein at the time of transfer.

2. BLOCKCHAIN EXECUTION AS LEGAL INSTRUMENT
The Seller's EIP-712 cryptographic signature of this Agreement, combined with the
on-chain purchase transaction by the Buyer, constitutes a binding written agreement
under the Electronic Transactions Act 1999 (Cth) and the Electronic Transactions
Act 2000 (NSW). This Agreement is intended to constitute an effective assignment of
intellectual property rights under section 197 of the Copyright Act 1968 (Cth).

3. WARRANTIES BY SELLER
The Seller warrants that:
(a) They are the sole legal and beneficial owner of the agent identity and Gnosis Safe;
(b) The assets are free from encumbrances, liens, and third-party claims;
(c) They have full authority to enter into and perform this Agreement;
(d) No third party holds any exclusive licence over the transferred IP.

4. LIMITATIONS
GhostAgent.ninja provides only technical infrastructure and accepts no liability for
disputes between Seller and Buyer. This Agreement does not warrant transfer of IP
rights the Seller does not own, including rights in third-party AI models or
Story Protocol licence terms. Both parties are advised to seek independent legal advice.

5. MORAL RIGHTS NOTICE (COPYRIGHT ACT 1968 (CTH) PART IX)
Under the Copyright Act 1968 (Cth) Part IX, authors have the following moral rights:
(a) RIGHT OF ATTRIBUTION: the right to be credited as the author of the work;
(b) RIGHT AGAINST FALSE ATTRIBUTION: the right not to have authorship falsely attributed;
(c) RIGHT OF INTEGRITY: the right not to have the work subjected to derogatory treatment.

These rights cannot be transferred but may be waived in writing. By signing this
Agreement, the Seller irrevocably waives all moral rights in the transferred IP assets
to the extent permissible under Australian law. Where moral rights cannot be waived,
the Seller agrees not to enforce them against the Buyer, the Platform, or any licensees.

6. GOVERNING LAW
This Agreement is governed by the laws of New South Wales, Australia.

IPFS RECORD: This agreement text is permanently pinned to IPFS.
GLASSBOX AUDIT: Signature hash is logged to the GlassBox audit trail.`;
}

export async function hashText(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function buildAgreementDocument(p: AgreementParams): Promise<AgreementDocument> {
  const timestamp = Date.now();
  const text = buildAgreementText(p, timestamp);
  const textHash = await hashText(text);
  return { text, textHash, params: p, timestamp, version: AGREEMENT_VERSION };
}

// ── EIP-712 message builder ───────────────────────────────────────────────────

export function buildEIP712Message(doc: AgreementDocument) {
  return {
    agentName:        doc.params.agentName,
    safeAddress:      doc.params.safeAddress as `0x${string}`,
    listingPriceXdai: BigInt(Math.round(doc.params.listingPriceXdai * 1e18)),
    seller:           doc.params.seller as `0x${string}`,
    agreementVersion: doc.version,
    agreementHash:    doc.textHash as `0x${string}`,
    timestamp:        BigInt(doc.timestamp),
  };
}

// ── IPFS pin via Lighthouse ───────────────────────────────────────────────────

export async function pinAgreementToIPFS(
  doc: AgreementDocument,
  signature: string
): Promise<string> {
  const payload = {
    agreementVersion: doc.version,
    agentName: doc.params.agentName,
    safeAddress: doc.params.safeAddress,
    listingPriceXdai: doc.params.listingPriceXdai,
    seller: doc.params.seller,
    timestamp: doc.timestamp,
    agreementText: doc.text,
    textHash: doc.textHash,
    eip712Signature: signature,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const form = new FormData();
  form.append('file', blob, `ip-transfer-${doc.params.agentName}-${doc.timestamp}.json`);

  const apiKey = process.env.LIGHTHOUSE_API_KEY;
  if (!apiKey) throw new Error('LIGHTHOUSE_API_KEY not set');

  const res = await fetch('https://node.lighthouse.storage/api/v0/add', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) throw new Error(`Lighthouse pin failed: ${res.status}`);
  const data = await res.json() as { Hash: string };
  return `ipfs://${data.Hash}`;
}

// ── GlassBox log ──────────────────────────────────────────────────────────────

export async function logAgreementToGlassBox(opts: {
  agentName: string;
  tld: string;
  seller: string;
  textHash: string;
  ipfsCid: string;
  signature: string;
}): Promise<void> {
  const contentHash = await hashText(opts.signature + opts.ipfsCid);
  await fetch('/api/glassbox/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentName: opts.agentName,
      tld: opts.tld,
      eventType: 'molt-transition', // closest existing type — reuse for listing events
      contentHash,
      xmtpEnabled: false,
      enhancedLogging: true,
      walletAddress: opts.seller,
      subject: `IP Transfer Agreement signed — ${opts.agentName}`,
      protocol: 'email' as const,
      from: opts.seller,
      to: 'marketplace',
    }),
  });
}

// ── Listing record ────────────────────────────────────────────────────────────

export interface ListingRecord {
  agentName: string;
  safeAddress: string;
  listingPriceXdai: number;
  seller: string;
  namespace: string;
  signature: string;
  agreementHash: string;
  ipfsCid: string;
  timestamp: number;
  version: string;
}
