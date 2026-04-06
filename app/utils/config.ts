/**
 * Shared runtime configuration constants.
 * Import from here — never redeclare locally.
 */

const workerUrl = process.env.NFTMAIL_WORKER_URL;

if (!workerUrl) {
  throw new Error(
    'NFTMAIL_WORKER_URL environment variable is required. ' +
    'Set it in Netlify environment variables or .env.local'
  );
}

export const WORKER_URL = workerUrl;
