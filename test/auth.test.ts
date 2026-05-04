import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lookupSession, generateToken, verifyPKCE } from '../src/auth';
import type { Env } from '../src/types';

function makeEnv(sessionData: Record<string, string> | null = null) {
  const store = new Map<string, string>(sessionData ? Object.entries(sessionData) : []);
  return {
    SESSIONS: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
      delete: vi.fn(async (key: string) => { store.delete(key); }),
    },
  } as unknown as Env;
}

describe('lookupSession', () => {
  it('returns null for unknown token', async () => {
    const env = makeEnv();
    const result = await lookupSession(env, 'unknown-token');
    expect(result).toBeNull();
  });

  it('returns session data for valid token', async () => {
    const data = JSON.stringify({ userId: 'gh_12345', login: 'testuser', createdAt: new Date().toISOString() });
    const env = makeEnv({ 'session:abc123': data });
    const result = await lookupSession(env, 'abc123');
    expect(result).not.toBeNull();
    expect(result!.userId).toBe('gh_12345');
    expect(result!.login).toBe('testuser');
  });
});

describe('generateToken', () => {
  it('generates a 64-character hex string', () => {
    const token = generateToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generates unique tokens', () => {
    const t1 = generateToken();
    const t2 = generateToken();
    expect(t1).not.toBe(t2);
  });
});

describe('verifyPKCE', () => {
  it('returns true for a valid code_verifier and code_challenge pair', async () => {
    // Pre-computed: verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    // challenge "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(await verifyPKCE(verifier, challenge)).toBe(true);
  });

  it('returns false for a wrong verifier', async () => {
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(await verifyPKCE('wrong-verifier', challenge)).toBe(false);
  });
});
