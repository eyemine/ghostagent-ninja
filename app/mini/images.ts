// Image constants for the Farcaster mini app (nftmail.box)
// All URLs are pinned to IPFS for CDN distribution

export const LOGO_URL = 'https://moccasin-useful-vole-840.mypinata.cloud/ipfs/bafkreicx5r5qfonzdmnhkeblrfbhaj7gcbgc34g6kvkh7hbxypd54qqx3a';
export const LOADING_LOGO_URL = LOGO_URL;
export const MAILBOX_ICON_URL = 'https://moccasin-useful-vole-840.mypinata.cloud/ipfs/bafkreicx5r5qfonzdmnhkeblrfbhaj7gcbgc34g6kvkh7hbxypd54qqx3a';
export const EMPTY_INBOX_URL = 'https://moccasin-useful-vole-840.mypinata.cloud/ipfs/bafkreicx5r5qfonzdmnhkeblrfbhaj7gcbgc34g6kvkh7hbxypd54qqx3a';

// Tier images (unused in current UI but reserved for future expansion)
export const TIER_IMAGES = {
  free: LOGO_URL,
  pro: LOGO_URL,
  premium: LOGO_URL,
} as const;
