import type { Env } from './types';
import { lookupSession, storeOAuthState, getOAuthState, storeAuthCode, consumeAuthCode, exchangeGitHubCode, createSession, generateToken, verifyPKCE } from './auth';
import { handleMCPRequest } from './mcp';
import { MCPError } from './errors';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ── OAuth 2.1 Authorization Server metadata ──────────────────────────────
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return Response.json({
        issuer: env.WORKER_BASE_URL,
        authorization_endpoint: `${env.WORKER_BASE_URL}/oauth/authorize`,
        token_endpoint: `${env.WORKER_BASE_URL}/oauth/token`,
        registration_endpoint: `${env.WORKER_BASE_URL}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
    }

    // ── OAuth: dynamic client registration (RFC 7591) ────────────────────────
    if (url.pathname === '/oauth/register' && request.method === 'POST') {
      let body: Record<string, unknown>;
      try {
        body = await request.json() as Record<string, unknown>;
      } catch {
        return Response.json({ error: 'invalid_client_metadata' }, { status: 400 });
      }

      const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris as string[] : [];
      if (redirectUris.length === 0) {
        return Response.json({ error: 'invalid_client_metadata', error_description: 'redirect_uris required' }, { status: 400 });
      }

      const clientId = crypto.randomUUID();
      await env.SESSIONS.put(
        `client:${clientId}`,
        JSON.stringify({ redirect_uris: redirectUris, client_name: body.client_name ?? 'MCP Client' }),
        { expirationTtl: 30 * 24 * 60 * 60 }
      );

      return Response.json({
        client_id: clientId,
        client_name: body.client_name ?? 'MCP Client',
        redirect_uris: redirectUris,
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }, { status: 201 });
    }

    // ── OAuth: start GitHub auth ─────────────────────────────────────────────
    if (url.pathname === '/oauth/authorize' && request.method === 'GET') {
      const clientRedirectUri = url.searchParams.get('redirect_uri') ?? '';
      const clientState = url.searchParams.get('state') ?? '';
      const codeChallenge = url.searchParams.get('code_challenge') ?? '';
      const clientId = url.searchParams.get('client_id') ?? '';

      if (!codeChallenge) {
        return new Response('Missing code_challenge (PKCE required)', { status: 400 });
      }

      // Validate dynamically registered client if client_id provided
      if (clientId) {
        const registration = await env.SESSIONS.get(`client:${clientId}`);
        if (!registration) {
          return new Response('Unknown client_id', { status: 400 });
        }
        const reg = JSON.parse(registration) as { redirect_uris: string[] };
        if (clientRedirectUri && !reg.redirect_uris.includes(clientRedirectUri)) {
          return new Response('redirect_uri not registered for this client', { status: 400 });
        }
      }

      const githubState = generateToken();
      await storeOAuthState(env, githubState, { clientRedirectUri, clientState, codeChallenge });

      const githubUrl = new URL('https://github.com/login/oauth/authorize');
      githubUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      githubUrl.searchParams.set('redirect_uri', `${env.WORKER_BASE_URL}/oauth/callback`);
      githubUrl.searchParams.set('state', githubState);
      githubUrl.searchParams.set('scope', 'read:user');

      return Response.redirect(githubUrl.toString(), 302);
    }

    // ── OAuth: GitHub callback ───────────────────────────────────────────────
    if (url.pathname === '/oauth/callback' && request.method === 'GET') {
      const githubCode = url.searchParams.get('code');
      const githubState = url.searchParams.get('state');

      if (!githubCode || !githubState) {
        return new Response('Missing code or state', { status: 400 });
      }

      const oauthState = await getOAuthState(env, githubState);
      if (!oauthState) {
        return new Response('Invalid or expired state', { status: 400 });
      }

      let userInfo: { userId: string; login: string };
      try {
        userInfo = await exchangeGitHubCode(env, githubCode);
      } catch (err) {
        console.error('GitHub exchange failed:', err);
        return new Response('GitHub authentication failed', { status: 502 });
      }

      const authCode = generateToken();
      await storeAuthCode(env, authCode, {
        userId: userInfo.userId,
        login: userInfo.login,
        codeChallenge: oauthState.codeChallenge,
        clientRedirectUri: oauthState.clientRedirectUri,
        clientState: oauthState.clientState,
      });

      const redirectUrl = new URL(oauthState.clientRedirectUri);
      redirectUrl.searchParams.set('code', authCode);
      if (oauthState.clientState) redirectUrl.searchParams.set('state', oauthState.clientState);

      return Response.redirect(redirectUrl.toString(), 302);
    }

    // ── OAuth: token exchange ────────────────────────────────────────────────
    if (url.pathname === '/oauth/token' && request.method === 'POST') {
      let body: Record<string, string>;
      const ct = request.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        body = await request.json() as Record<string, string>;
      } else {
        const form = await request.formData();
        body = Object.fromEntries(form.entries()) as Record<string, string>;
      }

      const { grant_type, code, code_verifier } = body;

      if (grant_type !== 'authorization_code') {
        return Response.json({ error: 'unsupported_grant_type' }, { status: 400 });
      }
      if (!code || !code_verifier) {
        return Response.json({ error: 'invalid_request', error_description: 'Missing code or code_verifier' }, { status: 400 });
      }

      const authCodeData = await consumeAuthCode(env, code);
      if (!authCodeData) {
        return Response.json({ error: 'invalid_grant', error_description: 'Invalid or expired code' }, { status: 400 });
      }

      const pkceValid = await verifyPKCE(code_verifier, authCodeData.codeChallenge);
      if (!pkceValid) {
        return Response.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, { status: 400 });
      }

      const accessToken = await createSession(env, authCodeData.userId, authCodeData.login);

      return Response.json({
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: 30 * 24 * 60 * 60,
      });
    }

    // ── MCP endpoint ──────────────────────────────────────────────────────────
    if (url.pathname === '/mcp' && request.method === 'GET') {
      const authHeader = request.headers.get('Authorization') ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!token) {
        return new Response('Unauthorized', {
          status: 401,
          headers: { 'WWW-Authenticate': `Bearer realm="${env.WORKER_BASE_URL}"` },
        });
      }
      const session = await lookupSession(env, token);
      if (!session) {
        return new Response('Unauthorized', {
          status: 401,
          headers: { 'WWW-Authenticate': `Bearer realm="${env.WORKER_BASE_URL}", error="invalid_token"` },
        });
      }
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      writer.write(encoder.encode(': keep-alive\n\n'));
      writer.close();
      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });
    }

    if (url.pathname === '/mcp' && request.method === 'POST') {
      // Peek at the method to allow unauthenticated handshake methods
      let body: { method?: string; id?: unknown };
      try {
        body = await request.clone().json() as { method?: string; id?: unknown };
      } catch {
        return Response.json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }, { status: 400 });
      }

      const isHandshake = body.method === 'initialize' || body.method === 'notifications/initialized';

      const authHeader = request.headers.get('Authorization') ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (!token) {
        if (isHandshake) return handleMCPRequest(request, env, '');
        return Response.json(
          { jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: body.id ?? null },
          { status: 401, headers: { 'WWW-Authenticate': `Bearer realm="${env.WORKER_BASE_URL}"` } }
        );
      }

      const session = await lookupSession(env, token);
      if (!session) {
        if (isHandshake) return handleMCPRequest(request, env, '');
        return Response.json(
          { jsonrpc: '2.0', error: { code: -32001, message: 'Invalid or expired token' }, id: body.id ?? null },
          { status: 401, headers: { 'WWW-Authenticate': `Bearer realm="${env.WORKER_BASE_URL}", error="invalid_token"` } }
        );
      }

      return handleMCPRequest(request, env, session.userId);
    }

    // ── R2 output file serving ────────────────────────────────────────────────
    if (url.pathname.startsWith('/output/') && request.method === 'GET') {
      const key = url.pathname.slice('/output/'.length);
      if (!key) return new Response('Not found', { status: 404 });

      const obj = await env.SPRITESHEET_OUTPUT.get(key);
      if (!obj) return new Response('File not found or expired', { status: 404 });

      // Enforce 24h TTL via metadata
      const expiresAt = obj.customMetadata?.expiresAt;
      if (expiresAt && new Date(expiresAt) < new Date()) {
        await env.SPRITESHEET_OUTPUT.delete(key);
        return new Response('File expired', { status: 410 });
      }

      return new Response(obj.body, {
        headers: {
          'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
          'Cache-Control': 'private, max-age=86400',
          'Content-Disposition': `attachment; filename="${key}"`,
        },
      });
    }

    // ── Health check ──────────────────────────────────────────────────────────
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok' });
    }

    return new Response('Not found', { status: 404 });
  },
};
