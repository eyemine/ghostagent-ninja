/**
 * Shared runtime configuration constants.
 * Import from here — never redeclare locally.
 */

const DEFAULT_WORKER_URL = 'https://nftmail-email-worker.richard-159.workers.dev';

export const WORKER_URL = process.env.NFTMAIL_WORKER_URL || DEFAULT_WORKER_URL;
