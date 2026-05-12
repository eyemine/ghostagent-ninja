/// API endpoints for managing email forwarding for Premium level accounts

import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

// GET - Get current forwarding configuration
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentName = searchParams.get('agentName');

    if (!agentName) {
      return NextResponse.json(
        { error: 'agentName is required' },
        { status: 400 }
      );
    }

    // Call worker to get forwarding config
    const response = await fetch(`${WORKER_URL}/forwarding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.WEBHOOK_SECRET || ''}`
      },
      body: JSON.stringify({
        action: 'getForwardingConfig',
        agentName
      })
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: 'Failed to get forwarding config', details: error },
        { status: response.status }
      );
    }

    const config = await response.json();

    return NextResponse.json({
      success: true,
      agentName,
      config: config.config || null
    });

  } catch (error) {
    console.error('Get forwarding config error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Set or update forwarding configuration
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentName, targetEmail, enabled, filters } = body;

    if (!agentName) {
      return NextResponse.json(
        { error: 'agentName is required' },
        { status: 400 }
      );
    }

    if (enabled && !targetEmail) {
      return NextResponse.json(
        { error: 'targetEmail is required when forwarding is enabled' },
        { status: 400 }
      );
    }

    // Validate email format
    if (targetEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Call worker to set forwarding config
    const response = await fetch(`${WORKER_URL}/forwarding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.WEBHOOK_SECRET || ''}`
      },
      body: JSON.stringify({
        action: 'setForwardingConfig',
        agentName,
        config: {
          enabled: enabled || false,
          targetEmail: targetEmail || '',
          level: 'premium',
          filters: filters || {}
        }
      })
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: 'Failed to set forwarding config', details: error },
        { status: response.status }
      );
    }

    const result = await response.json();

    return NextResponse.json({
      success: true,
      agentName,
      message: enabled ? 'Forwarding enabled' : 'Forwarding disabled',
      config: result.config
    });

  } catch (error) {
    console.error('Set forwarding config error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - Remove forwarding configuration
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentName = searchParams.get('agentName');

    if (!agentName) {
      return NextResponse.json(
        { error: 'agentName is required' },
        { status: 400 }
      );
    }

    // Call worker to delete forwarding config
    const response = await fetch(`${WORKER_URL}/forwarding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.WEBHOOK_SECRET || ''}`
      },
      body: JSON.stringify({
        action: 'deleteForwardingConfig',
        agentName
      })
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: 'Failed to delete forwarding config', details: error },
        { status: response.status }
      );
    }

    return NextResponse.json({
      success: true,
      agentName,
      message: 'Forwarding configuration removed'
    });

  } catch (error) {
    console.error('Delete forwarding config error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
