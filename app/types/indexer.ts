export interface Erc8048RawState {
  tokenId: string;
  key: string;
  value: `0x${string}`;
}

export interface ChonkPodMetadata {
  tokenId: number;
  name: string;
  image: string;
  storyIpId?: `0x${string}`;
  storyLicenseId?: string;
  cdrVaultId?: string;
  isRegistered: boolean;
  hasVault: boolean;
}

export interface EnvioMetadataResponse {
  Metadata: Array<{
    tokenId: string;
    key: string;
    value: string;
  }>;
}
