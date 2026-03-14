/**
 * Shared runtime configuration constants.
 * Import from here — never redeclare locally.
 */

export const WORKER_URL =
  process.env.NFTMAIL_WORKER_URL ||
  'https://nftmail-email-worker.richard-159.workers.dev';
