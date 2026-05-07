/// Admin API endpoint for DMARC report viewing
/// Fetches DMARC reports from KV and parses XML

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

interface DMARCAttachment {
  filename: string;
  size: number;
  type: string;
  data?: string; // base64
}

interface DMARCMessage {
  id: string;
  receivedAt: number;
  subject: string;
  body: string;
  hasAttachment: boolean;
  attachmentType?: string;
  attachments?: DMARCAttachment[];
}

export async function GET(request: NextRequest) {
  // Auth check
  if (process.env.ADMIN_SECRET) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    // Get DMARC inbox messages from worker
    const workerResponse = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        action: 'getInbox', 
        localPart: 'dmarc',
        includeAttachments: true 
      }),
    });

    if (!workerResponse.ok) {
      throw new Error(`Worker getInbox returned ${workerResponse.status}`);
    }

    const data = await workerResponse.json() as {
      messages: DMARCMessage[];
      sendsRemaining: number;
      error?: string;
    };

    // Parse DMARC reports from messages
    const reports = (data.messages || []).map((msg: DMARCMessage) => ({
      id: msg.id,
      receivedAt: msg.receivedAt,
      subject: msg.subject,
      hasAttachment: msg.hasAttachment || (msg.attachments && msg.attachments.length > 0),
      attachmentType: msg.attachmentType || (msg.attachments?.[0]?.type),
      attachmentCount: msg.attachments?.length || 0,
      attachments: msg.attachments?.map(a => ({ 
        filename: a.filename, 
        size: a.size, 
        type: a.type,
        hasData: !!a.data 
      })) || [],
      // Extract report details from subject
      reportId: msg.subject.match(/Report-ID:\s*(\d+)/)?.[1] || 'unknown',
      submitter: msg.subject.match(/Submitter:\s*(\w+)/)?.[1] || 'unknown',
      domain: msg.subject.match(/Report domain:\s*(\S+)/)?.[1] || 'nftmail.box',
      // Note: body is empty for DMARC reports - attachment contains XML
      body: msg.body,
    }));

    return NextResponse.json({
      reports,
      count: reports.length,
      lastUpdated: Date.now(),
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Admin DMARC error:', msg);
    return NextResponse.json({
      reports: [],
      count: 0,
      lastUpdated: Date.now(),
      error: `Failed to fetch DMARC reports: ${msg}`,
    });
  }
}
