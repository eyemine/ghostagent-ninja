/**
 * @module genome-metadata
 * GhostAgent Genome NFT Metadata — per-SLD schema + placeholder image generator.
 *
 * "Genome" = the NFT metadata layer that describes an agent's identity, appearance,
 * and declared capabilities. Stored on IPFS, CID written into tokenURI.
 *
 * Separate from beacon-metadata (which tracks molt/evolve history).
 * Genome is mutable by the owner; beacon is append-only history.
 */

// ─── Per-SLD visual identity ──────────────────────────────────────────────────

export type SldKey = 'agent' | 'openclaw' | 'molt' | 'picoclaw' | 'vault' | 'nftmail';

export interface SldVisual {
  primaryColor: string;    // hex
  accentColor: string;     // hex
  bgColor: string;         // hex
  textColor: string;       // hex — subname overlay colour
  imageCid: string;        // Lighthouse IPFS CID for base image
  emoji: string;
  label: string;
  tagline: string;
}

export const SLD_VISUAL: Record<SldKey, SldVisual> = {
  'agent': {
    primaryColor: '#93c5fd',
    accentColor:  '#3b82f6',
    bgColor:      '#0a0f1a',
    textColor:    '#9dc4f8',
    imageCid:     'bafkreihdpulp5riv3dkhtomi2iurgeypvplhdsi3nnkumzmvx725xc4yly',
    emoji: '🤖',
    label: 'Agent',
    tagline: 'Full agent identity with evolve path',
  },
  'openclaw': {
    primaryColor: '#67e8f9',
    accentColor:  '#06b6d4',
    bgColor:      '#03111a',
    textColor:    '#f1a8b0',
    imageCid:     'bafkreigyk2c7gg5ijwvg4v6pyopcioatdjsfffvnkplgqyc2t3jowe3t7e',
    emoji: '🔍',
    label: 'OpenClaw',
    tagline: 'Open-claw public agent — full audit trail',
  },
  'molt': {
    primaryColor: '#f0abfc',
    accentColor:  '#d946ef',
    bgColor:      '#130818',
    textColor:    '#e6aff7',
    imageCid:     'bafkreicyrwnh4oxk4e53kly7kzmlpb345pqr5gd2v5acf4kcyl75e4hjdy',
    emoji: '🐛',
    label: 'Molt',
    tagline: 'Transition namespace during evolution',
  },
  'picoclaw': {
    primaryColor: '#fcd34d',
    accentColor:  '#f59e0b',
    bgColor:      '#130f00',
    textColor:    '#f4b55a',
    imageCid:     'bafkreic7ec6elxd7b425wpsovvgkumidkqsxmgj5ffnhp6icznagaqlgti',
    emoji: '🥚',
    label: 'PicoClaw',
    tagline: 'Larva agent — zero-cost entry',
  },
  'vault': {
    primaryColor: '#6ee7b7',
    accentColor:  '#10b981',
    bgColor:      '#011208',
    textColor:    '#8ee4ba',
    imageCid:     'bafkreibxujpkkylek6uznnl2d2d4vmpxi3aiowxyx2ydf5xo4xexcnksau',
    emoji: '👻',
    label: 'Vault',
    tagline: 'Pro agent — private, persistent, IP-protected',
  },
  'nftmail': {
    primaryColor: '#fda4af',
    accentColor:  '#f43f5e',
    bgColor:      '#130308',
    textColor:    '#8ae6f6',
    imageCid:     'bafkreiftlxmthuftcrcxa27jtsigsuf2s37dngcxpmqrnhefjaybstpscm',
    emoji: '🔒',
    label: 'NFTmail',
    tagline: 'NFT-gated encrypted inbox identity',
  },
};

// ─── Capability taxonomy ──────────────────────────────────────────────────────

export type CapabilityId =
  | 'email'      | 'trading'   | 'content'   | 'data'
  | 'social'     | 'coding'    | 'research'  | 'moderation'
  | 'scheduling' | 'payments'  | 'nft'       | 'governance'
  | 'customer-service' | 'translation' | 'summarisation';

export interface CapabilityDef {
  id: CapabilityId;
  label: string;
  description: string;
  requiresServerless: boolean;   // can run on CF Worker free tier?
  serverlessWarning?: string;    // shown if incompatible
  functionTemplate: AgentFunction;
}

export interface AgentFunction {
  name: string;
  description: string;
  input_schema: Record<string, { type: string; description: string; required?: boolean }>;
  output_schema: Record<string, { type: string; description: string }>;
  triggers: ('email' | 'webhook' | 'cron' | 'a2a')[];
}

export const CAPABILITIES: CapabilityDef[] = [
  {
    id: 'email',
    label: 'Email Agent',
    description: 'Reads, writes, classifies, and routes email via nftmail.box A2A protocol.',
    requiresServerless: true,
    functionTemplate: {
      name: 'handle_email',
      description: 'Process inbound email, classify intent, generate reply or forward.',
      input_schema: {
        from:    { type: 'string',  description: 'Sender email address', required: true },
        subject: { type: 'string',  description: 'Email subject line', required: true },
        body:    { type: 'string',  description: 'Plaintext email body', required: true },
      },
      output_schema: {
        action:  { type: 'string', description: 'reply | forward | archive | escalate' },
        content: { type: 'string', description: 'Reply body or forwarding note' },
      },
      triggers: ['email', 'a2a'],
    },
  },
  {
    id: 'trading',
    label: 'Trading / DeFi',
    description: 'Monitors prices, executes swaps, manages positions via Safe TBA.',
    requiresServerless: true,
    functionTemplate: {
      name: 'execute_trade',
      description: 'Evaluate signal and execute on-chain swap via agent Safe.',
      input_schema: {
        signal:   { type: 'string', description: 'Buy | Sell | Hold signal', required: true },
        token_in: { type: 'string', description: 'Input token address', required: true },
        amount:   { type: 'number', description: 'Amount in token_in units', required: true },
      },
      output_schema: {
        tx_hash: { type: 'string', description: 'On-chain transaction hash' },
        status:  { type: 'string', description: 'confirmed | pending | failed' },
      },
      triggers: ['cron', 'webhook', 'email'],
    },
  },
  {
    id: 'content',
    label: 'Content Creation',
    description: 'Generates written content, posts to Moltbook/Farcaster/X.',
    requiresServerless: true,
    functionTemplate: {
      name: 'create_content',
      description: 'Generate and publish content to one or more platforms.',
      input_schema: {
        topic:    { type: 'string', description: 'Topic or prompt', required: true },
        platform: { type: 'string', description: 'moltbook | farcaster | x | email' },
        style:    { type: 'string', description: 'Professional | casual | technical' },
      },
      output_schema: {
        content:    { type: 'string', description: 'Generated content' },
        post_url:   { type: 'string', description: 'Published URL if auto-posted' },
      },
      triggers: ['email', 'cron', 'a2a'],
    },
  },
  {
    id: 'data',
    label: 'Data Analysis',
    description: 'Fetches, transforms, and summarises structured data from APIs.',
    requiresServerless: true,
    functionTemplate: {
      name: 'analyse_data',
      description: 'Fetch data from a URL/API, transform, return summary.',
      input_schema: {
        source_url: { type: 'string', description: 'Data source URL', required: true },
        query:      { type: 'string', description: 'What to extract or compute', required: true },
      },
      output_schema: {
        summary: { type: 'string', description: 'Human-readable summary' },
        data:    { type: 'object', description: 'Structured result object' },
      },
      triggers: ['email', 'cron', 'webhook'],
    },
  },
  {
    id: 'social',
    label: 'Social Media',
    description: 'Monitors mentions, replies, engages across social platforms.',
    requiresServerless: true,
    functionTemplate: {
      name: 'social_engage',
      description: 'Detect mentions or prompts, craft engagement response.',
      input_schema: {
        platform: { type: 'string', description: 'farcaster | x | moltbook', required: true },
        trigger:  { type: 'string', description: 'Mention text or cast content', required: true },
      },
      output_schema: {
        reply:    { type: 'string', description: 'Composed reply text' },
        cast_url: { type: 'string', description: 'URL of published cast if sent' },
      },
      triggers: ['webhook', 'cron'],
    },
  },
  {
    id: 'coding',
    label: 'Code Generation',
    description: 'Writes, reviews, or debugs code snippets. No local execution.',
    requiresServerless: true,
    serverlessWarning: 'Code execution requires a sandboxed runtime — use Cloudflare Workers sandbox or E2B. Raw exec() is not available on CF Workers.',
    functionTemplate: {
      name: 'generate_code',
      description: 'Generate or review code based on a specification.',
      input_schema: {
        language: { type: 'string', description: 'Target language', required: true },
        spec:     { type: 'string', description: 'What the code should do', required: true },
      },
      output_schema: {
        code:       { type: 'string', description: 'Generated code' },
        explanation:{ type: 'string', description: 'Explanation of approach' },
      },
      triggers: ['email', 'a2a', 'webhook'],
    },
  },
  {
    id: 'research',
    label: 'Research',
    description: 'Web search, summarisation, and report generation.',
    requiresServerless: true,
    functionTemplate: {
      name: 'research_topic',
      description: 'Search, retrieve, and synthesise information on a topic.',
      input_schema: {
        topic:  { type: 'string', description: 'Research topic or question', required: true },
        depth:  { type: 'string', description: 'brief | standard | deep' },
        format: { type: 'string', description: 'bullet-points | prose | json' },
      },
      output_schema: {
        report: { type: 'string', description: 'Synthesised research report' },
        sources:{ type: 'array',  description: 'List of source URLs' },
      },
      triggers: ['email', 'a2a', 'cron'],
    },
  },
  {
    id: 'payments',
    label: 'Payments',
    description: 'Sends/receives xDAI or ERC-20 tokens via Safe TBA.',
    requiresServerless: true,
    functionTemplate: {
      name: 'send_payment',
      description: 'Execute on-chain payment via agent Safe TBA.',
      input_schema: {
        recipient: { type: 'string', description: 'Recipient EVM address', required: true },
        amount:    { type: 'number', description: 'Amount in token units', required: true },
        token:     { type: 'string', description: 'Token address or "native" for xDAI' },
        memo:      { type: 'string', description: 'Payment reference / memo' },
      },
      output_schema: {
        tx_hash: { type: 'string', description: 'On-chain transaction hash' },
        status:  { type: 'string', description: 'confirmed | pending | failed' },
      },
      triggers: ['email', 'a2a', 'webhook'],
    },
  },
  {
    id: 'scheduling',
    label: 'Scheduling',
    description: 'Time-based automation via Cloudflare Worker cron triggers.',
    requiresServerless: true,
    functionTemplate: {
      name: 'scheduled_task',
      description: 'Run a recurring task on a cron schedule.',
      input_schema: {
        task:     { type: 'string', description: 'What task to perform', required: true },
        schedule: { type: 'string', description: 'Cron expression e.g. */5 * * * *' },
      },
      output_schema: {
        result: { type: 'string', description: 'Task output summary' },
      },
      triggers: ['cron'],
    },
  },
  {
    id: 'nft',
    label: 'NFT Operations',
    description: 'Mints, transfers, queries NFTs on Gnosis/Base/Story via TBA.',
    requiresServerless: true,
    functionTemplate: {
      name: 'nft_operation',
      description: 'Perform an NFT operation (mint/transfer/query) on-chain.',
      input_schema: {
        operation: { type: 'string', description: 'mint | transfer | query', required: true },
        contract:  { type: 'string', description: 'NFT contract address', required: true },
        token_id:  { type: 'string', description: 'Token ID (for transfer/query)' },
      },
      output_schema: {
        tx_hash: { type: 'string', description: 'On-chain transaction hash if write op' },
        data:    { type: 'object', description: 'Query result if read op' },
      },
      triggers: ['email', 'a2a', 'webhook'],
    },
  },
  {
    id: 'governance',
    label: 'Governance',
    description: 'Monitors and votes on DAO proposals via Safe.',
    requiresServerless: true,
    functionTemplate: {
      name: 'governance_vote',
      description: 'Evaluate and vote on a DAO governance proposal.',
      input_schema: {
        proposal_id: { type: 'string', description: 'Proposal ID or URL', required: true },
        dao_address: { type: 'string', description: 'DAO contract address', required: true },
      },
      output_schema: {
        vote:    { type: 'string', description: 'yes | no | abstain' },
        tx_hash: { type: 'string', description: 'On-chain vote transaction hash' },
      },
      triggers: ['cron', 'webhook'],
    },
  },
  {
    id: 'customer-service',
    label: 'Customer Service',
    description: 'Handles inbound queries, triages tickets, drafts responses.',
    requiresServerless: true,
    functionTemplate: {
      name: 'handle_query',
      description: 'Classify and respond to a customer query.',
      input_schema: {
        query:    { type: 'string', description: 'Customer query text', required: true },
        context:  { type: 'string', description: 'Relevant product/service context' },
      },
      output_schema: {
        response:  { type: 'string', description: 'Drafted response' },
        escalate:  { type: 'boolean', description: 'Whether to escalate to human' },
        category:  { type: 'string', description: 'Query category label' },
      },
      triggers: ['email', 'a2a', 'webhook'],
    },
  },
  {
    id: 'translation',
    label: 'Translation',
    description: 'Translates text between languages via API.',
    requiresServerless: true,
    functionTemplate: {
      name: 'translate',
      description: 'Translate text to a target language.',
      input_schema: {
        text:        { type: 'string', description: 'Source text', required: true },
        target_lang: { type: 'string', description: 'Target language code e.g. es, fr, zh', required: true },
        source_lang: { type: 'string', description: 'Source language code (auto-detect if omitted)' },
      },
      output_schema: {
        translated: { type: 'string', description: 'Translated text' },
        detected:   { type: 'string', description: 'Detected source language' },
      },
      triggers: ['email', 'a2a'],
    },
  },
  {
    id: 'summarisation',
    label: 'Summarisation',
    description: 'Summarises documents, threads, or URLs on demand.',
    requiresServerless: true,
    functionTemplate: {
      name: 'summarise',
      description: 'Fetch and summarise a document, URL, or text.',
      input_schema: {
        source:  { type: 'string', description: 'URL or raw text to summarise', required: true },
        length:  { type: 'string', description: '1-sentence | short | detailed' },
        format:  { type: 'string', description: 'bullet | prose' },
      },
      output_schema: {
        summary: { type: 'string', description: 'Summary output' },
      },
      triggers: ['email', 'a2a', 'webhook'],
    },
  },
];

// ─── Serverless compatibility checker ────────────────────────────────────────

export interface ServerlessCheck {
  compatible: boolean;
  warnings: string[];
  blockers: string[];
}

const SERVERLESS_BLOCKERS: Partial<Record<CapabilityId, string>> = {
  // All current capabilities are CF Worker compatible — this map is for future capabilities
  // that might require local processes, GPUs, or persistent filesystems.
};

export function checkServerlessCompatibility(
  capabilityIds: CapabilityId[],
  brainType: 'cloudflare' | 'safe',
): ServerlessCheck {
  const warnings: string[] = [];
  const blockers: string[] = [];

  for (const id of capabilityIds) {
    const cap = CAPABILITIES.find(c => c.id === id);
    if (!cap) continue;

    if (SERVERLESS_BLOCKERS[id]) {
      blockers.push(`${cap.label}: ${SERVERLESS_BLOCKERS[id]}`);
    }
    if (cap.serverlessWarning && brainType === 'cloudflare') {
      warnings.push(`${cap.label}: ${cap.serverlessWarning}`);
    }
  }

  // Brain-type specific checks
  if (brainType === 'cloudflare') {
    const onChainCaps = capabilityIds.filter(id =>
      ['trading', 'payments', 'nft', 'governance'].includes(id)
    );
    if (onChainCaps.length > 0) {
      warnings.push(
        `On-chain capabilities (${onChainCaps.join(', ')}) require your CF Worker to call your Safe TBA — ensure SAFE_ADDRESS and RPC_URL are set as Worker secrets.`
      );
    }
  }

  if (brainType === 'safe') {
    const asyncCaps = capabilityIds.filter(id =>
      ['email', 'social', 'content', 'research', 'summarisation', 'translation'].includes(id)
    );
    if (asyncCaps.length > 0) {
      warnings.push(
        `Safe Module brains execute synchronously on-chain — async capabilities (${asyncCaps.join(', ')}) should use an off-chain relay or oracle pattern.`
      );
    }
  }

  return { compatible: blockers.length === 0, warnings, blockers };
}

// ─── Genome NFT Metadata schema ───────────────────────────────────────────────

export interface GenomeMetadata {
  agentName: string;
  displayName: string;
  sld: SldKey;
  fullName: string;             // e.g. "paymastr.agent.gno"
  tagline: string;              // short one-liner
  description: string;          // longer bio / purpose (used in install-brain)
  imageUri: string;             // ipfs://CID or data:image/svg+xml;base64,…
  imageCid: string | null;      // null = placeholder SVG
  capabilities: CapabilityId[];
  functionSchema: AgentFunction[];
  serverlessCompatible: boolean | null;  // null = not yet checked
  createdAt: number;
  updatedAt: number;
}

export function defaultGenomeMetadata(
  agentName: string,
  sld: SldKey,
  tld = 'gno',
): GenomeMetadata {
  const visual = SLD_VISUAL[sld];
  const fullName = `${agentName}.${sld}.${tld}`;
  return {
    agentName,
    displayName: fullName,
    sld,
    fullName,
    tagline: visual.tagline,
    description: '',
    imageUri: generatePlaceholderSvg(agentName, sld),
    imageCid: null,
    capabilities: [],
    functionSchema: [],
    serverlessCompatible: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ─── Story IPA Metadata builder ──────────────────────────────────────────────
// Produces a Story Protocol-compliant IPA metadata JSON object.
// Pass imageCid + characterFileCid when available (post-Lighthouse pin).
// Pass null to fall back to the SLD base image CID + empty character file.

const IPFS_PREFIX = 'https://gateway.lighthouse.storage/ipfs';

export interface IpaMetadata {
  title: string;
  description: string;
  createdAt: string;
  creators: { name: string; address: string; contributionPercent: number }[];
  image: string;
  imageHash: string;
  mediaUrl: string;
  mediaHash: string;
  mediaType: string;
  aiMetadata: {
    characterFileUrl: string;
    characterFileHash: string;
    socialLegalCid?: string;
  };
  ipType: 'AI Agent';
  tags: string[];
}

/**
 * Build Story IPA metadata for an agent mint.
 *
 * @param agentName       e.g. "ghostagent"
 * @param sld             e.g. "molt"
 * @param ownerAddress    minting wallet / Safe address
 * @param imageCid        Lighthouse CID of the composited NFT image (null → use SLD base)
 * @param imageHash       keccak256 hex of the image (null → use placeholder)
 * @param characterFileCid  Lighthouse CID of GenomeMetadata JSON (null → use SLD base)
 * @param characterFileHash keccak256 hex of the character file (null → placeholder)
 * @param tld             default "gno"
 */
export function buildIpaMetadata(params: {
  agentName: string;
  sld: SldKey;
  ownerAddress: string;
  imageCid?: string | null;
  imageHash?: string | null;
  characterFileCid?: string | null;
  characterFileHash?: string | null;
  socialLegalCid?: string | null;
  tld?: string;
}): IpaMetadata {
  const {
    agentName, sld, ownerAddress,
    imageCid, imageHash,
    characterFileCid, characterFileHash,
    socialLegalCid,
    tld = 'gno',
  } = params;

  const visual    = SLD_VISUAL[sld];
  const fullName  = `${agentName}.${sld}.${tld}`;
  const resolvedImageCid  = imageCid  ?? visual.imageCid;
  const resolvedCharCid   = characterFileCid ?? visual.imageCid; // fallback to base image CID

  return {
    title:       fullName,
    description: `${visual.label} AI Agent registered on Story Protocol via GhostAgent. Sovereign identity: ${fullName}`,
    createdAt:   String(Math.floor(Date.now() / 1000)),
    creators: [{
      name:                ownerAddress,
      address:             ownerAddress,
      contributionPercent: 100,
    }],
    image:     `${IPFS_PREFIX}/${resolvedImageCid}`,
    imageHash: imageHash ?? '0x0000000000000000000000000000000000000000000000000000000000000000',
    mediaUrl:  `${IPFS_PREFIX}/${resolvedImageCid}`,
    mediaHash: imageHash ?? '0x0000000000000000000000000000000000000000000000000000000000000000',
    mediaType: 'image/svg+xml',
    aiMetadata: {
      characterFileUrl:  `${IPFS_PREFIX}/${resolvedCharCid}`,
      characterFileHash: characterFileHash ?? '0x0000000000000000000000000000000000000000000000000000000000000000',
      ...(socialLegalCid ? { socialLegalCid } : {}),
    },
    ipType: 'AI Agent',
    tags: ['AI Agent', `${sld}.gno`, agentName, 'ghostagent', 'nftmail.box'],
  };
}

// ─── NFT image compositor ─────────────────────────────────────────────────────
// Composites the subname label over the top 25% of the SLD base image.
// Font: Courier New 70pt, colour = SLD textColor.
// Scales down linearly for names longer than 10 characters.
// Image dimensions: 1000×1000 (matching Lighthouse source images).

const IMAGE_W = 1000;
const IMAGE_H = 1000;
const OVERLAY_H = IMAGE_H * 0.25;   // top 25% = 250px
const BASE_FONT_SIZE = 70;           // pt ≈ px in SVG
const MAX_CHARS_FULL = 10;           // no scaling below this length
const GATEWAY = 'https://gateway.lighthouse.storage/ipfs';

/**
 * Returns an SVG string (NOT a data URI) compositing the SLD base image
 * with the subname label overlaid in the top 25%.
 *
 * Pass `imageDataUri` (base64 PNG/JPEG) when the base image has been
 * pre-fetched server-side; omit to fall back to a remote href (works in
 * browsers and server environments that allow external image references).
 */
export function generateSubnameSvg(
  subname: string,
  sld: SldKey,
  imageDataUri?: string,
): string {
  const v = SLD_VISUAL[sld];
  const imageHref = imageDataUri ?? `${GATEWAY}/${v.imageCid}`;

  // Scale font down for names longer than MAX_CHARS_FULL
  const len = subname.length;
  const fontSize = len <= MAX_CHARS_FULL
    ? BASE_FONT_SIZE
    : Math.max(24, Math.floor(BASE_FONT_SIZE * (MAX_CHARS_FULL / len)));

  // Vertical centre of the top-25% band
  const textY = Math.round(OVERLAY_H / 2);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
    `     width="${IMAGE_W}" height="${IMAGE_H}" viewBox="0 0 ${IMAGE_W} ${IMAGE_H}">`,
    `  <!-- Base image -->`,
    `  <image href="${imageHref}" x="0" y="0" width="${IMAGE_W}" height="${IMAGE_H}" preserveAspectRatio="xMidYMid slice"/>`,
    `  <!-- Subname overlay in top 25% -->`,
    `  <text`,
    `    x="${IMAGE_W / 2}"`,
    `    y="${textY}"`,
    `    text-anchor="middle"`,
    `    dominant-baseline="middle"`,
    `    font-family="'Courier New', Courier, monospace"`,
    `    font-size="${fontSize}"`,
    `    font-weight="bold"`,
    `    fill="${v.textColor}"`,
    `  >${subname}</text>`,
    `</svg>`,
  ].join('\n');
}

/** Legacy helper retained for backwards-compat — generates a standalone SVG
 *  with no base image (used as fallback when no IPFS CID is set). */
export function generatePlaceholderSvg(agentName: string, sld: SldKey): string {
  const v = SLD_VISUAL[sld];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="${v.accentColor}" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="${v.bgColor}" stop-opacity="1"/>
    </radialGradient>
  </defs>
  <rect width="400" height="400" fill="url(#bg)"/>
  <rect x="1" y="1" width="398" height="398" rx="24" fill="none" stroke="${v.primaryColor}" stroke-width="1.5" stroke-opacity="0.35"/>
  <circle cx="200" cy="170" r="72" fill="${v.accentColor}" fill-opacity="0.07" stroke="${v.primaryColor}" stroke-width="1" stroke-opacity="0.25"/>
  <circle cx="200" cy="170" r="54" fill="${v.accentColor}" fill-opacity="0.12"/>
  <text x="200" y="190" text-anchor="middle" font-size="52" dominant-baseline="middle">${v.emoji}</text>
  <circle cx="200" cy="170" r="72" fill="none" stroke="${v.primaryColor}" stroke-width="0.5" stroke-opacity="0.15"/>
  <text x="200" y="268" text-anchor="middle" font-family="'Courier New', Courier, monospace" font-size="20" font-weight="bold" fill="${v.primaryColor}">${agentName}</text>
  <rect x="140" y="282" width="120" height="20" rx="10" fill="${v.accentColor}" fill-opacity="0.18"/>
  <text x="200" y="296" text-anchor="middle" font-family="'Courier New', Courier, monospace" font-size="10" fill="${v.primaryColor}" opacity="0.9">${sld}.gno</text>
  <text x="200" y="334" text-anchor="middle" font-family="'Courier New', Courier, monospace" font-size="9" fill="${v.primaryColor}" opacity="0.5">${v.label} Agent</text>
  <text x="200" y="380" text-anchor="middle" font-family="'Courier New', Courier, monospace" font-size="8" fill="#3f3f46">GhostAgent Genome NFT · nftmail.box</text>
</svg>`;

  if (typeof Buffer !== 'undefined') {
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
