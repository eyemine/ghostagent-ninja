/// API Route: Farcaster Snap Server
/// POST /api/farcaster-snap
///
/// Farcaster Snap state machine for FID → LARVA provisioning.
/// Uses the Snap JSON protocol (not Open Graph meta tags).
///
/// Snap Protocol: Returns JSON with UI declarations, supports effects.
/// State machine: entry → name → privacy → confirm → success
///
/// Effects: fireworks on success, confetti on claim.

import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || '';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';

// Snap state is passed via the request body
interface SnapState {
  step: 'entry' | 'name' | 'privacy' | 'confirm' | 'success' | 'error';
  fid?: number;
  preferredName?: string;
  agentName?: string;
  farcasterVisibility?: 'hidden' | 'fid-only' | 'full';
  emailVisibility?: 'hidden' | 'domain-only' | 'full';
  error?: string;
}

// Snap message from Farcaster client
interface SnapMessage {
  fid: number;
  buttonIndex?: number;
  inputText?: string;
  state?: SnapState;
  timestamp: number;
}

// Snap UI component types
interface SnapButton {
  label: string;
  action: 'post' | 'link' | 'mint';
  target?: string;
}

interface SnapInput {
  type: 'text';
  placeholder: string;
}

interface SnapUI {
  image?: string;
  title?: string;
  description?: string;
  buttons?: SnapButton[];
  input?: SnapInput;
}

// Snap JSON response
interface SnapResponse {
  type: 'snap';
  ui: SnapUI;
  effects?: string[];
  state?: SnapState;
}

// Generate SVG image for Snap (data URI)
function generateSnapImage(title: string, description?: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#1a1a2e"/>
        <stop offset="100%" style="stop-color:#16213e"/>
      </linearGradient>
      <filter id="glow">
        <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
        <feMerge>
          <feMergeNode in="coloredBlur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <rect width="1200" height="630" fill="url(#bg)"/>
    <text x="600" y="260" text-anchor="middle" font-family="system-ui, sans-serif" font-size="64" font-weight="bold" fill="#f2eee4" filter="url(#glow)">${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
    ${description ? `<text x="600" y="360" text-anchor="middle" font-family="system-ui, sans-serif" font-size="32" fill="#b0805c">${description.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>` : ''}
    <text x="600" y="580" text-anchor="middle" font-family="system-ui, sans-serif" font-size="20" fill="#666">ghostagent.ninja · LARVA Agent</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// Build Snap JSON response
function snapResponse(params: {
  image: string;
  title: string;
  description?: string;
  buttons?: SnapButton[];
  input?: SnapInput;
  state: SnapState;
  effects?: string[];
}): NextResponse {
  const { image, title, description, buttons, input, state, effects } = params;

  const response: SnapResponse = {
    type: 'snap',
    ui: {
      image,
      title,
      description,
      buttons: buttons || [],
      input,
    },
    effects,
    state,
  };

  return NextResponse.json(response);
}

// POST handler — Snap interaction
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SnapMessage;
    const { fid, buttonIndex = 0, inputText, state: currentState } = body;

    // Default to entry if no state
    const state: SnapState = currentState || { step: 'entry' };

    // State machine
    switch (state.step) {
      case 'entry': {
        // Snap 1: Welcome → Name selection
        return snapResponse({
          image: generateSnapImage('GhostAgent LARVA', 'FID-powered agent · No wallet required'),
          title: 'Claim Your LARVA Agent',
          description: 'Create an email-enabled AI agent tied to your Farcaster ID. 8-day free trial.',
          buttons: [
            { label: `Use Default (fid-${fid})`, action: 'post' },
            { label: 'Custom Name →', action: 'post' },
          ],
          input: { type: 'text', placeholder: 'Enter custom name (optional)' },
          state: { step: 'name', fid },
        });
      }

      case 'name': {
        // Snap 2: Name input → Privacy settings
        const preferredName = inputText?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || '';
        const agentName = preferredName ? `${preferredName}.fid-${fid}` : `fid-${fid}`;

        // Skip directly to privacy (which then provisions)
        return snapResponse({
          image: generateSnapImage('Privacy Settings', `Agent: ${agentName}`),
          title: 'Choose Your Privacy Level',
          description: 'Control what others see about your Farcaster connection.',
          buttons: [
            { label: '← Back', action: 'post' },
            { label: 'Hide FID', action: 'post' },
            { label: 'Show FID Only', action: 'post' },
            { label: 'Full Profile →', action: 'post' },
          ],
          state: { step: 'privacy', fid, preferredName, agentName, farcasterVisibility: 'fid-only', emailVisibility: 'hidden' },
          effects: ['confetti'], // Celebration for reaching this step
        });
      }

      case 'privacy': {
        // Snap 3: Handle privacy selection → Provision
        const { preferredName, agentName } = state;
        if (!fid || !agentName) {
          return snapResponse({
            image: generateSnapImage('Error', 'Missing FID or agent name'),
            title: 'Something went wrong',
            description: 'Please try again.',
            buttons: [{ label: 'Restart', action: 'post' }],
            state: { step: 'error', error: 'Missing FID or agent name' },
          });
        }

        // Map button index to visibility settings
        // Button 1 = Back (go back to name)
        // Button 2 = Hide FID (hidden)
        // Button 3 = Show FID Only (fid-only, default)
        // Button 4 = Full Profile (full)
        let farcasterVisibility: 'hidden' | 'fid-only' | 'full' = 'fid-only';
        if (buttonIndex === 2) farcasterVisibility = 'hidden';
        else if (buttonIndex === 3) farcasterVisibility = 'fid-only';
        else if (buttonIndex === 4) farcasterVisibility = 'full';
        else if (buttonIndex === 1) {
          // Back button - return to name
          return snapResponse({
            image: generateSnapImage('Claim Your LARVA Agent', 'FID-powered agent · No wallet required'),
            title: 'Claim Your LARVA Agent',
            description: 'Create an email-enabled AI agent tied to your Farcaster ID.',
            buttons: [
              { label: `Use Default (fid-${fid})`, action: 'post' },
              { label: 'Custom Name →', action: 'post' },
            ],
            input: { type: 'text', placeholder: 'Enter custom name (optional)' },
            state: { step: 'name', fid },
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
            emailVisibility: 'hidden',
            secret: WEBHOOK_SECRET,
          }),
        });

        const provisionData = (await provisionRes.json()) as {
          status: string;
          agentName?: string;
          humanEmail?: string;
          agentEmail?: string;
          expiresAt?: number;
          error?: string;
        };

        if (provisionData.status === 'already_provisioned') {
          return snapResponse({
            image: generateSnapImage('Already Claimed', `${provisionData.agentName}@nftmail.box`),
            title: 'Agent Already Exists',
            description: `Your FID is already linked to ${provisionData.agentName}.`,
            buttons: [
              { label: 'View Agent', action: 'link', target: `${APP_URL}/agent/${provisionData.agentName}` },
              { label: 'Upgrade →', action: 'link', target: `${APP_URL}/byo-molt?agent=${provisionData.agentName}` },
            ],
            state: { step: 'success', fid, agentName: provisionData.agentName, farcasterVisibility },
            effects: ['fireworks'],
          });
        }

        if (provisionData.status !== 'provisioned' || !provisionData.agentName) {
          return snapResponse({
            image: generateSnapImage('Provisioning Failed', provisionData.error || 'Unknown error'),
            title: 'Could not create agent',
            description: provisionData.error || 'Please try again.',
            buttons: [{ label: 'Try Again', action: 'post' }],
            state: { step: 'error', error: provisionData.error || 'Provisioning failed', fid },
          });
        }

        // Success snap with fireworks!
        const expiresDate = provisionData.expiresAt
          ? new Date(provisionData.expiresAt).toLocaleDateString()
          : '8 days';

        return snapResponse({
          image: generateSnapImage('LARVA Agent Claimed!', `Expires: ${expiresDate}`),
          title: 'Agent Created!',
          description: `${provisionData.agentName}@nftmail.box is ready. Your emails are encrypted and secure.`,
          buttons: [
            { label: 'View Agent', action: 'link', target: `${APP_URL}/agent/${provisionData.agentName}` },
            { label: 'Upgrade to PUPA →', action: 'link', target: `${APP_URL}/byo-molt?agent=${provisionData.agentName}` },
          ],
          state: { step: 'success', fid, agentName: provisionData.agentName, farcasterVisibility },
          effects: ['fireworks', 'confetti'], // Double celebration!
        });
      }

      case 'success':
      case 'error':
      default: {
        // Reset to entry
        return snapResponse({
          image: generateSnapImage('GhostAgent LARVA', 'FID-powered agent · No wallet required'),
          title: 'GhostAgent LARVA',
          description: 'Create an email-enabled AI agent tied to your Farcaster ID.',
          buttons: [{ label: 'Claim Agent', action: 'post' }],
          state: { step: 'entry' },
        });
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[farcaster-snap]', msg);
    return snapResponse({
      image: generateSnapImage('Error', msg.slice(0, 50)),
      title: 'Error',
      description: msg.slice(0, 100),
      buttons: [{ label: 'Restart', action: 'post' }],
      state: { step: 'error', error: msg },
    });
  }
}

// GET handler — Initial snap load (for discovery/previews)
export async function GET(req: NextRequest) {
  return snapResponse({
    image: generateSnapImage('GhostAgent LARVA', 'FID-powered agent · No wallet required'),
    title: 'GhostAgent LARVA',
    description: 'Create an email-enabled AI agent tied to your Farcaster ID. 8-day free trial.',
    buttons: [{ label: 'Claim Agent', action: 'post' }],
    state: { step: 'entry' },
  });
}
