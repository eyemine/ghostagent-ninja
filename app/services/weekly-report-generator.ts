/**
 * weekly-report-generator.ts
 *
 * Generates a weekly activity summary for an agent and sends it
 * to the owner via NFTmail.box. Intended to be called from a
 * Cloudflare Cron trigger (weekly) or triggered manually.
 *
 * Aggregates:
 * - Budget usage (daily average xDAI spend)
 * - Task completions/failures/timeouts
 * - Storage usage delta
 * - Pending approval requests
 * - Rate limit incidents
 */

export interface WeeklyReportData {
  agentName: string;
  weekStart: string;   // ISO date
  weekEnd: string;     // ISO date

  budget: {
    dailyCap: number;
    avgDailySpend: number;
    totalSpend: number;
    pauseCount: number;
  };

  tasks: {
    total: number;
    completed: number;
    failed: number;
    timedOut: number;
    avgDurationMs: number;
    consecutiveFailures: number;
  };

  storage: {
    usedMB: number;
    capMB: number;
    bps: number;
    filesArchived: number;
  };

  approvals: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };

  rateLimit: {
    cooldownIncidents: number;
    peakCount: number;
    limit: number;
  };
}

const BASE = typeof window !== 'undefined' ? '' : (process.env.NEXTJS_BASE_URL ?? 'https://ghostagent.ninja');
const MB = 1024 * 1024;

export async function generateWeeklyReport(agentName: string): Promise<WeeklyReportData> {
  const now = new Date();
  const weekEnd = now.toISOString().split('T')[0];
  const weekStartDate = new Date(now.getTime() - 7 * 86_400_000);
  const weekStart = weekStartDate.toISOString().split('T')[0];

  const [budgetRes, taskRes, storageRes, approvalRes, rateLimitRes] = await Promise.allSettled([
    fetch(`${BASE}/api/agent/budget?agent=${encodeURIComponent(agentName)}`).then(r => r.json()),
    fetch(`${BASE}/api/agent/task/status?agent=${encodeURIComponent(agentName)}&limit=100`).then(r => r.json()),
    fetch(`${BASE}/api/agent/storage?agent=${encodeURIComponent(agentName)}`).then(r => r.json()),
    fetch(`${BASE}/api/agent/approval/request?agent=${encodeURIComponent(agentName)}`).then(r => r.json()),
    fetch(`${BASE}/api/agent/rate-limit?agent=${encodeURIComponent(agentName)}`).then(r => r.json()),
  ]);

  const budget = budgetRes.status === 'fulfilled' ? budgetRes.value as any : {};
  const taskData = taskRes.status === 'fulfilled' ? taskRes.value as any : { logs: [], consecutiveFailures: 0 };
  const storage = storageRes.status === 'fulfilled' ? storageRes.value as any : {};
  const approvalData = approvalRes.status === 'fulfilled' ? approvalRes.value as any : { requests: [] };
  const rateLimit = rateLimitRes.status === 'fulfilled' ? rateLimitRes.value as any : {};

  const logs = (taskData.logs ?? []) as any[];
  const completed = logs.filter((l: any) => l.status === 'completed').length;
  const failed = logs.filter((l: any) => l.status === 'failed').length;
  const timedOut = logs.filter((l: any) => l.status === 'timeout').length;
  const avgDurationMs = logs.length > 0 ? logs.reduce((s: number, l: any) => s + (l.durationMs ?? 0), 0) / logs.length : 0;

  const approvals = (approvalData.requests ?? []) as any[];
  const pendingApprovals = approvals.filter((r: any) => r.status === 'pending').length;
  const approvedCount = approvals.filter((r: any) => r.status === 'approved').length;
  const rejectedCount = approvals.filter((r: any) => r.status === 'rejected').length;

  return {
    agentName,
    weekStart,
    weekEnd,
    budget: {
      dailyCap: budget.dailyCap ?? 0.1,
      avgDailySpend: (budget.spentToday ?? 0) / 7,
      totalSpend: budget.spentToday ?? 0,
      pauseCount: 0,
    },
    tasks: {
      total: logs.length,
      completed, failed, timedOut,
      avgDurationMs,
      consecutiveFailures: taskData.consecutiveFailures ?? 0,
    },
    storage: {
      usedMB: ((storage.usedBytes ?? 0) / MB),
      capMB: ((storage.capBytes ?? (100 * MB)) / MB),
      bps: storage.bps ?? 0,
      filesArchived: (storage.files ?? []).filter((f: any) => f.archived).length,
    },
    approvals: {
      total: approvals.length,
      pending: pendingApprovals,
      approved: approvedCount,
      rejected: rejectedCount,
    },
    rateLimit: {
      cooldownIncidents: 0,
      peakCount: rateLimit.count ?? 0,
      limit: rateLimit.limit ?? 100,
    },
  };
}

export function formatWeeklyReport(report: WeeklyReportData): string {
  const taskSuccessRate = report.tasks.total > 0
    ? ((report.tasks.completed / report.tasks.total) * 100).toFixed(0)
    : '100';
  const avgMins = (report.tasks.avgDurationMs / 60000).toFixed(1);
  const storagePct = (report.storage.bps / 100).toFixed(0);

  return `WEEKLY AGENT REPORT: ${report.agentName}
Period: ${report.weekStart} to ${report.weekEnd}

BUDGET
  Daily cap:       ${report.budget.dailyCap.toFixed(4)} xDAI
  Total spent:     ${report.budget.totalSpend.toFixed(6)} xDAI
  Avg/day:         ${report.budget.avgDailySpend.toFixed(6)} xDAI

TASKS
  Total:           ${report.tasks.total}
  Completed:       ${report.tasks.completed} (${taskSuccessRate}%)
  Failed:          ${report.tasks.failed}
  Timed out:       ${report.tasks.timedOut}
  Avg duration:    ${avgMins} min
  Consec failures: ${report.tasks.consecutiveFailures}

STORAGE
  Used:            ${report.storage.usedMB.toFixed(1)}MB / ${report.storage.capMB.toFixed(0)}MB (${storagePct}%)
  Files archived:  ${report.storage.filesArchived}

APPROVALS
  High-value reqs: ${report.approvals.total}
  Pending:         ${report.approvals.pending}
  Approved:        ${report.approvals.approved}
  Rejected:        ${report.approvals.rejected}

RATE LIMIT
  Peak requests:   ${report.rateLimit.peakCount}/${report.rateLimit.limit}
  Cooldowns:       ${report.rateLimit.cooldownIncidents}

Dashboard: https://ghostagent.ninja/dashboard`;
}

export async function sendWeeklyReport(agentName: string): Promise<void> {
  const report = await generateWeeklyReport(agentName);
  const body = formatWeeklyReport(report);
  await fetch(`${BASE}/api/mail/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentName,
      from: 'weekly-report@ghostagent.ninja',
      subject: `[${agentName}] Weekly Activity Report — ${report.weekStart}`,
      body,
      internal: true,
    }),
  });
}
