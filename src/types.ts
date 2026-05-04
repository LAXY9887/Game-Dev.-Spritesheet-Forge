export interface Env {
  // KV namespaces
  SESSIONS: KVNamespace;
  QUOTAS: KVNamespace;
  // R2 bucket
  SPRITESHEET_OUTPUT: R2Bucket;
  // Secrets and config
  PNG2SS_URL: string;
  GIF2SS_URL: string;
  MCP_KEY: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  WORKER_BASE_URL: string;
  FREE_QUOTA_LIMIT: string;
}

export interface SessionData {
  userId: string;
  login: string;
  createdAt: string;
}

export interface QuotaData {
  count: number;
  updatedAt: string;
}

export interface QuotaStatus {
  used: number;
  limit: number;
  reset_at: string;
}

export interface ToolResult {
  url: string;
  expires_at: string;
  content_type: string;
  size_bytes: number;
  quota: QuotaStatus;
}

export interface AuthCodeData {
  userId: string;
  login: string;
  codeChallenge: string;
  clientRedirectUri: string;
  clientState: string;
}
