import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  // Force no-cache headers
  const headers = new Headers({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });

  try {
    const body = await req.json() as any;
    
    // Debug: Log everything
    console.log('BYO MOLT V2 DEBUG:', JSON.stringify(body, null, 2));
    
    // Set targetTld if not provided:
    // new-agent BYO molt → agent.gno (standalone agent with its own Safe)
    // overlay onto existing-agent → molt.gno (beacon provenance on the molt registrar)
    if (!body.targetTld) {
      body.targetTld = body.moltTarget === 'existing-agent' ? 'molt.gno' : 'agent.gno';
      console.log('SET targetTld to', body.targetTld, '(moltTarget:', body.moltTarget, ')');
    }

    // Forward to original endpoint with corrected data
    const originalResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja'}/api/byo-molt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await originalResponse.json();
    
    return NextResponse.json(data, { 
      status: originalResponse.status,
      headers 
    });
    
  } catch (error: any) {
    console.error('BYO MOLT V2 ERROR:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500, headers }
    );
  }
}
