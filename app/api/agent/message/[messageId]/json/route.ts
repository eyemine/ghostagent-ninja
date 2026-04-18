/// Get structured Agent JSON for a specific message
/// Returns the parsed email data in the standard format for the Agent JSON tab

import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

export async function GET(
  request: NextRequest,
  { params }: { params: { messageId: string } }
) {
  try {
    const { messageId } = params;
    const searchParams = request.nextUrl.searchParams;
    const agentName = searchParams.get('agentName');
    const apiKey = searchParams.get('apiKey');

    // Validate required parameters
    if (!agentName) {
      return NextResponse.json(
        { error: 'agentName is required' },
        { status: 400 }
      );
    }

    if (!messageId) {
      return NextResponse.json(
        { error: 'messageId is required' },
        { status: 400 }
      );
    }

    // Optional API key validation
    if (apiKey) {
      // TODO: Implement API key validation if needed
    }

    // Fetch the parsed email data from worker
    const response = await fetch(`${WORKER_URL}/getParsedEmail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.WEBHOOK_SECRET || ''}`
      },
      body: JSON.stringify({
        action: 'getParsedEmail',
        agentName,
        messageId
      })
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: 'Failed to fetch parsed email', details: error },
        { status: response.status }
      );
    }

    const parsedData = await response.json();

    // If no parsed data exists, check if it's a Darkbox (encrypted) message
    if (!parsedData.parsed) {
      // Try to get the original message to check if it's encrypted
      const originalResponse = await fetch(`${WORKER_URL}/getMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.WEBHOOK_SECRET || ''}`
        },
        body: JSON.stringify({
          action: 'getMessage',
          agentName,
          messageId
        })
      });

      if (originalResponse.ok) {
        const originalData = await originalResponse.json();
        
        // Check if the message is encrypted (Darkbox)
        if (originalData.message?.edgeEncrypt || originalData.message?.encrypted) {
          return NextResponse.json({
            id: messageId,
            metadata: {
              tier: 'Darkbox (Private)',
              timestamp: new Date(originalData.message.timestamp || Date.now()).toISOString(),
              encoding: 'Encrypted',
              safeAddress: originalData.message.safeAddress || 'Unknown'
            },
            content: {
              from: originalData.message.from || 'Encrypted',
              subject: originalData.message.subject || 'Encrypted',
              summary: 'Content encrypted for privacy. Only your agent can decrypt.'
            },
            agent_features: {
              is_otp: false,
              otp_code: null,
              intent: 'ENCRYPTED',
              trust_score_impact: '+0.5 (Privacy Bonus)'
            },
            encrypted: true,
            safeAddress: originalData.message.safeAddress
          });
        }
      }
    }

    // Format the response in the standard Agent JSON structure
    const agentJson = {
      id: messageId,
      metadata: {
        tier: 'Glassbox (Free)',
        timestamp: new Date(parsedData.parsed?.timestamp || Date.now()).toISOString(),
        encoding: 'UTF-8'
      },
      content: {
        from: parsedData.parsed?.sender || 'Unknown',
        subject: parsedData.parsed?.subject || 'No Subject',
        summary: parsedData.parsed?.summary || 'No summary available'
      },
      agent_features: {
        is_otp: parsedData.parsed?.isOtp || false,
        otp_code: parsedData.parsed?.otpCode || null,
        intent: parsedData.parsed?.intent?.toUpperCase() || 'GENERAL',
        trust_score_impact: parsedData.parsed?.trustScoreImpact || '+0.0 (Neutral)'
      },
      encrypted: false,
      parsed_data: parsedData.parsed // Include full parsed data for advanced use
    };

    return NextResponse.json(agentJson);

  } catch (error) {
    console.error('Agent JSON API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
