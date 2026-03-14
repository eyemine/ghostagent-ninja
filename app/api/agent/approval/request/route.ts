import { NextRequest, NextResponse } from 'next/server';
import { WORKER_URL } from '../../../../utils/config';

/**
 * /api/agent/approval/request
 * GET  ?agent=<name>          → pending approval requests
 * POST { action, agentName, ...params }
 *   action = 'request'   — queue a high-value action for approval
 *   action = 'approve'   — mark approved (adminSecret required)
 *   action = 'reject'    — reject and cancel
 *   action = 'emergency-pause'   — instantly pause agent
 *   action = 'emergency-unpause' — unpause (adminSecret required)
 */

const BASE_URL = process.env.NEXTJS_BASE_URL ?? 'https://ghostagent.ninja';
const ADMIN_SECRET = process.env.BUDGET_ADMIN_SECRET;

interface ApprovalRequest {
  id: string;
  agentName: string;
  description: string;
  valueXdai: number;
  to?: string;
  data?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
}

async function kvGet(key: string): Promise<string | null> {
  const res = await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'kvGet', key }) }).catch(() => null);
  if (!res?.ok) return null;
  return ((await res.json()) as { value?: string }).value ?? null;
}
async function kvPut(key: string, value: string): Promise<void> {
  await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'kvPut', key, value }) }).catch(() => {});
}

async function readRequests(agent: string): Promise<ApprovalRequest[]> {
  const raw = await kvGet(`approval:${agent}:requests`);
  return raw ? JSON.parse(raw) : [];
}
async function writeRequests(agent: string, reqs: ApprovalRequest[]): Promise<void> {
  await kvPut(`approval:${agent}:requests`, JSON.stringify(reqs.slice(-50)));
}

async function sendApprovalAlert(req: ApprovalRequest, status: string): Promise<void> {
  const subject = status === 'pending'
    ? `[${req.agentName}] High-Value Action Awaiting Safe Approval`
    : `[${req.agentName}] Approval request ${status}: ${req.description.slice(0, 60)}`;
  await fetch(`${BASE_URL}/api/mail/ingest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentName: req.agentName, from: 'approval-guardrail@ghostagent.ninja',
      subject,
      body: `Action: ${req.description}\nValue: ${req.valueXdai} xDAI\nTo: ${req.to ?? 'n/a'}\nStatus: ${status}\nID: ${req.id}\n\nApprove/reject at: ${BASE_URL}/dashboard`,
      internal: true,
    }),
  }).catch(() => {});
}

async function logToGlassBox(req: ApprovalRequest, event: string): Promise<void> {
  await fetch(`${BASE_URL}/api/glassbox/log`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentName: req.agentName, eventType: event, data: { id: req.id, description: req.description, valueXdai: req.valueXdai } }),
  }).catch(() => {});
}

export async function GET(req: NextRequest) {
  const agent = req.nextUrl.searchParams.get('agent');
  if (!agent) return NextResponse.json({ error: 'Missing agent' }, { status: 400 });
  const reqs = await readRequests(agent.toLowerCase());
  const pausedRaw = await kvGet(`approval:${agent.toLowerCase()}:paused`);
  return NextResponse.json({ requests: reqs, emergencyPaused: pausedRaw === '1' });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    action: string; agentName?: string; description?: string;
    valueXdai?: number; to?: string; data?: string; id?: string;
    adminSecret?: string;
  };
  const agent = body.agentName?.toLowerCase();
  if (!agent) return NextResponse.json({ error: 'Missing agentName' }, { status: 400 });

  switch (body.action) {
    case 'request': {
      const newReq: ApprovalRequest = {
        id: crypto.randomUUID(), agentName: agent,
        description: body.description ?? 'High-value transaction',
        valueXdai: body.valueXdai ?? 0, to: body.to, data: body.data,
        status: 'pending', createdAt: Date.now(),
      };
      const reqs = await readRequests(agent);
      reqs.push(newReq);
      await writeRequests(agent, reqs);
      await sendApprovalAlert(newReq, 'pending');
      await logToGlassBox(newReq, 'approval-requested');
      return NextResponse.json(newReq, { status: 202 });
    }
    case 'approve': {
      if (ADMIN_SECRET && body.adminSecret !== ADMIN_SECRET) return NextResponse.json({ error: 'Unauthorised' }, { status: 403 });
      const reqs = await readRequests(agent);
      const r = reqs.find(r => r.id === body.id);
      if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      r.status = 'approved'; r.resolvedAt = Date.now();
      await writeRequests(agent, reqs);
      await sendApprovalAlert(r, 'approved');
      await logToGlassBox(r, 'approval-granted');
      return NextResponse.json(r);
    }
    case 'reject': {
      if (ADMIN_SECRET && body.adminSecret !== ADMIN_SECRET) return NextResponse.json({ error: 'Unauthorised' }, { status: 403 });
      const reqs = await readRequests(agent);
      const r = reqs.find(r => r.id === body.id);
      if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      r.status = 'rejected'; r.resolvedAt = Date.now();
      await writeRequests(agent, reqs);
      await logToGlassBox(r, 'approval-rejected');
      return NextResponse.json(r);
    }
    case 'emergency-pause': {
      await kvPut(`approval:${agent}:paused`, '1');
      await fetch(`${BASE_URL}/api/agent/budget`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pause', agentName: agent }) }).catch(() => {});
      await fetch(`${BASE_URL}/api/mail/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentName: agent, from: 'emergency@ghostagent.ninja', subject: `[${agent}] EMERGENCY PAUSE activated`, body: `Agent ${agent} has been emergency paused.\n\nUnpause requires Safe multi-sig approval.`, internal: true }) }).catch(() => {});
      return NextResponse.json({ emergencyPaused: true });
    }
    case 'emergency-unpause': {
      if (ADMIN_SECRET && body.adminSecret !== ADMIN_SECRET) return NextResponse.json({ error: 'Unauthorised' }, { status: 403 });
      await kvPut(`approval:${agent}:paused`, '0');
      await fetch(`${BASE_URL}/api/agent/budget`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'unpause', agentName: agent, adminSecret: body.adminSecret }) }).catch(() => {});
      return NextResponse.json({ emergencyPaused: false });
    }
    default:
      return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
}
