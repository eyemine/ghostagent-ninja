/// scripts/setup-aeneid-redhammer.ts
///
/// HACKATHON SETUP — Story Protocol Aeneid Testnet (Chain 1315)
/// Registers PlaceholderChonk #697 as IP Asset, attaches Commercial Remix PIL,
/// and mints license token to operator wallet.
///
/// Required env vars (add to .env.local):
///   CDR_OPERATOR_PRIVATE_KEY  — operator wallet private key (0x...)
///   AENEID_NFT_CONTRACT         — PlaceholderChonk.sol address from Remix deploy
///
/// Outputs (add all three to .env.local):
///   AENEID_RED_HAMMER_IP_ID
///   SHARED_LICENSE_TERMS_ID
///   RED_HAMMER_LICENSE_TOKEN_ID

import 'dotenv/config';
import { StoryClient } from '@story-protocol/core-sdk';

import { http, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const operatorKey = process.env.CDR_OPERATOR_PRIVATE_KEY as `0x${string}`;
const account = privateKeyToAccount(operatorKey);
const operator = account.address;

const client = StoryClient.newClient({
  account,
  transport: http(process.env.STORY_AENEID_RPC_URL ?? 'https://aeneid.storyrpc.io'),
  chainId: 'aeneid',
});

const MOCK_NFT = process.env.AENEID_NFT_CONTRACT as `0x${string}`;

async function main() {
  if (!MOCK_NFT || MOCK_NFT === zeroAddress) throw new Error('Set AENEID_NFT_CONTRACT first');
  console.log('Operator:', operator);
  console.log('NFT Contract:', MOCK_NFT);

  const ipResponse = await client.ipAsset.register({
    nftContract: MOCK_NFT,
    tokenId: BigInt(697),
    ipMetadata: {
      ipMetadataURI: 'https://ghostagent.ninja/metadata/redhammer-aeneid.json',
      ipMetadataHash: '0x' + '0'.repeat(64),
      nftMetadataHash: '0x' + '0'.repeat(64),
    },
    txOptions: { waitForTransaction: true },
  });

  const ipId = ipResponse.ipId as `0x${string}`;
  console.log('IP_ID:', ipId);

  let licenseTermsId: string | bigint;
  try {
    const pilResponse = await (client.license as any).registerCommercialRemixPIL({
      mintingFee: 0n,
      commercialRevShare: 5,
      currency: zeroAddress,
      txOptions: { waitForTransaction: true },
    });
    licenseTermsId = pilResponse.licenseTermsId;
  } catch (e) {
    console.log('Commercial PIL failed, using non-commercial social remixing fallback...');
    const ncResponse = await (client.license as any).registerNonCommercialSocialRemixingPIL({
      txOptions: { waitForTransaction: true }
    });
    licenseTermsId = ncResponse.licenseTermsId;
    console.log('Non-commercial license terms registered:', licenseTermsId);
     }

  console.log('LICENSE_TERMS_ID:', licenseTermsId);

  await client.license.attachLicenseTerms({
    ipId,
    licenseTermsId: BigInt(licenseTermsId),
    txOptions: { waitForTransaction: true },
  });

  const mintResponse = await client.license.mintLicenseTokens({
    licensorIpId: ipId,
    licenseTermsId: BigInt(licenseTermsId),
    amount: 1n,
    receiver: operator,
    txOptions: { waitForTransaction: true },
  });

  const licenseTokenId = (mintResponse as any).licenseTokenId;

  console.log('\n=== AENEID SETUP COMPLETE ===');
  console.log('AENEID_RED_HAMMER_IP_ID=' + ipId);
  console.log('export SHARED_LICENSE_TERMS_ID=' + licenseTermsId);
  console.log('export RED_HAMMER_LICENSE_TOKEN_ID=' + licenseTokenId);
}

main().catch(console.error);