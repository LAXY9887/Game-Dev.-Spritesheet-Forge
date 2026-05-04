import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getQuotaStatus, checkQuota, incrementQuota, getResetDate } from '../src/quota';
import { MCPError } from '../src/errors';
import type { Env } from '../src/types';

function makeKv(initialCount: number | null) {
  const store = new Map<string, string>();
  if (initialCount !== null) {
    const now = new Date().toISOString();
    store.set(`quota:user1:${new Date().toISOString().slice(0, 7)}`, JSON.stringify({ count: initialCount, updatedAt: now }));
  }
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
  };
}

function makeEnv(count: number | null, limit = '100') {
  return {
    QUOTAS: makeKv(count),
    FREE_QUOTA_LIMIT: limit,
  } as unknown as Env;
}

describe('getQuotaStatus', () => {
  it('returns 0 used when no KV entry exists', async () => {
    const env = makeEnv(null);
    const status = await getQuotaStatus(env, 'user1');
    expect(status.used).toBe(0);
    expect(status.limit).toBe(100);
    expect(status.reset_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns current count when entry exists', async () => {
    const env = makeEnv(42);
    const status = await getQuotaStatus(env, 'user1');
    expect(status.used).toBe(42);
  });
});

describe('checkQuota', () => {
  it('passes when under limit', async () => {
    const env = makeEnv(50);
    await expect(checkQuota(env, 'user1')).resolves.not.toThrow();
  });

  it('throws QUOTA_EXCEEDED when at limit', async () => {
    const env = makeEnv(100);
    try {
      await checkQuota(env, 'user1');
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as MCPError).code).toBe('QUOTA_EXCEEDED');
    }
  });
});

describe('incrementQuota', () => {
  it('increments count from null to 1', async () => {
    const env = makeEnv(null);
    await incrementQuota(env, 'user1');
    const status = await getQuotaStatus(env, 'user1');
    expect(status.used).toBe(1);
  });

  it('increments existing count', async () => {
    const env = makeEnv(41);
    await incrementQuota(env, 'user1');
    const status = await getQuotaStatus(env, 'user1');
    expect(status.used).toBe(42);
  });
});

describe('getResetDate', () => {
  it('returns first day of next month', () => {
    const reset = getResetDate();
    const d = new Date(reset);
    expect(d.getDate()).toBe(1);
    expect(d > new Date()).toBe(true);
  });
});
