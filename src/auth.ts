import type { Env, SessionData, AuthCodeData } from './types';

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPKCE(codeVerifier: string, codeChallenge: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return base64 === codeChallenge;
}

export async function lookupSession(env: Env, token: string): Promise<{ userId: string; login: string } | null> {
  const raw = await env.SESSIONS.get(`session:${token}`);
  if (!raw) return null;
  const data = JSON.parse(raw) as SessionData;
  return { userId: data.userId, login: data.login };
}

export async function createSession(env: Env, userId: string, login: string): Promise<string> {
  const token = generateToken();
  const data: SessionData = { userId, login, createdAt: new Date().toISOString() };
  const ttl = 30 * 24 * 60 * 60; // 30 days
  await env.SESSIONS.put(`session:${token}`, JSON.stringify(data), { expirationTtl: ttl });
  return token;
}

export async function storeOAuthState(
  env: Env,
  githubState: string,
  payload: { clientRedirectUri: string; clientState: string; codeChallenge: string }
): Promise<void> {
  await env.SESSIONS.put(`oauth_state:${githubState}`, JSON.stringify(payload), { expirationTtl: 600 }); // 10 min
}

export async function getOAuthState(env: Env, githubState: string): Promise<{
  clientRedirectUri: string;
  clientState: string;
  codeChallenge: string;
} | null> {
  const raw = await env.SESSIONS.get(`oauth_state:${githubState}`);
  if (!raw) return null;
  return JSON.parse(raw);
}

export async function storeAuthCode(env: Env, code: string, data: AuthCodeData): Promise<void> {
  await env.SESSIONS.put(`auth_code:${code}`, JSON.stringify(data), { expirationTtl: 600 }); // 10 min
}

export async function consumeAuthCode(env: Env, code: string): Promise<AuthCodeData | null> {
  const raw = await env.SESSIONS.get(`auth_code:${code}`);
  if (!raw) return null;
  await env.SESSIONS.delete(`auth_code:${code}`);
  return JSON.parse(raw) as AuthCodeData;
}

export async function exchangeGitHubCode(env: Env, code: string): Promise<{ userId: string; login: string }> {
  // Exchange GitHub code for access token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
  if (!tokenData.access_token) {
    throw new Error(`GitHub token exchange failed: ${tokenData.error ?? 'unknown error'}`);
  }

  // Get GitHub user info
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'User-Agent': 'spritesheet-forge-mcp/1.0',
    },
  });
  const user = await userRes.json() as { id: number; login: string };
  return { userId: `gh_${user.id}`, login: user.login };
}
