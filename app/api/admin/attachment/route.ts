/// Admin API endpoint for downloading email attachments
/// Serves attachment data from KV storage

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

export async function GET(request: NextRequest) {
  // Auth check
  if (process.env.ADMIN_SECRET) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const { searchParams } = new URL(request.url);
  const agent = searchParams.get('agent');
  const messageId = searchParams.get('messageId');
  const filename = searchParams.get('filename');

  if (!agent || !messageId) {
    return NextResponse.json({ error: 'Missing agent or messageId parameter' }, { status: 400 });
  }

  try {
    // Fetch message from worker
    const workerResponse = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        action: 'getInbox', 
        localPart: agent,
      }),
    });

    if (!workerResponse.ok) {
      throw new Error(`Worker getInbox returned ${workerResponse.status}`);
    }

    const data = await workerResponse.json() as {
      messages: Array<{
        id: string;
        attachments?: Array<{
          filename: string;
          size: number;
          type: string;
          data: string;
        }>;
      }>;
    };

    // Find the specific message
    const message = data.messages?.find(m => m.id === messageId);
    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // Find attachment
    const attachment = message.attachments?.find(a => 
      !filename || a.filename === filename
    );
    
    if (!attachment) {
      return NextResponse.json({ 
        error: 'Attachment not found',
        availableAttachments: message.attachments?.map(a => a.filename) || []
      }, { status: 404 });
    }

    // Decode base64 and return
    const binaryString = atob(attachment.data);
    const decoded = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      decoded[i] = binaryString.charCodeAt(i);
    }
    
    return new NextResponse(decoded, {
      headers: {
        'Content-Type': attachment.type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${attachment.filename}"`,
        'Content-Length': String(decoded.length),
      },
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Admin attachment download error:', msg);
    return NextResponse.json({ error: `Failed to download attachment: ${msg}` }, { status: 500 });
  }
}
