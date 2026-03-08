/// ERC-8004 Agent Registration JSON builder
/// Spec: https://eips.ethereum.org/EIPS/eip-8004#registration-v1
///
/// Produces the off-chain JSON payload that gets pinned to IPFS/Lighthouse
/// and referenced by agentURI on the Identity Registry.

import { SLD_VISUAL, type SldKey } from './genome-metadata';

export const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nftmail.box';
export const IPFS_GATEWAY = 'https://gateway.lighthouse.storage/ipfs';

// ─── ERC-8004 Contract Addresses ─────────────────────────────────────────────
// Same addresses on all mainnets; same addresses (different) on all testnets.

export const ERC8004_ADDRESSES = {
  mainnet: {
    identityRegistry:   '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const,
    reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63' as const,
    validationRegistry: '0x8004Cb1BF31DAf7788923b405b754f57acEB4272' as const,
  },
  testnet: {
    identityRegistry:   '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const,
    reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713' as const,
    validationRegistry: '0x8004Cb1BF31DAf7788923b405b754f57acEB4272' as const,
  },
} as const;

// Gnosis mainnet (chainId 100) — where GhostAgents live
export const GNOSIS_ADDRESSES = ERC8004_ADDRESSES.mainnet;
export const GNOSIS_CHAIN_ID = 100;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Erc8004Service {
  name: string;
  endpoint: string;
  version?: string;
}

export interface Erc8004Registration {
  agentId: number;
  agentRegistry: string;  // "eip155:{chainId}:{registryAddress}"
}

export interface Erc8004RegistrationFile {
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1';
  name: string;
  description: string;
  image: string;
  services: Erc8004Service[];
  x402Support: boolean;
  active: boolean;
  supportedTrust: string[];
  registrations: Erc8004Registration[];
}

// ─── Builder ─────────────────────────────────────────────────────────────────

/**
 * Build an ERC-8004 #registration-v1 JSON for a GhostAgent subname.
 *
 * @param agentName   e.g. "ghostagent"
 * @param sld         e.g. "molt"
 * @param agentId     on-chain agentId from Identity Registry (0 if not yet registered)
 * @param imageCid    Lighthouse CID of the NFT image (null → use SLD base image)
 * @param tld         default "gno"
 * @param chainId     default 100 (Gnosis)
 */
export function buildErc8004RegistrationFile(params: {
  agentName: string;
  sld: SldKey;
  agentId?: number;
  imageCid?: string | null;
  tld?: string;
  chainId?: number;
}): Erc8004RegistrationFile {
  const {
    agentName,
    sld,
    agentId = 0,
    imageCid,
    tld = 'gno',
    chainId = GNOSIS_CHAIN_ID,
  } = params;

  const visual    = SLD_VISUAL[sld];
  const fullName  = `${agentName}.${sld}.${tld}`;
  const agentEmail = `${agentName}@nftmail.box`;
  const agentWeb   = `${APP_DOMAIN}/agent/${agentName}`;
  const resolvedImageCid = imageCid ?? visual.imageCid;
  const registryAddr = GNOSIS_ADDRESSES.identityRegistry;

  const services: Erc8004Service[] = [
    {
      name:     'web',
      endpoint: agentWeb,
    },
    {
      name:     'A2A',
      endpoint: `${APP_DOMAIN}/.well-known/agent-card.json?agent=${agentName}&sld=${sld}`,
      version:  '0.3.0',
    },
    {
      name:     'email',
      endpoint: agentEmail,
    },
  ];

  const registrations: Erc8004Registration[] = agentId > 0
    ? [{ agentId, agentRegistry: `eip155:${chainId}:${registryAddr}` }]
    : [];

  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: fullName,
    description: `${visual.label} AI Agent on GhostAgent Protocol. Sovereign identity: ${fullName}. ${visual.tagline}`,
    image: `${IPFS_GATEWAY}/${resolvedImageCid}`,
    services,
    x402Support: false,
    active: true,
    supportedTrust: ['reputation'],
    registrations,
  };
}

/**
 * After on-chain registration, patch in the agentId + agentRegistry
 * so the file stored on IPFS has accurate back-references.
 */
export function patchRegistrationWithAgentId(
  file: Erc8004RegistrationFile,
  agentId: number,
  chainId: number = GNOSIS_CHAIN_ID,
): Erc8004RegistrationFile {
  const registryAddr = GNOSIS_ADDRESSES.identityRegistry;
  return {
    ...file,
    registrations: [{ agentId, agentRegistry: `eip155:${chainId}:${registryAddr}` }],
  };
}

/**
 * Build the agentRegistry string for this chain.
 */
export function agentRegistryString(chainId: number = GNOSIS_CHAIN_ID): string {
  return `eip155:${chainId}:${GNOSIS_ADDRESSES.identityRegistry}`;
}
