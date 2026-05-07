// Farcaster Snap entry point - Content negotiation
// GET /snap returns JSON for Warpcast, HTML for browsers

import { NextRequest, NextResponse } from 'next/server';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';

export async function GET(request: NextRequest) {
  const accept = request.headers.get('Accept') || '';
  const isSnap = accept.includes('application/snap+json');
  
  if (!isSnap) {
    // Browser request - return HTML with Frame meta tags for discovery
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>GhostAgent LARVA</title>
  <meta property="og:title" content="GhostAgent LARVA" />
  <meta property="og:description" content="FID-powered agent provisioning" />
  <meta property="og:image" content="${APP_URL}/api/og?title=GhostAgent+LARVA&description=FID-powered+agent" />
  <meta property="og:type" content="website" />
  <meta property="fc:frame" content="vNext" />
  <meta property="fc:frame:image" content="${APP_URL}/api/og?title=GhostAgent+LARVA&description=FID-powered+agent" />
  <meta property="fc:frame:post_url" content="${APP_URL}/snap" />
  <meta property="fc:frame:button:1" content="Claim Agent" />
</head>
<body>
  <h1>GhostAgent Farcaster Snap</h1>
  <p>Open in Warpcast to claim your LARVA agent.</p>
</body>
</html>`;
    
    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html' }
    });
  }
  
  // Farcaster Snap protocol - return JSON
  return NextResponse.json({
    version: 'vNext',
    title: 'GhostAgent LARVA',
    image: `${APP_URL}/api/og?title=GhostAgent+LARVA&description=FID-powered+agent`,
    buttons: [
      {
        label: 'Claim Agent',
        action: 'post',
        target: `${APP_URL}/snap`
      }
    ],
    input: {
      text: 'Preferred name (optional)'
    }
  }, {
    headers: { 
      'Content-Type': 'application/snap+json',
      'Cache-Control': 'no-store'
    }
  });
}
