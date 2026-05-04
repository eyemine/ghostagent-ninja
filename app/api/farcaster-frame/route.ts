/// API Route: Farcaster Frame Server
/// POST /api/farcaster-frame
///
/// Farcaster Frame state machine for FID → LARVA provisioning:
///   Frame 1: Entry → "Claim LARVA Agent" button
///   Frame 2: Name selection → text input for custom name (optional)
///   Frame 3: Confirm → provision agent via worker
///   Frame 4: Success → show agent details + upgrade CTA
///
/// Uses Farcaster Frame Specification (Open Graph tags + signed messages).
/// No @coinbase/onchainkit dependency — lightweight implementation.

import { NextRequest, NextResponse } from 'next/server';
import { type Address, verifyMessage } from 'viem';

const WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || '';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';

// Frame state is passed via button post_url with query params
interface FrameState {
  step: 'entry' | 'name' | 'confirm' | 'privacy' | 'success' | 'error';
  fid?: number;
  preferredName?: string;
  agentName?: string;
  farcasterVisibility?: 'hidden' | 'fid-only' | 'full';
  emailVisibility?: 'hidden' | 'domain-only' | 'full';
  error?: string;
}

// Farcaster Frame message types (simplified)
interface FrameMessage {
  fid: number;
  buttonIndex: number;
  inputText?: string;
  state?: string; // Base64 encoded state
  signature: string;
  messageBytes: string;
}

// Decode state from query param
function decodeState(stateParam: string | null): FrameState {
  if (!stateParam) return { step: 'entry' };
  try {
    const json = Buffer.from(stateParam, 'base64').toString('utf-8');
    return JSON.parse(json) as FrameState;
  } catch {
    return { step: 'entry' };
  }
}

function encodeState(state: FrameState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64');
}

// Frame HTML response (Open Graph tags)
function frameResponse(params: {
  image: string;
  buttons: { label: string; action: 'post' | 'post_redirect'; target?: string }[];
  input?: { placeholder: string };
  state: FrameState;
}): NextResponse {
  const { image, buttons, input, state } = params;

  const stateEncoded = encodeState(state);

  // Build button meta tags
  const buttonTags = buttons.map((btn, idx) => {
    const num = idx + 1;
    let tags = `  <meta property="fc:frame:button:${num}" content="${btn.label}" />\n`;
    tags += `  <meta property="fc:frame:button:${num}:action" content="${btn.action}" />\n`;
    if (btn.target) {
      tags += `  <meta property="fc:frame:button:${num}:target" content="${btn.target}?state=${stateEncoded}" />\n`;
    } else {
      tags += `  <meta property="fc:frame:button:${num}:post_url" content="${APP_URL}/api/farcaster-frame?state=${stateEncoded}" />\n`;
    }
    return tags;
  }).join('');

  const inputTag = input
    ? `  <meta property="fc:frame:input:text" content="${input.placeholder}" />\n`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>GhostAgent LARVA</title>
  <meta property="fc:frame" content="vNext" />
  <meta property="fc:frame:image" content="${image}" />
${buttonTags}${inputTag}</head>
<body>
  <h1>GhostAgent Farcaster Frame</h1>
  <p>State: ${state.step}</p>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}

// Simple SVG image generator for Frame images (data URI)
function generateFrameImage(text: string, subtext?: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#1a1a2e"/>
        <stop offset="100%" style="stop-color:#16213e"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#bg)"/>
    <text x="600" y="280" text-anchor="middle" font-family="system-ui, sans-serif" font-size="72" font-weight="bold" fill="#f2eee4">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
    ${subtext ? `<text x="600" y="380" text-anchor="middle" font-family="system-ui, sans-serif" font-size="36" fill="#b0805c">${subtext.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>` : ''}
    <text x="600" y="550" text-anchor="middle" font-family="system-ui, sans-serif" font-size="24" fill="#666">ghostagent.ninja</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// Verify Farcaster message signature (simplified — in production, use @farcaster/hub-web)
async function verifyFrameMessage(message: FrameMessage): Promise<boolean> {
  // In production: validate messageBytes + signature against Farcaster hubs
  // For MVP: trust the message structure, validate FID exists
  return message.fid > 0 && !!message.signature;
}

// POST handler — Frame button click
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const stateParam = url.searchParams.get('state');
    const currentState = decodeState(stateParam);

    // Parse Frame message from body
    const body = await req.json() as FrameMessage;
    const { fid, buttonIndex, inputText } = body;

    // Verify message
    const isValid = await verifyFrameMessage(body);
    if (!isValid) {
      return frameResponse({
        image: generateFrameImage('Invalid Message', 'Please try again from Warpcast'),
        buttons: [{ label: 'Try Again', action: 'post', target: `${APP_URL}/api/farcaster-frame` }],
        state: { step: 'error', error: 'Invalid signature' },
      });
    }

    // State machine
    switch (currentState.step) {
      case 'entry': {
        // Frame 1 → 2: Name selection
        return frameResponse({
          image: generateFrameImage('Claim Your Agent', `FID: ${fid}`),
          buttons: [
            { label: 'Use Default (fid-' + fid + ')', action: 'post' },
            { label: 'Custom Name →', action: 'post' },
          ],
          input: { placeholder: 'Enter custom name (optional)' },
          state: { step: 'name', fid },
        });
      }

      case 'name': {
        // Frame 2 → 3: Confirm provisioning
        const preferredName = inputText?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || '';
        const agentName = preferredName ? `${preferredName}.fid-${fid}` : `fid-${fid}`;

        return frameResponse({
          image: generateFrameImage(
            'Confirm Provisioning',
            `Agent: ${agentName}@nftmail.box`
          ),
          buttons: [
            { label: '← Back', action: 'post' },
            { label: '✓ Claim LARVA Agent', action: 'post' },
          ],
          state: { step: 'confirm', fid, preferredName, agentName },
        });
      }

      case 'confirm': {
        // Frame 3 → 4: Privacy settings (before provisioning)
        const { fid, preferredName, agentName } = currentState;
        if (!fid) {
          return frameResponse({
            image: generateFrameImage('Error', 'Missing FID'),
            buttons: [{ label: 'Restart', action: 'post', target: `${APP_URL}/api/farcaster-frame` }],
            state: { step: 'error', error: 'Missing FID' },
          });
        }

        return frameResponse({
          image: generateFrameImage(
            'Privacy Settings',
            `Agent: ${agentName}`
          ),
          buttons: [
            { label: '← Back', action: 'post' },
            { label: 'Hide FID', action: 'post' },
            { label: 'Show FID Only', action: 'post' },
            { label: 'Full Profile →', action: 'post' },
          ],
          state: { step: 'privacy', fid, preferredName, agentName, farcasterVisibility: 'fid-only', emailVisibility: 'hidden' },
        });
      }

      case 'privacy': {
        // Frame 4: Handle privacy selection → Provision
        const { fid, preferredName, agentName } = currentState;
        if (!fid || !agentName) {
          return frameResponse({
            image: generateFrameImage('Error', 'Missing FID or agent name'),
            buttons: [{ label: 'Restart', action: 'post', target: `${APP_URL}/api/farcaster-frame` }],
            state: { step: 'error', error: 'Missing FID or agent name' },
          });
        }

        // Map button index to visibility settings
        // Button 1 = Back (go back to confirm)
        // Button 2 = Hide FID (hidden)
        // Button 3 = Show FID Only (fid-only, default)
        // Button 4 = Full Profile (full)
        let farcasterVisibility: 'hidden' | 'fid-only' | 'full' = 'fid-only';
        if (buttonIndex === 2) farcasterVisibility = 'hidden';
        else if (buttonIndex === 3) farcasterVisibility = 'fid-only';
        else if (buttonIndex === 4) farcasterVisibility = 'full';
        else if (buttonIndex === 1) {
          // Back button - return to confirm
          return frameResponse({
            image: generateFrameImage(
              'Confirm Provisioning',
              `Agent: ${agentName}@nftmail.box`
            ),
            buttons: [
              { label: '← Back', action: 'post' },
              { label: '✓ Claim LARVA Agent', action: 'post' },
            ],
            state: { step: 'confirm', fid, preferredName, agentName },
          });
        }

        // Call worker to provision FID agent with privacy settings
        const provisionRes = await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WEBHOOK_SECRET },
          body: JSON.stringify({
            action: 'provisionFidAgent',
            fid,
            preferredName: preferredName || '',
            farcasterVisibility,
            emailVisibility: 'hidden', // Always hide email in public API
            secret: WEBHOOK_SECRET,
          }),
        });

        const provisionData = await provisionRes.json() as {
          status: string;
          agentName?: string;
          humanEmail?: string;
          agentEmail?: string;
          expiresAt?: number;
          error?: string;
        };

        if (provisionData.status === 'already_provisioned') {
          return frameResponse({
            image: generateFrameImage(
              'Already Claimed',
              `${provisionData.agentName}@nftmail.box`
            ),
            buttons: [
              { label: 'View Agent', action: 'post_redirect', target: `${APP_URL}/agent/${provisionData.agentName}` },
              { label: 'Upgrade →', action: 'post_redirect', target: `${APP_URL}/byo-molt?agent=${provisionData.agentName}` },
            ],
            state: { step: 'success', fid, agentName: provisionData.agentName },
          });
        }

        if (provisionData.status !== 'provisioned' || !provisionData.agentName) {
          return frameResponse({
            image: generateFrameImage('Provisioning Failed', provisionData.error || 'Unknown error'),
            buttons: [{ label: 'Try Again', action: 'post', target: `${APP_URL}/api/farcaster-frame` }],
            state: { step: 'error', error: provisionData.error || 'Provisioning failed' },
          });
        }

        // Success frame
        const expiresDate = provisionData.expiresAt
          ? new Date(provisionData.expiresAt).toLocaleDateString()
          : '8 days';

        return frameResponse({
          image: generateFrameImage(
            'LARVA Agent Claimed!',
            `Expires: ${expiresDate}`
          ),
          buttons: [
            { label: 'View Agent', action: 'post_redirect', target: `${APP_URL}/agent/${provisionData.agentName}` },
            { label: 'Upgrade to PUPA →', action: 'post_redirect', target: `${APP_URL}/byo-molt?agent=${provisionData.agentName}` },
          ],
          state: { step: 'success', fid, agentName: provisionData.agentName },
        });
      }

      case 'success':
      case 'error':
      default: {
        // Reset to entry
        return frameResponse({
          image: generateFrameImage('GhostAgent LARVA', 'FID-powered agent provisioning'),
          buttons: [{ label: 'Claim Agent', action: 'post' }],
          state: { step: 'entry' },
        });
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[farcaster-frame]', msg);
    return frameResponse({
      image: generateFrameImage('Error', msg.slice(0, 50)),
      buttons: [{ label: 'Restart', action: 'post', target: `${APP_URL}/api/farcaster-frame` }],
      state: { step: 'error', error: msg },
    });
  }
}

// GET handler — Initial frame load (Frame preview)
export async function GET(req: NextRequest) {
  return frameResponse({
    image: generateFrameImage('GhostAgent LARVA', 'FID-powered agent provisioning\nNo wallet required'),
    buttons: [{ label: 'Claim Agent', action: 'post' }],
    state: { step: 'entry' },
  });
}
