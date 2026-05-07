// Farcaster Snap Protocol - /api/snap
// GET: Returns Snap JSON for Warpcast
// POST: Handles FID-based agent provisioning

import { NextRequest, NextResponse } from 'next/server';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

interface SnapState {
  step: 'entry' | 'name' | 'privacy' | 'confirm' | 'provisioning' | 'success' | 'error';
  fid?: number;
  username?: string;
  preferredName?: string;
  agentName?: string;
  farcasterVisibility?: 'hidden' | 'fid-only' | 'full';
  emailVisibility?: 'hidden' | 'domain-only' | 'full';
  error?: string;
}

// GET: Snap entry point (content negotiation)
export async function GET(request: NextRequest) {
  const accept = request.headers.get('Accept') || '';
  const isSnap = accept.includes('application/snap+json');
  
  if (!isSnap) {
    // Browser - return HTML with Frame meta tags
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width" />
  <title>GhostAgent LARVA</title>
  <meta property="og:title" content="GhostAgent LARVA" />
  <meta property="og:description" content="FID-powered agent provisioning. No wallet required." />
  <meta property="og:image" content="${APP_URL}/api/og?title=GhostAgent+LARVA&description=FID-powered+agent+provisioning" />
  <meta property="og:type" content="website" />
  <meta property="fc:frame" content="vNext" />
  <meta property="fc:frame:image" content="${APP_URL}/api/og?title=GhostAgent+LARVA&description=FID-powered+agent+provisioning" />
  <meta property="fc:frame:post_url" content="${APP_URL}/api/snap" />
  <meta property="fc:frame:button:1" content="Claim Agent" />
</head>
<body>
  <h1>GhostAgent Farcaster Snap</h1>
  <p>State: entry</p>
  <p>Open in Warpcast to claim your LARVA agent.</p>
</body>
</html>`;
    
    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html' }
    });
  }
  
  // Farcaster Snap JSON response
  return NextResponse.json({
    version: 'vNext',
    title: 'GhostAgent LARVA',
    image: `${APP_URL}/api/og?title=GhostAgent+LARVA&description=FID-powered+agent`,
    buttons: [
      {
        label: 'Claim Agent',
        action: 'post'
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

// POST: Handle Farcaster Snap interactions
export async function POST(request: NextRequest) {
  try {
    // Parse Farcaster Snap message
    const body = await request.json();
    
    // Extract FID and user data from untrustedData
    // Note: In production, verify JFS signature
    const fid = body.untrustedData?.fid;
    const username = body.untrustedData?.username || `fid-${fid}`;
    const inputText = body.untrustedData?.inputText?.trim();
    const buttonIndex = body.untrustedData?.buttonIndex;
    const stateRaw = body.untrustedData?.state;
    
    let state: SnapState = { step: 'entry' };
    if (stateRaw) {
      try {
        state = JSON.parse(Buffer.from(stateRaw, 'base64').toString());
      } catch {
        state = { step: 'entry' };
      }
    }
    
    // State machine
    switch (state.step) {
      case 'entry': {
        // User clicked "Claim Agent" - ask for preferred name
        const preferredName = inputText || username;
        
        return NextResponse.json({
          version: 'vNext',
          title: 'Choose Agent Name',
          image: `${APP_URL}/api/og?title=Choose+Name&description=${encodeURIComponent(preferredName)}`,
          buttons: [
            { label: 'Continue', action: 'post' },
            { label: 'Edit Name', action: 'post' }
          ],
          input: { text: 'Preferred name' },
          state: encodeState({ 
            step: 'privacy', 
            fid, 
            username, 
            preferredName 
          })
        }, {
          headers: { 
            'Content-Type': 'application/snap+json',
            'Cache-Control': 'no-store'
          }
        });
      }
      
      case 'privacy': {
        // Privacy settings step
        const preferredName = state.preferredName || inputText || username;
        
        return NextResponse.json({
          version: 'vNext',
          title: 'Privacy Settings',
          image: `${APP_URL}/api/og?title=Privacy+Settings&description=Control+your+visibility`,
          buttons: [
            { label: 'Public (FID only)', action: 'post' },
            { label: 'Full Public', action: 'post' },
            { label: 'Hidden', action: 'post' }
          ],
          state: encodeState({
            step: 'confirm',
            fid,
            username,
            preferredName,
            farcasterVisibility: buttonIndex === 2 ? 'hidden' : buttonIndex === 1 ? 'full' : 'fid-only'
          })
        }, {
          headers: { 
            'Content-Type': 'application/snap+json',
            'Cache-Control': 'no-store'
          }
        });
      }
      
      case 'confirm': {
        // Confirm and provision
        const { fid: userFid, preferredName, farcasterVisibility = 'fid-only' } = state;
        
        if (!userFid) {
          return errorResponse('Missing FID');
        }
        
        // Call worker to provision FID-based agent
        const provisionRes = await fetch(`${WORKER_URL}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'provisionFidAgent',
            fid: userFid,
            preferredName,
            farcasterVisibility,
            emailVisibility: 'domain-only',
            webhookSecret: process.env.WEBHOOK_SECRET
          })
        });
        
        if (!provisionRes.ok) {
          const error = await provisionRes.text();
          return errorResponse(`Provisioning failed: ${error}`);
        }
        
        const result = await provisionRes.json();
        
        if (!result.success) {
          return errorResponse(result.error || 'Provisioning failed');
        }
        
        // Success response
        return NextResponse.json({
          version: 'vNext',
          title: '✅ Agent Created!',
          image: `${APP_URL}/api/og?title=Agent+Ready&description=${encodeURIComponent(result.agentName || 'Your agent is live')}`,
          buttons: [
            { 
              label: 'View Dashboard', 
              action: 'link',
              target: `${APP_URL}/agent/${result.agentName}`
            },
            {
              label: 'Claim Another',
              action: 'post'
            }
          ],
          state: encodeState({ step: 'success', agentName: result.agentName })
        }, {
          headers: { 
            'Content-Type': 'application/snap+json',
            'Cache-Control': 'no-store'
          }
        });
      }
      
      default: {
        return errorResponse('Unknown state');
      }
    }
  } catch (err) {
    console.error('Snap error:', err);
    return errorResponse(err instanceof Error ? err.message : 'Unknown error');
  }
}

// Helper functions
function encodeState(state: SnapState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64');
}

function errorResponse(message: string) {
  return NextResponse.json({
    version: 'vNext',
    title: '❌ Error',
    image: `${process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja'}/api/og?title=Error&description=${encodeURIComponent(message)}`,
    buttons: [
      { label: 'Try Again', action: 'post' }
    ]
  }, {
    headers: { 
      'Content-Type': 'application/snap+json',
      'Cache-Control': 'no-store'
    }
  });
}
