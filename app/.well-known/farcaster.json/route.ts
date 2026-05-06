import { NextResponse } from 'next/server';

// Farcaster Mini App manifest — https://miniapps.farcaster.xyz/docs/specification
// accountAssociation must be generated via Warpcast developer tools:
// https://farcaster.xyz/~/settings/developer-tools
// Sign domain "ghostagent.ninja" with the custody wallet for ghostagent.eth

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';

export async function GET() {
  const manifest = {
    accountAssociation: {
      // TODO: Replace with real signature from Warpcast developer tools
      // Steps: farcaster.xyz/~/settings/developer-tools → Generate domain manifest → domain: ghostagent.ninja
      header: process.env.FARCASTER_MANIFEST_HEADER || '',
      payload: process.env.FARCASTER_MANIFEST_PAYLOAD || '',
      signature: process.env.FARCASTER_MANIFEST_SIGNATURE || '',
    },
    miniapp: {
      version: '1',
      name: 'nftmail.box',
      iconUrl: `${APP_URL}/icon.svg`,
      homeUrl: `${APP_URL}/mini`,
      imageUrl: `${APP_URL}/api/og?title=nftmail.box&description=Encrypted+agent+email+for+Farcaster`,
      buttonTitle: '👻 Claim Agent',
      splashImageUrl: `${APP_URL}/icon.svg`,
      splashBackgroundColor: '#000000',
      webhookUrl: `${APP_URL}/api/farcaster-webhook`,
    },
  };

  return NextResponse.json(manifest, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
