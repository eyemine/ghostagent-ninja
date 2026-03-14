import { NextResponse } from 'next/server';
import { WORKER_URL } from '../../utils/config';


export async function POST(request: Request) {
  try {
    const body = await request.json() as { agentName?: string };
    const { agentName } = body;

    if (!agentName) {
      return NextResponse.json({ error: 'Missing agentName' }, { status: 400 });
    }

    // localPart format: "victor_" for agent emails (victor_@nftmail.box)
    const localPart = `${agentName}_`;

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'getAgentStatus', localPart }),
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to fetch inbox' },
      { status: 500 }
    );
  }
}
