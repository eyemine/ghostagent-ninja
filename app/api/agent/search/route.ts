/// Glassbox Search API for nftmail.box
/// Allows agents to query their inbox with structured filters
/// Competes with agentmail.to's semantic search feature

import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentName, filters = {}, apiKey } = body;

    // Validate required fields
    if (!agentName) {
      return NextResponse.json(
        { error: 'agentName is required' },
        { status: 400 }
      );
    }

    // Optional API key validation (for rate limiting)
    if (apiKey) {
      // TODO: Implement API key validation if needed
    }

    // Build search query for worker
    const searchBody = {
      action: 'searchParsedEmails',
      agentName,
      filters: {
        intent: filters.intent,
        isOtp: filters.isOtp,
        isUrgent: filters.isUrgent,
        limit: filters.limit || 20
      }
    };

    // Call the Cloudflare Worker
    const response = await fetch(`${WORKER_URL}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.WEBHOOK_SECRET || ''}`
      },
      body: JSON.stringify(searchBody)
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: 'Search failed', details: error },
        { status: response.status }
      );
    }

    const results = await response.json();

    return NextResponse.json({
      success: true,
      agentName,
      filters,
      results: results.results || [],
      total: results.total || 0
    });

  } catch (error) {
    console.error('Search API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET endpoint for simple queries
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const agentName = searchParams.get('agentName');
  const intent = searchParams.get('intent');
  const limit = parseInt(searchParams.get('limit') || '20');

  if (!agentName) {
    return NextResponse.json(
      { error: 'agentName is required' },
      { status: 400 }
    );
  }

  // Forward to POST endpoint
  return POST(
    new NextRequest(request.url, {
      method: 'POST',
      body: JSON.stringify({
        agentName,
        filters: { intent, limit }
      })
    })
  );
}
