import { MCPError } from './errors';
import type { Env, QuotaData, QuotaStatus } from './types';

function quotaKey(userId: string): string {
  const ym = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  return `quota:${userId}:${ym}`;
}

export function getResetDate(): string {
  const now = new Date();
  const year = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
  const month = now.getMonth() === 11 ? 1 : now.getMonth() + 2; // 1-based next month
  const mm = String(month).padStart(2, '0');
  return `${year}-${mm}-01`; // "YYYY-MM-01" in local time, always the 1st of next month
}

async function getPlanLimit(env: Env, userId: string): Promise<number> {
  if (!userId) return parseInt(env.FREE_QUOTA_LIMIT, 10);
  const raw = await env.QUOTAS.get(`marketplace:${userId}`);
  if (raw) {
    const plan = JSON.parse(raw) as { limit: number };
    return plan.limit;
  }
  return parseInt(env.FREE_QUOTA_LIMIT, 10);
}

export async function getQuotaStatus(env: Env, userId: string): Promise<QuotaStatus> {
  const [limit, raw] = await Promise.all([
    getPlanLimit(env, userId),
    env.QUOTAS.get(quotaKey(userId)),
  ]);
  const data: QuotaData = raw ? JSON.parse(raw) : { count: 0, updatedAt: new Date().toISOString() };
  return { used: data.count, limit, reset_at: getResetDate() };
}

export async function checkQuota(env: Env, userId: string): Promise<QuotaStatus> {
  const status = await getQuotaStatus(env, userId);
  if (status.used >= status.limit) {
    throw new MCPError('QUOTA_EXCEEDED', `Monthly quota exceeded (${status.used}/${status.limit}). Quota resets on ${status.reset_at}.`, { used: status.used, limit: status.limit, reset_at: status.reset_at });
  }
  return status;
}

export async function incrementQuota(env: Env, userId: string): Promise<void> {
  const key = quotaKey(userId);
  const raw = await env.QUOTAS.get(key);
  const data: QuotaData = raw ? JSON.parse(raw) : { count: 0, updatedAt: '' };
  data.count += 1;
  data.updatedAt = new Date().toISOString();

  // TTL: expire at the end of the current month
  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const ttlSeconds = Math.floor((endOfMonth.getTime() - now.getTime()) / 1000);

  await env.QUOTAS.put(key, JSON.stringify(data), { expirationTtl: ttlSeconds });
}
