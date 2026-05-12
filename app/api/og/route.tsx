/// API Route: Dynamic Open Graph Image Generator
/// GET /api/og?title=...&description=...
///
/// Generates PNG images for Farcaster Frame previews and social sharing.
/// Uses Next.js ImageResponse (Satori) for server-side image generation.

import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const title = searchParams.get('title') || 'GhostAgent';
  const description = searchParams.get('description') || 'AI Agent Platform';

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
        }}
      >
        {/* Glow effect background */}
        <div
          style={{
            position: 'absolute',
            width: '600px',
            height: '600px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(176,128,92,0.15) 0%, transparent 70%)',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        />

        {/* Title */}
        <h1
          style={{
            fontSize: '64px',
            fontWeight: 'bold',
            color: '#f2eee4',
            margin: '0 0 20px 0',
            textAlign: 'center',
            maxWidth: '1000px',
            textShadow: '0 0 30px rgba(242,238,228,0.3)',
          }}
        >
          {title}
        </h1>

        {/* Description */}
        <p
          style={{
            fontSize: '32px',
            color: '#b0805c',
            margin: '0',
            textAlign: 'center',
            maxWidth: '900px',
          }}
        >
          {description}
        </p>

        {/* Footer */}
        <div
          style={{
            position: 'absolute',
            bottom: '40px',
            fontSize: '20px',
            color: '#666',
          }}
        >
          ghostagent.ninja · BASIC Agent
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
