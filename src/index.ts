import type { Env } from './types';
import { lookupSession, storeOAuthState, getOAuthState, storeAuthCode, consumeAuthCode, exchangeGitHubCode, createSession, generateToken, verifyPKCE } from './auth';
import { handleMCPRequest } from './mcp';
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

      const rawEntry = form.get('file');
      if (!rawEntry) {
        return Response.json({ error: 'invalid_request', message: 'Missing "file" field' }, { status: 400 });
      }
      const fileEntry = rawEntry as unknown as File;

      const ALLOWED_TYPES = new Set(['image/png', 'image/gif', 'image/webp']);
      const contentType = fileEntry.type || '';
      if (!ALLOWED_TYPES.has(contentType)) {
        return Response.json({ error: 'invalid_content_type', message: `Content-Type '${contentType}' not accepted. Expected image/png, image/gif, or image/webp` }, { status: 400 });
      }

      const MAX_BYTES = 20 * 1024 * 1024;
      if (fileEntry.size > MAX_BYTES) {
        return Response.json({ error: 'file_too_large', message: `File size ${fileEntry.size} exceeds 20 MB limit` }, { status: 400 });
      }

      const buffer = await fileEntry.arrayBuffer();
      const key = generateOutputKey(contentType);
      await uploadToR2(env, key, buffer, contentType);

      return Response.json({
        url: outputUrl(env, key),
        expires_at: new Date(Date.now() + FILE_TTL_MS).toISOString(),
        content_type: contentType,
        size_bytes: fileEntry.size,
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
      const base = env.WORKER_BASE_URL;
      const body = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Spritesheet Forge MCP</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:860px;margin:40px auto;padding:0 20px;color:#1a1a1a;line-height:1.6}
  h1{font-size:1.7rem;margin-bottom:.2rem}
  h2{font-size:1.1rem;margin-top:2.2rem;border-bottom:1px solid #e0e0e0;padding-bottom:.35rem;color:#333}
  h3{font-size:.95rem;margin:1.2rem 0 .4rem;color:#444}
  code{background:#f4f4f4;padding:2px 6px;border-radius:3px;font-size:.88em}
  pre{background:#f4f4f4;padding:12px 16px;border-radius:6px;overflow-x:auto;font-size:.88em}
  a{color:#0066cc}
  ul,ol{padding-left:1.5rem}
  li{margin:.3rem 0}
  table{border-collapse:collapse;width:100%;font-size:.88em;margin:.6rem 0}
  th{background:#f0f0f0;text-align:left;padding:5px 10px;border:1px solid #ddd}
  td{padding:4px 10px;border:1px solid #ddd;vertical-align:top}
  td:first-child code{white-space:nowrap}
  .badge{display:inline-block;background:#e8f4e8;color:#2a7a2a;border-radius:4px;padding:2px 8px;font-size:.82em}
  .warn{background:#fff8e1;border-left:3px solid #f9a825;padding:8px 12px;border-radius:0 4px 4px 0;margin:.6rem 0}
  .tip{background:#e8f4fd;border-left:3px solid #1976d2;padding:8px 12px;border-radius:0 4px 4px 0;margin:.6rem 0}
  details{margin:.5rem 0}
  summary{cursor:pointer;font-weight:600;color:#0066cc}
</style>
</head>
<body>
<h1>Spritesheet Forge MCP <span class="badge">hosted</span></h1>
<p>A remote <a href="https://modelcontextprotocol.io">Model Context Protocol</a> server for game-dev spritesheet workflows.
Connect it to Claude or any MCP-compatible AI client to pack, split, trim, and animate sprites through natural language — no local tools required.</p>
<p>
  <strong>MCP endpoint:</strong> <code>${base}/mcp</code> &nbsp;|&nbsp;
  <strong>GitHub:</strong> <a href="https://github.com/LAXY9887/Game-Dev.-Spritesheet-Forge">LAXY9887/Game-Dev.-Spritesheet-Forge</a>
</p>

<h2>Quick Start</h2>
<h3>Claude Desktop</h3>
<p>Add to <code>claude_desktop_config.json</code>:</p>
<pre>{
  "mcpServers": {
    "spritesheet-forge": {
      "type": "http",
      "url": "${base}/mcp"
    }
  }
}</pre>
<h3>Claude Code (CLI)</h3>
<pre>claude mcp add spritesheet-forge --transport http ${base}/mcp</pre>
<p>On first use, your MCP client will open a GitHub login page. Approve access and the session is stored for 30 days — no further action needed.</p>

<h2>Authentication</h2>
<p>Uses <strong>GitHub OAuth 2.1 with PKCE</strong>. MCP clients (Claude Desktop, Claude Code) run the flow automatically.</p>
<p><strong>To get a Bearer token manually</strong> (for curl, benchmark scripts, or custom integrations):</p>
<ol>
  <li>Clone the repository and run: <code>python3 scripts/get-token.py</code></li>
  <li>The script registers an OAuth client, opens your browser for GitHub login, and prints the token.</li>
  <li>Use it as: <code>Authorization: Bearer &lt;token&gt;</code></li>
</ol>
<p>Token lifetime: <strong>30 days</strong>. OAuth discovery: <a href="${base}/.well-known/oauth-authorization-server"><code>/.well-known/oauth-authorization-server</code></a></p>

<h2>File Input Rules</h2>
<div class="tip">Agents: call <code>server_info</code> to get the runtime upload URL, exact TTL, and encoding rules before processing large files.</div>
<p>All <code>file</code> / <code>files</code> parameters accept three input types:</p>
<table>
  <tr><th>Condition</th><th>Method</th></tr>
  <tr><td>File &lt; ~185 KB<br><em>(AI agents: inline-safe)</em></td><td>Base64-encode bytes → prepend <code>data:&lt;mime&gt;;base64,</code><br><strong>Strip ALL whitespace and newlines from the base64 string before prepending.</strong> Many encoders (e.g. <code>openssl base64</code>) insert newlines every 76 chars — these cause <code>INVALID_BASE64</code>.</td></tr>
  <tr><td>File ≥ ~185 KB<br><em>(or any file encoded via shell)</em></td><td><code>POST ${base}/upload</code> (multipart/form-data, field <code>file</code>, Bearer token required) → use <code>"url"</code> from response.<br><strong>AI agents:</strong> shell output &gt; ~250 KB is stored to a temp file that cannot be read back (256 KB tool limit). This makes base64 impractical for files larger than ~185 KB even when under the 4 MB MCP payload limit. When in doubt, use upload.</td></tr>
  <tr><td>Previous tool output</td><td>Pass the output <code>url</code> directly — server reads from its own storage, no HTTP round-trip.</td></tr>
</table>
<div class="warn"><strong>Output TTL:</strong> all output URLs (tools + uploads) expire <strong>1 hour</strong> after creation. Do not cache them across sessions. If a URL is stale, re-run the originating tool.</div>

<h2>Tool Output Format</h2>
<p>Every tool returns a JSON object in <code>content[0].text</code>:</p>
<pre>{
  "url": "${base}/output/output-abc123.png",
  "expires_at": "2026-05-05T13:00:00.000Z",
  "content_type": "image/png",
  "size_bytes": 516432,
  "quota": { "used": 4, "limit": 100, "reset_at": "2026-06-01T00:00:00.000Z" }
}</pre>
<p>Pass <code>url</code> directly as <code>file</code> input to the next tool. The output URL is also a direct browser-viewable download link.</p>

<h2>Available Tools</h2>

<h3><code>server_info</code> — Runtime configuration</h3>
<p>Returns upload URL, TTL, file size limits, and encoding rules. <strong>Call this first</strong> when working with large files or building chained workflows. No parameters required.</p>

<h3><code>gif_to_spritesheet</code> — GIF → spritesheet PNG</h3>
<table>
  <tr><th>Parameter</th><th>Type</th><th>Default</th><th>Description</th></tr>
  <tr><td><code>file</code></td><td>string</td><td>required</td><td>GIF file input</td></tr>
  <tr><td><code>columns</code></td><td>integer</td><td>auto</td><td>Grid columns</td></tr>
  <tr><td><code>padding</code></td><td>integer</td><td>0</td><td>Pixel gap between frames</td></tr>
  <tr><td><code>remove_bg</code></td><td>boolean</td><td>false</td><td>Remove background from each frame</td></tr>
  <tr><td><code>bg_color</code></td><td>string</td><td>"auto"</td><td>"auto" or "#RRGGBB"</td></tr>
  <tr><td><code>tolerance</code></td><td>integer</td><td>30</td><td>Background removal threshold 0–255</td></tr>
</table>

<h3><code>gif_to_frames</code> — GIF → individual PNGs (ZIP)</h3>
<table>
  <tr><th>Parameter</th><th>Type</th><th>Default</th><th>Description</th></tr>
  <tr><td><code>file</code></td><td>string</td><td>required</td><td>GIF file input</td></tr>
  <tr><td><code>remove_bg</code></td><td>boolean</td><td>false</td><td>Remove background</td></tr>
  <tr><td><code>bg_color</code></td><td>string</td><td>"auto"</td><td>"auto" or "#RRGGBB"</td></tr>
  <tr><td><code>tolerance</code></td><td>integer</td><td>30</td><td>Background removal threshold 0–255</td></tr>
</table>

<h3><code>spritesheet_to_animation</code> — Spritesheet PNG → animated GIF/WebP</h3>
<p>Grid mode: provide <code>columns</code> + <code>rows</code>. Cell mode: provide <code>cell_width</code> + <code>cell_height</code>.</p>
<table>
  <tr><th>Parameter</th><th>Type</th><th>Default</th><th>Description</th></tr>
  <tr><td><code>file</code></td><td>string</td><td>required</td><td>Spritesheet PNG input</td></tr>
  <tr><td><code>columns</code></td><td>integer</td><td>—</td><td>Grid columns</td></tr>
  <tr><td><code>rows</code></td><td>integer</td><td>—</td><td>Grid rows</td></tr>
  <tr><td><code>cell_width</code></td><td>integer</td><td>—</td><td>Cell width px (cell mode)</td></tr>
  <tr><td><code>cell_height</code></td><td>integer</td><td>—</td><td>Cell height px (cell mode)</td></tr>
  <tr><td><code>frame_count</code></td><td>integer</td><td>—</td><td>Actual frames (for incomplete last row)</td></tr>
  <tr><td><code>padding</code></td><td>integer</td><td>0</td><td>Pixel gap between cells</td></tr>
  <tr><td><code>column_range</code></td><td>string</td><td>—</td><td>e.g. "0-5" or "2"</td></tr>
  <tr><td><code>row_range</code></td><td>string</td><td>—</td><td>e.g. "0-3"</td></tr>
  <tr><td><code>skip_empty</code></td><td>boolean</td><td>true</td><td>Remove fully transparent frames</td></tr>
  <tr><td><code>trim_top/right/bottom/left</code></td><td>integer</td><td>0</td><td>Per-edge trim offsets</td></tr>
  <tr><td><code>duration</code></td><td>integer</td><td>100</td><td>Frame duration in ms</td></tr>
  <tr><td><code>loop</code></td><td>integer</td><td>0</td><td>Loop count (0 = infinite)</td></tr>
  <tr><td><code>output_format</code></td><td>string</td><td>"gif"</td><td>"gif" | "webp"</td></tr>
  <tr><td><code>quality</code></td><td>integer</td><td>80</td><td>WebP quality 0–100</td></tr>
  <tr><td><code>lossless</code></td><td>boolean</td><td>false</td><td>WebP lossless mode</td></tr>
</table>

<h3><code>frames_to_animation</code> — PNG frames → animated GIF/WebP</h3>
<table>
  <tr><th>Parameter</th><th>Type</th><th>Default</th><th>Description</th></tr>
  <tr><td><code>files</code></td><td>string[]</td><td>required</td><td>PNG frames</td></tr>
  <tr><td><code>duration</code></td><td>integer</td><td>100</td><td>Frame duration ms (10–10000)</td></tr>
  <tr><td><code>loop</code></td><td>integer</td><td>0</td><td>Loop count (0 = infinite)</td></tr>
  <tr><td><code>file_name_order</code></td><td>boolean</td><td>false</td><td>Sort by _N filename suffix</td></tr>
  <tr><td><code>resize</code></td><td>string</td><td>"transparent"</td><td>"error" | "fill" | "transparent"</td></tr>
  <tr><td><code>bg_fill_color</code></td><td>string</td><td>"#000000"</td><td>Fill color when resize=fill</td></tr>
  <tr><td><code>output_format</code></td><td>string</td><td>"gif"</td><td>"gif" | "webp"</td></tr>
  <tr><td><code>quality</code></td><td>integer</td><td>80</td><td>WebP quality 0–100</td></tr>
  <tr><td><code>lossless</code></td><td>boolean</td><td>false</td><td>WebP lossless mode</td></tr>
</table>

<h3><code>png_to_spritesheet</code> — Multiple PNGs → spritesheet</h3>
<table>
  <tr><th>Parameter</th><th>Type</th><th>Default</th><th>Description</th></tr>
  <tr><td><code>files</code></td><td>string[]</td><td>required</td><td>PNG files</td></tr>
  <tr><td><code>layout</code></td><td>string</td><td>"grid"</td><td>"grid" | "horizontal" | "vertical" | "packed"</td></tr>
  <tr><td><code>columns</code></td><td>integer</td><td>auto</td><td>Grid columns</td></tr>
  <tr><td><code>cell_mode</code></td><td>string</td><td>"auto_max"</td><td>"auto_max" | "auto_uniform" | "fixed"</td></tr>
  <tr><td><code>cell_width</code></td><td>integer</td><td>—</td><td>Required when cell_mode=fixed</td></tr>
  <tr><td><code>cell_height</code></td><td>integer</td><td>—</td><td>Required when cell_mode=fixed</td></tr>
  <tr><td><code>fit_mode</code></td><td>string</td><td>—</td><td>"scale_fit" | "scale_fill" | "error"</td></tr>
  <tr><td><code>align</code></td><td>string</td><td>—</td><td>"center" | "top_left"</td></tr>
  <tr><td><code>padding</code></td><td>integer</td><td>0</td><td>Pixel gap between frames</td></tr>
  <tr><td><code>bg_color</code></td><td>string</td><td>"transparent"</td><td>"transparent" or "#RRGGBB"</td></tr>
  <tr><td><code>power_of_2</code></td><td>boolean</td><td>false</td><td>Pad output to next power of 2</td></tr>
  <tr><td><code>file_name_order</code></td><td>boolean</td><td>false</td><td>Sort by _N filename suffix</td></tr>
  <tr><td><code>trim_input</code></td><td>boolean</td><td>false</td><td>Auto-trim transparent edges before packing</td></tr>
  <tr><td><code>extrude</code></td><td>integer</td><td>0</td><td>Extrude outermost pixels by N px per frame</td></tr>
  <tr><td><code>metadata_format</code></td><td>string</td><td>"none"</td><td>"none" | "json_array" | "json_hash" | "css" — required (non-none) for layout=packed</td></tr>
</table>

<h3><code>split_spritesheet</code> — Spritesheet → frames + atlas JSON</h3>
<p>Grid mode: provide <code>columns</code> + <code>rows</code>. Cell mode: provide <code>cell_width</code> + <code>cell_height</code>.</p>
<table>
  <tr><th>Parameter</th><th>Type</th><th>Default</th><th>Description</th></tr>
  <tr><td><code>file</code></td><td>string</td><td>required</td><td>Spritesheet PNG input</td></tr>
  <tr><td><code>columns</code></td><td>integer</td><td>—</td><td>Grid columns</td></tr>
  <tr><td><code>rows</code></td><td>integer</td><td>—</td><td>Grid rows</td></tr>
  <tr><td><code>cell_width</code></td><td>integer</td><td>—</td><td>Cell width px (cell mode)</td></tr>
  <tr><td><code>cell_height</code></td><td>integer</td><td>—</td><td>Cell height px (cell mode)</td></tr>
  <tr><td><code>padding</code></td><td>integer</td><td>0</td><td>Pixel gap between cells</td></tr>
  <tr><td><code>frame_count</code></td><td>integer</td><td>—</td><td>Actual frames for incomplete last row</td></tr>
  <tr><td><code>column_range</code></td><td>string</td><td>—</td><td>e.g. "0-5" or "2"</td></tr>
  <tr><td><code>row_range</code></td><td>string</td><td>—</td><td>e.g. "0-3"</td></tr>
  <tr><td><code>skip_empty</code></td><td>boolean</td><td>true</td><td>Remove fully transparent frames</td></tr>
  <tr><td><code>trim_top/right/bottom/left</code></td><td>integer</td><td>0</td><td>Per-edge trim offsets</td></tr>
  <tr><td><code>output</code></td><td>string</td><td>"frames"</td><td>"frames" | "metadata" | "both"</td></tr>
  <tr><td><code>metadata_format</code></td><td>string</td><td>—</td><td>"json_array" | "json_hash" | "css"</td></tr>
</table>

<h3><code>trim_png</code> — Crop transparent edges</h3>
<table>
  <tr><th>Parameter</th><th>Type</th><th>Default</th><th>Description</th></tr>
  <tr><td><code>files</code></td><td>string[]</td><td>required</td><td>PNG files (single → PNG, multiple → ZIP)</td></tr>
  <tr><td><code>threshold</code></td><td>integer</td><td>0</td><td>Alpha threshold 0–255. Pixels ≤ threshold are trimmed.</td></tr>
  <tr><td><code>padding</code></td><td>integer</td><td>0</td><td>Transparent margin to preserve around content</td></tr>
</table>

<h2>Agent Workflow Guide</h2>
<div class="tip"><strong>Recommended context to give an agent:</strong> "I've connected Spritesheet Forge MCP. For files ≥ 4 MB, call <code>server_info</code> first to get the upload URL, then POST the file there before calling the processing tool. Output URLs expire in 1 hour."</div>

<h3>Chaining tool outputs</h3>
<p>Pass the <code>url</code> from one tool directly as <code>file</code> input to the next — no re-encoding needed. Example chain:</p>
<pre>gif_to_spritesheet → split_spritesheet → frames_to_animation</pre>
<p>The server reads chained URLs directly from its own storage with no HTTP overhead.</p>

<h3>Token for the upload endpoint</h3>
<p>The upload endpoint requires a Bearer token. MCP clients (Claude Desktop, Claude Code) store this token in an encrypted internal store that <strong>cannot be read from the filesystem</strong> — there is no config file or keychain entry accessible to users or agents.</p>
<p>The only reliable method is the helper script in the <a href="https://github.com/LAXY9887/Game-Dev.-Spritesheet-Forge">spritesheet-forge repository</a>:</p>
<ol>
  <li>Clone or download: <code>git clone https://github.com/LAXY9887/Game-Dev.-Spritesheet-Forge</code></li>
  <li>Run: <code>python3 scripts/get-token.py</code></li>
  <li>GitHub login opens in the browser. After approving, the token is printed and saved to <code>~/.spritesheet-forge-token</code>.</li>
  <li>Pass it to the agent: <em>"Here is my upload token: Bearer &lt;token&gt;"</em></li>
</ol>
<p>If the user cannot obtain a token, ask them to provide the file as a <strong>public HTTPS URL</strong> instead.</p>

<h3>TTL in long workflows</h3>
<p>All output URLs expire <strong>1 hour</strong> after creation. If a multi-step workflow spans more than one hour, re-run the step that produced the stale URL rather than retrying with it.</p>

<h2>Limits &amp; Quotas</h2>
<table>
  <tr><th>Limit</th><th>Value</th></tr>
  <tr><td>Max file size</td><td>20 MB</td></tr>
  <tr><td>Recommended base64 limit</td><td>4 MB (use upload endpoint above this)</td></tr>
  <tr><td>Output / upload file TTL</td><td>1 hour</td></tr>
  <tr><td>Free quota</td><td>100 operations / GitHub account / month</td></tr>
  <tr><td>Quota reset</td><td>1st of each month</td></tr>
  <tr><td>Session token lifetime</td><td>30 days</td></tr>
  <tr><td>Supported input formats</td><td>PNG, GIF, WebP</td></tr>
</table>

<h2>Common Errors</h2>
<details>
  <summary>INVALID_BASE64</summary>
  <p>The base64 string contains whitespace or newlines. Strip them before prepending the data URI: <code>base64 -i file.gif | tr -d '\\n'</code>, or in Python: <code>base64.b64encode(data).decode()</code> (no newlines by default).</p>
</details>
<details>
  <summary>INVALID_FILE_URL — File not found or expired</summary>
  <p>The output URL has passed its 1-hour TTL. Re-run the tool that produced it to get a fresh URL.</p>
</details>
<details>
  <summary>INVALID_CONTENT_TYPE</summary>
  <p>Only PNG, GIF, and WebP are accepted as input. JPEG and other formats are not supported.</p>
</details>
<details>
  <summary>FILE_TOO_LARGE</summary>
  <p>The file exceeds the 20 MB limit. Split or compress the file before uploading.</p>
</details>
<details>
  <summary>quota_exceeded</summary>
  <p>You have used all 100 free operations for this month. Quota resets on the 1st. Check <code>quota.reset_at</code> in any tool response for the exact reset time.</p>
</details>
<details>
  <summary>Upload returns 401 Unauthorized</summary>
  <p>The Bearer token is missing or invalid. Obtain a token via <code>python3 scripts/get-token.py</code> or by connecting through an MCP client.</p>
</details>

<p style="margin-top:3rem;color:#999;font-size:.85em">
  <a href="https://github.com/LAXY9887/Game-Dev.-Spritesheet-Forge">GitHub</a> &mdash; MIT License
</p>
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
