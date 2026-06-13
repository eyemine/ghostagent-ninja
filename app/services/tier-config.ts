export type CollectionSlug = 'fakenormies' | 'normies' | 'default';
export type TierName = 'Basic' | 'Pro' | 'Premium';

export interface DelegationConfig {
  enabled: boolean;
  type?: 'mock_safe' | 'real_safe';
}

export interface TierConfig {
  price: string;
  sendsPerDay: number | typeof Infinity;
  chatMessagesPerDay: number | typeof Infinity;
  delegation: DelegationConfig;
  treasury: boolean | { enabled: boolean; safeManaged?: boolean };
  apiAccess: boolean;
  watermark: boolean;
  features: string[];
}

export type CollectionTiers = Partial<Record<TierName, TierConfig>>;

const COLLECTION_TIER_CONFIG: Record<CollectionSlug, CollectionTiers> = {
  fakenormies: {
    Basic: {
      price: 'Free with NFT',
      sendsPerDay: 10,
      chatMessagesPerDay: 10,
      delegation: { enabled: true, type: 'mock_safe' },
      treasury: false,
      apiAccess: false,
      watermark: false,
      features: [
        'nftmail.box email (10 sends/day)',
        'Chat (10 messages/day)',
        'Basic delegation (demo mode)',
        '.agent.gno identity',
        'View agent dashboard',
      ],
    },
    Pro: {
      price: '10 USDC (one-time)',
      sendsPerDay: 50,
      chatMessagesPerDay: Infinity,
      delegation: { enabled: true, type: 'real_safe' },
      treasury: false,
      apiAccess: true,
      watermark: false,
      features: [
        'Full email (50/day)',
        'Unlimited chat',
        'Real Safe delegation',
        'Profile customization',
        'Basic API access',
      ],
    },
    Premium: {
      price: '24 USDC (annual)',
      sendsPerDay: Infinity,
      chatMessagesPerDay: Infinity,
      delegation: { enabled: true, type: 'real_safe' },
      treasury: { enabled: true, safeManaged: true },
      apiAccess: true,
      watermark: false,
      features: [
        'All Pro features',
        'Unlimited everything',
        'Treasury access',
        'CDR vault encryption',
        'Story Protocol integration',
        'Multi-agent management',
      ],
    },
  },

  normies: {
    Basic: {
      price: 'Free with NFT',
      sendsPerDay: 10,
      chatMessagesPerDay: 10,
      delegation: { enabled: false },
      treasury: false,
      apiAccess: false,
      watermark: true,
      features: [
        'nftmail.box email (10 sends/day)',
        'Chat (10 messages/day)',
        '.agent.gno identity',
        'View agent dashboard',
      ],
    },
    Pro: {
      price: '10 USDC (one-time)',
      sendsPerDay: 50,
      chatMessagesPerDay: Infinity,
      delegation: { enabled: false },
      treasury: false,
      apiAccess: true,
      watermark: false,
      features: [
        'Full email (50/day)',
        'Unlimited chat',
        'Profile customization',
        'Agent settings',
        'Basic API access',
      ],
    },
    Premium: {
      price: '24 USDC (annual)',
      sendsPerDay: Infinity,
      chatMessagesPerDay: Infinity,
      delegation: { enabled: true, type: 'real_safe' },
      treasury: { enabled: true, safeManaged: true },
      apiAccess: true,
      watermark: false,
      features: [
        'All Pro features',
        'Unlimited everything',
        'Full Safe delegation (hot wallet)',
        'Treasury access',
        'CDR vault encryption',
        'Story Protocol integration',
        'Priority support',
        'Multi-agent management',
      ],
    },
  },

  default: {
    Basic: {
      price: 'Free with NFT',
      sendsPerDay: 10,
      chatMessagesPerDay: 10,
      delegation: { enabled: false },
      treasury: false,
      apiAccess: false,
      watermark: true,
      features: ['nftmail.box email (10 sends/day)', 'Chat (10 messages/day)', '.agent.gno identity'],
    },
    Pro: {
      price: '10 USDC (one-time)',
      sendsPerDay: 50,
      chatMessagesPerDay: Infinity,
      delegation: { enabled: false },
      treasury: false,
      apiAccess: true,
      watermark: false,
      features: ['Full email (50/day)', 'Unlimited chat', 'API access'],
    },
    Premium: {
      price: '24 USDC (annual)',
      sendsPerDay: Infinity,
      chatMessagesPerDay: Infinity,
      delegation: { enabled: true, type: 'real_safe' },
      treasury: { enabled: true },
      apiAccess: true,
      watermark: false,
      features: ['Unlimited everything', 'Full Safe delegation', 'Treasury access'],
    },
  },
};

export function getTierConfig(collectionSlug: string, tier: TierName): TierConfig | undefined {
  const key: CollectionSlug =
    collectionSlug === 'fakenormies' || collectionSlug === 'normies' ? collectionSlug : 'default';
  return COLLECTION_TIER_CONFIG[key][tier];
}

export function canAccessFeature(
  collectionSlug: string,
  tierIndex: 0 | 1 | 2,
  feature: 'email_send' | 'chat' | 'delegation' | 'treasury' | 'cdr_vault' | 'api_access'
): boolean {
  const isFakeNormie = collectionSlug === 'fakenormies';
  switch (feature) {
    case 'email_send': return true;
    case 'chat':       return true;
    case 'delegation': return isFakeNormie ? true : tierIndex >= 2;
    case 'treasury':   return tierIndex >= 2;
    case 'cdr_vault':  return tierIndex >= 2;
    case 'api_access': return tierIndex >= 1;
    default:           return true;
  }
}
