import type { Env } from './types';
import { lookupSession, storeOAuthState, getOAuthState, storeAuthCode, consumeAuthCode, exchangeGitHubCode, createSession, generateToken, verifyPKCE } from './auth';
import { handleMCPRequest } from './mcp';
import { MCPError } from './errors';
import { generateOutputKey, uploadToR2, outputUrl, FILE_TTL_MS } from './file-handler';

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

    // ── File upload ───────────────────────────────────────────────────────────
    if (url.pathname === '/upload' && request.method === 'POST') {
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

      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return Response.json({ error: 'invalid_request', message: 'Expected multipart/form-data with a "file" field' }, { status: 400 });
      }

      const fileEntry = form.get('file');
      if (!(fileEntry instanceof File) && !(fileEntry instanceof Blob)) {
        return Response.json({ error: 'invalid_request', message: 'Missing "file" field' }, { status: 400 });
      }

      const ALLOWED_TYPES = new Set(['image/png', 'image/gif', 'image/webp']);
      const contentType = (fileEntry as File).type || '';
      if (!ALLOWED_TYPES.has(contentType)) {
        return Response.json({ error: 'invalid_content_type', message: `Content-Type '${contentType}' not accepted. Expected image/png, image/gif, or image/webp` }, { status: 400 });
      }

      const MAX_BYTES = 20 * 1024 * 1024;
      if ((fileEntry as File).size > MAX_BYTES) {
        return Response.json({ error: 'file_too_large', message: `File size ${(fileEntry as File).size} exceeds 20 MB limit` }, { status: 400 });
      }

      const buffer = await (fileEntry as File).arrayBuffer();
      const key = generateOutputKey(contentType);
      await uploadToR2(env, key, buffer, contentType);

      return Response.json({
        url: outputUrl(env, key),
        expires_at: new Date(Date.now() + FILE_TTL_MS).toISOString(),
        content_type: contentType,
        size_bytes: (fileEntry as File).size,
      }, { status: 201 });
    }

    // ── R2 output file serving ────────────────────────────────────────────────
    if (url.pathname.startsWith('/output/') && (request.method === 'GET' || request.method === 'HEAD')) {
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
          'Cache-Control': 'private, max-age=3600',
          'Content-Disposition': `${(obj.httpMetadata?.contentType ?? '').startsWith('image/') ? 'inline' : 'attachment'}; filename="${key}"`,
        },
      });
    }

    // ── Health check ──────────────────────────────────────────────────────────
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok' });
    }

    // ── Landing page ──────────────────────────────────────────────────────────
    if (url.pathname === '/' && (request.method === 'GET' || request.method === 'HEAD')) {
      const body = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Spritesheet Forge MCP</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
  h1 { font-size: 1.6rem; margin-bottom: .25rem; }
  h2 { font-size: 1.1rem; margin-top: 2rem; border-bottom: 1px solid #eee; padding-bottom: .3rem; }
  code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: .9em; }
  pre { background: #f4f4f4; padding: 12px 16px; border-radius: 6px; overflow-x: auto; }
  a { color: #0066cc; }
  ul { padding-left: 1.4rem; }
  li { margin: .3rem 0; }
  .badge { display: inline-block; background: #e8f4e8; color: #2a7a2a; border-radius: 4px; padding: 2px 8px; font-size: .85em; }
</style>
</head>
<body>
<h1>Spritesheet Forge MCP <span class="badge">hosted</span></h1>
<p>A remote <a href="https://modelcontextprotocol.io">Model Context Protocol</a> server for game-dev spritesheet workflows.
Connect it to Claude or any MCP-compatible AI client to pack, split, trim, and animate sprites through natural language.</p>

<p><strong>GitHub:</strong> <a href="https://github.com/LAXY9887/Game-Dev.-Spritesheet-Forge">LAXY9887/Game-Dev.-Spritesheet-Forge</a><br>
<strong>MCP endpoint:</strong> <code>${env.WORKER_BASE_URL}/mcp</code></p>

<h2>Available Tools (8)</h2>
<ul>
  <li><code>server_info</code> — Runtime config: upload URL, TTL, file size limits, encoding rules</li>
  <li><code>gif_to_spritesheet</code> — Convert GIF animation into a spritesheet PNG grid</li>
  <li><code>gif_to_frames</code> — Extract GIF frames as individual PNGs (ZIP)</li>
  <li><code>spritesheet_to_animation</code> — Slice spritesheet back into animated GIF / WebP</li>
  <li><code>frames_to_animation</code> — Assemble PNG frames into animated GIF / WebP</li>
  <li><code>png_to_spritesheet</code> — Merge multiple PNGs into a spritesheet (grid / packed / horizontal / vertical)</li>
  <li><code>split_spritesheet</code> — Split spritesheet into frames + optional TexturePacker atlas JSON</li>
  <li><code>trim_png</code> — Crop transparent edges from PNG files</li>
</ul>

<h2>Quick Start</h2>
<p><strong>Claude Desktop</strong> — add to <code>claude_desktop_config.json</code>:</p>
<pre>{
  "mcpServers": {
    "spritesheet-forge": {
      "type": "http",
      "url": "${env.WORKER_BASE_URL}/mcp"
    }
  }
}</pre>
<p><strong>Claude Code (CLI):</strong></p>
<pre>claude mcp add spritesheet-forge --transport http ${env.WORKER_BASE_URL}/mcp</pre>
<p>On first use, your MCP client will open a GitHub login page to authorize access.</p>

<h2>Authentication</h2>
<p>Uses <strong>GitHub OAuth 2.1 with PKCE</strong>. MCP clients handle the flow automatically.
For manual token acquisition (curl testing, benchmark), run:</p>
<pre>python3 scripts/get-token.py</pre>
<p>from the repository root. Discovery endpoint: <a href="${env.WORKER_BASE_URL}/.well-known/oauth-authorization-server"><code>/.well-known/oauth-authorization-server</code></a></p>

<h2>File Input Rules</h2>
<ul>
  <li><strong>&lt; 4 MB:</strong> base64-encode bytes, prepend <code>data:&lt;mime&gt;;base64,</code> — strip ALL whitespace from the base64 string</li>
  <li><strong>≥ 4 MB:</strong> <code>POST ${env.WORKER_BASE_URL}/upload</code> (multipart/form-data, field <code>file</code>, Bearer token) → pass returned URL</li>
  <li><strong>Previous tool output:</strong> pass the URL directly — no re-encoding needed</li>
  <li><strong>Output TTL:</strong> all URLs expire 1 hour after creation</li>
</ul>

<h2>Limits</h2>
<ul>
  <li>Max file size: 20 MB</li>
  <li>Free quota: 100 operations / GitHub account / month</li>
  <li>Session token lifetime: 30 days</li>
</ul>

<p style="margin-top:3rem;color:#888;font-size:.85em">MIT License &mdash; <a href="https://github.com/LAXY9887/Game-Dev.-Spritesheet-Forge">source on GitHub</a></p>
</body>
</html>`;
      return new Response(body, {
        headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'public, max-age=300' },
      });
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const now = new Date();
    let cursor: string | undefined;
    let deleted = 0;

    do {
      const listed = await env.SPRITESHEET_OUTPUT.list({ cursor, limit: 1000 });
      for (const obj of listed.objects) {
        const expiresAt = obj.customMetadata?.expiresAt;
        if (expiresAt && new Date(expiresAt) < now) {
          await env.SPRITESHEET_OUTPUT.delete(obj.key);
          deleted++;
        }
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

    console.log(`R2 cleanup: deleted ${deleted} expired objects`);
  },
};
