/// <reference types="@cloudflare/workers-types" />

export interface Env {
  INBOX_KV: KVNamespace;
  AGENT_KV: KVNamespace;
  TOKEN_KV: KVNamespace;
  ZOHO_CLIENT_ID: string;
  ZOHO_CLIENT_SECRET: string;
  ZOHO_REFRESH_TOKEN: string;
  ZOHO_ZOID: string;
  ZOHO_ACCOUNTS_URL: string;
  ZOHO_MAIL_URL: string;
  NEXTJS_BASE_URL: string;
}
