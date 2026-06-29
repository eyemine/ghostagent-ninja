export interface EnvioMetadataEntity {
  tokenId: string;
  key: string;
  value: `0x${string}`;
}

export interface EnvioMetadataResponse {
  Metadata: EnvioMetadataEntity[];
}

export interface TokenSidecarState {
  contractAddress: `0x${string}`;
  tokenId: number;
  name: string;
  image: string;
  storyIpId?: `0x${string}`;
  storyLicenseId?: string;
  cdrVaultId?: string;
  cursorMandate?: string;
  cursorAgreementHash?: string;
  isRegistered: boolean;
  hasSidecarState: boolean;
}
