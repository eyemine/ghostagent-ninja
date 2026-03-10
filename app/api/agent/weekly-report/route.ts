import { NextRequest, NextResponse } from 'next/server';
import { sendWeeklyReport } from '../../../services/weekly-report-generator';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { agentName?: string; secret?: string };
    const { agentName, secret } = body;

    const expectedSecret = process.env.WEBHOOK_SECRET;
    if (!expectedSecret || secret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!agentName || typeof agentName !== 'string') {
      return NextResponse.json({ error: 'agentName required' }, { status: 400 });
    }

    await sendWeeklyReport(agentName);
    return NextResponse.json({ ok: true, agentName });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Internal error' }, { status: 500 });
  }
}
