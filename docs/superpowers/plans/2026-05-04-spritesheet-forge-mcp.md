# spritesheet-forge-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hosted remote MCP server on Cloudflare Workers that wraps PNG2SS and GIF2SS Cloud Run APIs with GitHub OAuth 2.1, per-user quota tracking, and SSRF-safe file handling.

**Architecture:** A single Cloudflare Worker acts as the MCP gateway — handling GitHub OAuth 2.1 (acting as an OAuth 2.1 Authorization Server with GitHub as IdP), a minimal MCP JSON-RPC handler, SSRF-guarded file I/O (URL or base64 input), and Cloudflare R2 for temporary output storage. Cloudflare KV stores OAuth sessions and per-user monthly quotas. The two Cloud Run backends (PNG2SS, GIF2SS) are unchanged except for accepting a new `X-MCP-Key` header.

**Tech Stack:** TypeScript, Cloudflare Workers, Cloudflare KV, Cloudflare R2, Wrangler 3, Vitest

---

## File Map

### New project root: `Game-Dev Spritesheet Tools MCP server/`

```
src/
├── index.ts          # Worker entry: route dispatch, OAuth metadata, /output serving
├── types.ts          # Env bindings interface, shared types, constants
├── errors.ts         # MCPError class, error codes, formatError()
├── ssrf-guard.ts     # validateUrl() — blocks private IPs, non-HTTPS, metadata endpoints
├── file-handler.ts   # resolveFileInput(), generateOutputKey(), uploadToR2(), outputUrl()
├── quota.ts          # checkQuota(), incrementQuota(), getQuotaStatus()
├── auth.ts           # lookupSession(), GitHub OAuth flow handlers, token helpers
├── mcp.ts            # handleMCPRequest() — MCP JSON-RPC dispatcher
└── tools/
    ├── index.ts      # ToolRegistry class, toolRegistry singleton, re-exports
    ├── png2ss.ts     # Registers: png_to_spritesheet, split_spritesheet, trim_png
    └── gif2ss.ts     # Registers: gif_to_spritesheet, gif_to_frames, frames_to_animation, spritesheet_to_animation

test/
├── ssrf-guard.test.ts
├── file-handler.test.ts
├── quota.test.ts
├── auth.test.ts
└── tools/
    ├── png2ss.test.ts
    └── gif2ss.test.ts

wrangler.toml
vitest.config.ts
package.json
tsconfig.json
```

### Existing files to modify (no commit):

- `/Users/yu-hung/Desktop/MyRepos/DNGTaMe/PNG2SS/app/main.py` — add X-MCP-Key auth
- `/Users/yu-hung/Desktop/MyRepos/DNGTaMe/PNG2SS/docs/png2ss-api-reference.md` — document X-MCP-Key
- `/Users/yu-hung/Desktop/MyRepos/DNGTaMe/PNG2SS/README.md` — document X-MCP-Key
- `/Users/yu-hung/Desktop/MyRepos/DNGTaMe/GIF2SS/app/main.py` — add X-MCP-Key auth
- `/Users/yu-hung/Desktop/MyRepos/DNGTaMe/GIF2SS/docs/gif2ss-api-reference.md` — document X-MCP-Key
- `/Users/yu-hung/Desktop/MyRepos/DNGTaMe/GIF2SS/README.md` — document X-MCP-Key

---

## Task 1: Add X-MCP-Key to PNG2SS

**Files:**
- Modify: `/Users/yu-hung/Desktop/MyRepos/DNGTaMe/PNG2SS/app/main.py:24-43`

- [ ] **Step 1: Edit PNG2SS auth middleware**

Replace lines 24–43 in `app/main.py` with:

```python
_PROXY_SECRET = os.getenv("RAPIDAPI_PROXY_SECRET")
_INTERNAL_KEY = os.getenv("INTERNAL_KEY")
_MCP_KEY = os.getenv("MCP_KEY")

if not _PROXY_SECRET and not _INTERNAL_KEY and not _MCP_KEY:
    logger.warning(
        "RAPIDAPI_PROXY_SECRET, INTERNAL_KEY, and MCP_KEY are all unset — service is open. "
        "Set at least one in production."
    )


@app.middleware("http")
async def verify_access(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    if _PROXY_SECRET or _INTERNAL_KEY or _MCP_KEY:
        proxy_ok = _PROXY_SECRET and request.headers.get("X-RapidAPI-Proxy-Secret", "") == _PROXY_SECRET
        internal_ok = _INTERNAL_KEY and request.headers.get("X-Internal-Key", "") == _INTERNAL_KEY
        mcp_ok = _MCP_KEY and request.headers.get("X-MCP-Key", "") == _MCP_KEY
        if not (proxy_ok or internal_ok or mcp_ok):
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    return await call_next(request)
```

- [ ] **Step 2: Add MCP_KEY to .env.example**

Open `/Users/yu-hung/Desktop/MyRepos/DNGTaMe/PNG2SS/.env.example` and add:
```
MCP_KEY=your_mcp_key_here
```

- [ ] **Step 3: Verify existing PNG2SS tests still pass**

```bash
cd /Users/yu-hung/Desktop/MyRepos/DNGTaMe/PNG2SS
source .venv/bin/activate
pytest tests/test_auth.py -v
```

Expected: all auth tests pass (the new key is additive, not breaking).

---

## Task 2: Add X-MCP-Key to GIF2SS

**Files:**
- Modify: `/Users/yu-hung/Desktop/MyRepos/DNGTaMe/GIF2SS/app/main.py:18-33`

- [ ] **Step 1: Edit GIF2SS auth middleware**

Replace lines 18–33 in `app/main.py` with:

```python
_PROXY_SECRET = os.getenv("RAPIDAPI_PROXY_SECRET")
_INTERNAL_KEY = os.getenv("INTERNAL_KEY")
_MCP_KEY = os.getenv("MCP_KEY")


@app.middleware("http")
async def verify_access(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)

    if _PROXY_SECRET or _INTERNAL_KEY or _MCP_KEY:
        proxy_ok = _PROXY_SECRET and request.headers.get("X-RapidAPI-Proxy-Secret", "") == _PROXY_SECRET
        internal_ok = _INTERNAL_KEY and request.headers.get("X-Internal-Key", "") == _INTERNAL_KEY
        mcp_ok = _MCP_KEY and request.headers.get("X-MCP-Key", "") == _MCP_KEY
        if not (proxy_ok or internal_ok or mcp_ok):
            return JSONResponse(status_code=403, content={"detail": "Forbidden"})

    return await call_next(request)
```

- [ ] **Step 2: Add MCP_KEY to GIF2SS .env.example** (if file exists; create it if not)

```
RAPIDAPI_PROXY_SECRET=your_secret_here
INTERNAL_KEY=your_internal_key_here
MCP_KEY=your_mcp_key_here
```

- [ ] **Step 3: Verify GIF2SS starts cleanly**

```bash
cd /Users/yu-hung/Desktop/MyRepos/DNGTaMe/GIF2SS
source .venv/bin/activate
pytest -v
```

Expected: all tests pass.

---

## Task 3: Scaffold the Worker project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `wrangler.toml`

Working directory for all remaining tasks: `/Users/yu-hung/Desktop/MyRepos/Game-Dev Spritesheet Tools MCP server/`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "spritesheet-forge-mcp",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20241205.0",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8",
    "wrangler": "^3.93.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "test"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
  },
});
```

- [ ] **Step 4: Create placeholder wrangler.toml** (full config added in Task 13)

```toml
name = "spritesheet-forge"
main = "src/index.ts"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[vars]
WORKER_BASE_URL = "https://spritesheet-forge.workers.dev"
FREE_QUOTA_LIMIT = "100"
```

- [ ] **Step 5: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 6: Create src/ and test/ directories, add .gitkeep**

```bash
mkdir -p src/tools test/tools
touch src/tools/.gitkeep test/tools/.gitkeep
```

- [ ] **Step 7: Commit**

```bash
git init
git add package.json tsconfig.json vitest.config.ts wrangler.toml
git commit -m "chore: scaffold spritesheet-forge-mcp project"
```

---

## Task 4: types.ts and errors.ts

**Files:**
- Create: `src/types.ts`
- Create: `src/errors.ts`

No tests needed — pure type definitions and a small class.

- [ ] **Step 1: Create src/types.ts**

```typescript
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
```

- [ ] **Step 2: Create src/errors.ts**

```typescript
export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'QUOTA_EXCEEDED'
  | 'INVALID_FILE_INPUT'
  | 'INVALID_FILE_URL'
  | 'BLOCKED_URL'
  | 'FILE_TOO_LARGE'
  | 'INVALID_CONTENT_TYPE'
  | 'DOWNLOAD_TIMEOUT'
  | 'INVALID_BASE64'
  | 'UPSTREAM_ERROR'
  | 'PROCESSING_ERROR';

const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  QUOTA_EXCEEDED: 429,
  INVALID_FILE_INPUT: 400,
  INVALID_FILE_URL: 400,
  BLOCKED_URL: 400,
  FILE_TOO_LARGE: 413,
  INVALID_CONTENT_TYPE: 400,
  DOWNLOAD_TIMEOUT: 408,
  INVALID_BASE64: 400,
  UPSTREAM_ERROR: 502,
  PROCESSING_ERROR: 500,
};

export class MCPError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  readonly httpStatus: number;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'MCPError';
    this.code = code;
    this.details = details;
    this.httpStatus = HTTP_STATUS[code];
  }
}

export function formatError(err: MCPError): {
  error: { code: string; message: string; details: Record<string, unknown> };
} {
  return {
    error: {
      code: err.code,
      message: err.message,
      details: err.details,
    },
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types.ts src/errors.ts
git commit -m "feat: add shared types and MCPError"
```

---

## Task 5: SSRF Guard

**Files:**
- Create: `src/ssrf-guard.ts`
- Create: `test/ssrf-guard.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/ssrf-guard.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateUrl } from '../src/ssrf-guard';
import { MCPError } from '../src/errors';

describe('validateUrl', () => {
  it('accepts a valid HTTPS URL', () => {
    expect(() => validateUrl('https://example.com/file.png')).not.toThrow();
  });

  it('rejects HTTP URLs', () => {
    expect(() => validateUrl('http://example.com/file.png'))
      .toThrow(MCPError);
    try { validateUrl('http://example.com/file.png'); } catch (e) {
      expect((e as MCPError).code).toBe('INVALID_FILE_URL');
    }
  });

  it('rejects non-URL strings', () => {
    expect(() => validateUrl('not-a-url')).toThrow(MCPError);
    expect(() => validateUrl('')).toThrow(MCPError);
    expect(() => validateUrl('ftp://example.com')).toThrow(MCPError);
  });

  it('rejects GCP metadata endpoint', () => {
    expect(() => validateUrl('https://169.254.169.254/computeMetadata/v1/'))
      .toThrow(MCPError);
    try { validateUrl('https://169.254.169.254/'); } catch (e) {
      expect((e as MCPError).code).toBe('BLOCKED_URL');
    }
  });

  it('rejects metadata.google.internal', () => {
    expect(() => validateUrl('https://metadata.google.internal/computeMetadata/v1/'))
      .toThrow(MCPError);
  });

  it('rejects localhost', () => {
    expect(() => validateUrl('https://localhost/file.png')).toThrow(MCPError);
    expect(() => validateUrl('https://127.0.0.1/file.png')).toThrow(MCPError);
    expect(() => validateUrl('https://[::1]/file.png')).toThrow(MCPError);
  });

  it('rejects private IP ranges', () => {
    expect(() => validateUrl('https://10.0.0.1/file.png')).toThrow(MCPError);
    expect(() => validateUrl('https://192.168.1.1/file.png')).toThrow(MCPError);
    expect(() => validateUrl('https://172.16.0.1/file.png')).toThrow(MCPError);
    expect(() => validateUrl('https://172.31.255.255/file.png')).toThrow(MCPError);
  });

  it('allows 172.32.x.x (outside private range)', () => {
    expect(() => validateUrl('https://172.32.0.1/file.png')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/ssrf-guard.test.ts
```

Expected: `FAIL — Cannot find module '../src/ssrf-guard'`

- [ ] **Step 3: Create src/ssrf-guard.ts**

```typescript
import { MCPError } from './errors';

const BLOCKED_HOSTNAMES = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'localhost',
  '127.0.0.1',
  '::1',
]);

function isPrivateIp(hostname: string): boolean {
  if (hostname.startsWith('10.')) return true;
  if (hostname.startsWith('192.168.')) return true;
  // 172.16.0.0 – 172.31.255.255
  const match = hostname.match(/^172\.(\d+)\./);
  if (match) {
    const second = parseInt(match[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

export function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MCPError('INVALID_FILE_URL', `Invalid URL: ${url}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new MCPError('INVALID_FILE_URL', 'Only HTTPS URLs are accepted');
  }

  const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, ''); // strip IPv6 brackets

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new MCPError('BLOCKED_URL', `Blocked host: ${hostname}`);
  }

  if (isPrivateIp(hostname)) {
    throw new MCPError('BLOCKED_URL', `Blocked private IP range: ${hostname}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/ssrf-guard.test.ts
```

Expected: all 8 test groups pass.

- [ ] **Step 5: Commit**

```bash
git add src/ssrf-guard.ts test/ssrf-guard.test.ts
git commit -m "feat: add SSRF guard with private IP and metadata endpoint blocking"
```

---

## Task 6: File Handler

**Files:**
- Create: `src/file-handler.ts`
- Create: `test/file-handler.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/file-handler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveFileInput, generateOutputKey, outputUrl } from '../src/file-handler';
import { MCPError } from '../src/errors';

const mockEnv = {
  WORKER_BASE_URL: 'https://spritesheet-forge.workers.dev',
  SPRITESHEET_OUTPUT: {
    put: vi.fn().mockResolvedValue(undefined),
  },
} as unknown as import('../src/types').Env;

describe('resolveFileInput', () => {
  beforeEach(() => vi.clearAllMocks());

  it('decodes a valid base64 PNG data URI', async () => {
    // 1x1 transparent PNG in base64
    const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const result = await resolveFileInput(png1x1, mockEnv);
    expect(result.blob.type).toBe('image/png');
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('rejects invalid base64', async () => {
    await expect(resolveFileInput('data:image/png;base64,!!!invalid!!!', mockEnv))
      .rejects.toThrow(MCPError);
    try {
      await resolveFileInput('data:image/png;base64,!!!', mockEnv);
    } catch (e) {
      expect((e as MCPError).code).toBe('INVALID_BASE64');
    }
  });

  it('rejects non-HTTPS URL via SSRF guard', async () => {
    await expect(resolveFileInput('http://example.com/file.png', mockEnv))
      .rejects.toThrow(MCPError);
  });

  it('rejects plain strings that are neither URL nor base64', async () => {
    await expect(resolveFileInput('just-a-string', mockEnv))
      .rejects.toThrow(MCPError);
    try {
      await resolveFileInput('just-a-string', mockEnv);
    } catch (e) {
      expect((e as MCPError).code).toBe('INVALID_FILE_INPUT');
    }
  });

  it('fetches a valid HTTPS URL', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([137, 80, 78, 71]).buffer, {
        headers: { 'content-type': 'image/png', 'content-length': '4' },
      })
    );
    const result = await resolveFileInput('https://example.com/frame.png', mockEnv);
    expect(result.blob.type).toBe('image/png');
  });

  it('rejects URL that returns non-image content type', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('<html>', {
        headers: { 'content-type': 'text/html', 'content-length': '6' },
      })
    );
    await expect(resolveFileInput('https://example.com/page.html', mockEnv))
      .rejects.toThrow(MCPError);
    try {
      await resolveFileInput('https://example.com/page.html', mockEnv);
    } catch (e) {
      expect((e as MCPError).code).toBe('INVALID_CONTENT_TYPE');
    }
  });

  it('rejects files over 20MB', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        headers: { 'content-type': 'image/png', 'content-length': String(21 * 1024 * 1024) },
      })
    );
    await expect(resolveFileInput('https://example.com/huge.png', mockEnv))
      .rejects.toThrow(MCPError);
    try {
      await resolveFileInput('https://example.com/huge.png', mockEnv);
    } catch (e) {
      expect((e as MCPError).code).toBe('FILE_TOO_LARGE');
    }
  });
});

describe('generateOutputKey', () => {
  it('generates a key with correct extension for image/png', () => {
    const key = generateOutputKey('image/png');
    expect(key).toMatch(/^output-[a-f0-9]{32}\.png$/);
  });

  it('generates a key with correct extension for application/zip', () => {
    const key = generateOutputKey('application/zip');
    expect(key).toMatch(/\.zip$/);
  });
});

describe('outputUrl', () => {
  it('returns the correct Worker URL for a key', () => {
    const url = outputUrl(mockEnv, 'output-abc.png');
    expect(url).toBe('https://spritesheet-forge.workers.dev/output/output-abc.png');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/file-handler.test.ts
```

Expected: FAIL — `Cannot find module '../src/file-handler'`

- [ ] **Step 3: Create src/file-handler.ts**

```typescript
import { MCPError } from './errors';
import { validateUrl } from './ssrf-guard';
import type { Env } from './types';

const MAX_SINGLE_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
const ALLOWED_CONTENT_TYPES = new Set([
  'image/png',
  'image/gif',
  'image/webp',
  'application/zip',
]);

const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/zip': 'zip',
};

export interface ResolvedFile {
  blob: Blob;
  contentType: string;
}

export function generateOutputKey(contentType: string): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const ext = EXTENSION[contentType] ?? 'bin';
  return `output-${hex}.${ext}`;
}

export function outputUrl(env: Pick<Env, 'WORKER_BASE_URL'>, key: string): string {
  return `${env.WORKER_BASE_URL}/output/${key}`;
}

export async function resolveFileInput(input: string, _env: Env): Promise<ResolvedFile> {
  if (input.startsWith('data:')) {
    return decodeDataUri(input);
  }
  if (input.startsWith('https://') || input.startsWith('http://')) {
    return downloadUrl(input);
  }
  throw new MCPError('INVALID_FILE_INPUT', 'File input must be an HTTPS URL or a base64 data URI (data:image/...;base64,...)');
}

function decodeDataUri(dataUri: string): ResolvedFile {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) {
    throw new MCPError('INVALID_BASE64', 'Malformed data URI — expected data:<mime>;base64,<data>');
  }
  const [, mimeType, b64] = match;
  let binary: ArrayBuffer;
  try {
    const binaryStr = atob(b64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    binary = bytes.buffer;
  } catch {
    throw new MCPError('INVALID_BASE64', 'Failed to decode base64 data');
  }
  return { blob: new Blob([binary], { type: mimeType }), contentType: mimeType };
}

async function downloadUrl(url: string): Promise<ResolvedFile> {
  // SSRF guard — throws MCPError on violation
  validateUrl(url);

  // HEAD preflight: check content-length before downloading
  let headRes: Response;
  try {
    headRes = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new MCPError('DOWNLOAD_TIMEOUT', 'URL HEAD request timed out after 10 seconds');
    }
    throw new MCPError('INVALID_FILE_URL', `Failed to reach URL: ${(err as Error).message}`);
  }

  const contentLength = parseInt(headRes.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_SINGLE_FILE_BYTES) {
    throw new MCPError('FILE_TOO_LARGE', `File size ${contentLength} exceeds 20 MB limit`);
  }

  const contentType = (headRes.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new MCPError('INVALID_CONTENT_TYPE', `Content-Type '${contentType}' is not accepted. Expected image/png, image/gif, or image/webp`);
  }

  // Full download
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new MCPError('DOWNLOAD_TIMEOUT', 'URL download timed out after 10 seconds');
    }
    throw new MCPError('INVALID_FILE_URL', `Download failed: ${(err as Error).message}`);
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_SINGLE_FILE_BYTES) {
    throw new MCPError('FILE_TOO_LARGE', `Downloaded file (${buffer.byteLength} bytes) exceeds 20 MB limit`);
  }

  return { blob: new Blob([buffer], { type: contentType }), contentType };
}

export async function uploadToR2(
  env: Env,
  key: string,
  body: ArrayBuffer,
  contentType: string
): Promise<void> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await env.SPRITESHEET_OUTPUT.put(key, body, {
    httpMetadata: { contentType },
    customMetadata: { expiresAt },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/file-handler.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/file-handler.ts test/file-handler.test.ts
git commit -m "feat: add file handler with SSRF-safe URL download and base64 decode"
```

---

## Task 7: Quota System

**Files:**
- Create: `src/quota.ts`
- Create: `test/quota.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/quota.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/quota.test.ts
```

Expected: FAIL — `Cannot find module '../src/quota'`

- [ ] **Step 3: Create src/quota.ts**

```typescript
import { MCPError } from './errors';
import type { Env, QuotaData, QuotaStatus } from './types';

function quotaKey(userId: string): string {
  const ym = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  return `quota:${userId}:${ym}`;
}

export function getResetDate(): string {
  const now = new Date();
  const firstOfNext = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return firstOfNext.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

export async function getQuotaStatus(env: Env, userId: string): Promise<QuotaStatus> {
  const limit = parseInt(env.FREE_QUOTA_LIMIT, 10);
  const raw = await env.QUOTAS.get(quotaKey(userId));
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/quota.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/quota.ts test/quota.test.ts
git commit -m "feat: add KV-based monthly quota system"
```

---

## Task 8: GitHub OAuth 2.1 Auth

**Files:**
- Create: `src/auth.ts`
- Create: `test/auth.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/auth.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/auth.test.ts
```

Expected: FAIL — `Cannot find module '../src/auth'`

- [ ] **Step 3: Create src/auth.ts**

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/auth.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts test/auth.test.ts
git commit -m "feat: add GitHub OAuth 2.1 helpers and session management"
```

---

## Task 9: PNG2SS Tool Handlers

**Files:**
- Create: `src/tools/index.ts`
- Create: `src/tools/png2ss.ts`
- Create: `test/tools/png2ss.test.ts`

- [ ] **Step 1: Create src/tools/index.ts**

```typescript
import type { Env } from '../types';
import type { ToolResult } from '../types';

export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>, env: Env, userId: string) => Promise<ToolResult>;
}

class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Array<{ name: string; description: string; inputSchema: object }> {
    return Array.from(this.tools.values()).map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }
}

export const toolRegistry = new ToolRegistry();
```

- [ ] **Step 2: Write failing tests for PNG2SS tools**

Create `test/tools/png2ss.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolRegistry } from '../../src/tools/index';
import type { Env } from '../../src/types';

// Import the module to trigger registration
import '../../src/tools/png2ss';

const MOCK_PNG_URL = 'https://example.com/frame.png';

function makeEnv() {
  return {
    PNG2SS_URL: 'https://png2ss.example.com',
    GIF2SS_URL: 'https://gif2ss.example.com',
    MCP_KEY: 'test-mcp-key',
    WORKER_BASE_URL: 'https://spritesheet-forge.workers.dev',
    SPRITESHEET_OUTPUT: { put: vi.fn().mockResolvedValue(undefined) },
    SESSIONS: {},
    QUOTAS: {
      get: vi.fn().mockResolvedValue(JSON.stringify({ count: 5, updatedAt: '' })),
      put: vi.fn().mockResolvedValue(undefined),
    },
    FREE_QUOTA_LIMIT: '100',
  } as unknown as Env;
}

describe('png_to_spritesheet tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered in the tool registry', () => {
    expect(toolRegistry.get('png_to_spritesheet')).toBeDefined();
  });

  it('calls PNG2SS /to-spritesheet and returns a URL', async () => {
    global.fetch = vi.fn()
      // HEAD preflight for SSRF check (resolveFileInput URL path)
      .mockResolvedValueOnce(new Response(null, { headers: { 'content-type': 'image/png', 'content-length': '100' } }))
      // Actual file download
      .mockResolvedValueOnce(new Response(new Uint8Array(100).buffer, { headers: { 'content-type': 'image/png' } }))
      // Cloud Run response
      .mockResolvedValueOnce(new Response(new Uint8Array(200).buffer, { headers: { 'content-type': 'image/png' } }));

    const env = makeEnv();
    const tool = toolRegistry.get('png_to_spritesheet')!;
    const result = await tool.handler({ files: [MOCK_PNG_URL] }, env, 'user1');

    expect(result.url).toMatch(/^https:\/\/spritesheet-forge\.workers\.dev\/output\//);
    expect(result.content_type).toBe('image/png');
    expect(result.quota.used).toBe(6); // was 5, incremented to 6
    expect(env.SPRITESHEET_OUTPUT.put).toHaveBeenCalledOnce();
  });

  it('throws UPSTREAM_ERROR when Cloud Run returns 422', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { headers: { 'content-type': 'image/png', 'content-length': '100' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(100).buffer, { headers: { 'content-type': 'image/png' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'cell_mode=fixed requires cell_width' }), { status: 422 }));

    const env = makeEnv();
    const tool = toolRegistry.get('png_to_spritesheet')!;
    await expect(tool.handler({ files: [MOCK_PNG_URL], cell_mode: 'fixed' }, env, 'user1'))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });
});

describe('split_spritesheet tool', () => {
  it('is registered', () => {
    expect(toolRegistry.get('split_spritesheet')).toBeDefined();
  });
});

describe('trim_png tool', () => {
  it('is registered', () => {
    expect(toolRegistry.get('trim_png')).toBeDefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run test/tools/png2ss.test.ts
```

Expected: FAIL — `Cannot find module '../../src/tools/png2ss'`

- [ ] **Step 4: Create src/tools/png2ss.ts**

```typescript
import { toolRegistry } from './index';
import { resolveFileInput, generateOutputKey, uploadToR2, outputUrl } from '../file-handler';
import { checkQuota, incrementQuota, getQuotaStatus } from '../quota';
import { MCPError } from '../errors';
import type { Env, ToolResult } from '../types';

async function buildFormData(
  args: Record<string, unknown>,
  fileFields: string[],
  env: Env
): Promise<FormData> {
  const form = new FormData();
  for (const field of fileFields) {
    const inputs = Array.isArray(args[field]) ? args[field] as string[] : [args[field] as string];
    for (const input of inputs) {
      const { blob } = await resolveFileInput(input, env);
      form.append(field, blob, 'file.png');
    }
  }
  for (const [key, value] of Object.entries(args)) {
    if (!fileFields.includes(key) && value !== undefined && value !== null) {
      form.append(key, String(value));
    }
  }
  return form;
}

async function callCloudRun(
  url: string,
  form: FormData,
  env: Env
): Promise<{ body: ArrayBuffer; contentType: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-MCP-Key': env.MCP_KEY },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json() as { detail?: string };
    throw new MCPError('UPSTREAM_ERROR', err.detail ?? `Upstream error ${res.status}`, { upstream_status: res.status });
  }
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const body = await res.arrayBuffer();
  return { body, contentType };
}

async function storeAndReturn(
  env: Env,
  body: ArrayBuffer,
  contentType: string,
  userId: string
): Promise<ToolResult> {
  const key = generateOutputKey(contentType);
  await uploadToR2(env, key, body, contentType);
  await incrementQuota(env, userId);
  const quota = await getQuotaStatus(env, userId);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return {
    url: outputUrl(env, key),
    expires_at: expiresAt,
    content_type: contentType,
    size_bytes: body.byteLength,
    quota,
  };
}

toolRegistry.register({
  name: 'png_to_spritesheet',
  description: 'Merge multiple PNG files into a single spritesheet. Supports grid, horizontal, vertical, and packed (bin-packed) layouts with optional TexturePacker-compatible JSON metadata. Returns a download URL.',
  inputSchema: {
    type: 'object',
    properties: {
      files: { type: 'array', items: { type: 'string' }, description: 'PNG files as HTTPS URLs or base64 data URIs (data:image/png;base64,...)' },
      layout: { type: 'string', enum: ['grid', 'horizontal', 'vertical', 'packed'], description: 'Frame arrangement. Default: grid' },
      columns: { type: 'integer', description: 'Grid columns. Auto-calculated if omitted.' },
      cell_mode: { type: 'string', enum: ['auto_max', 'auto_uniform', 'fixed'], description: 'Cell sizing mode. Default: auto_max' },
      cell_width: { type: 'integer', description: 'Required when cell_mode=fixed' },
      cell_height: { type: 'integer', description: 'Required when cell_mode=fixed' },
      fit_mode: { type: 'string', enum: ['scale_fit', 'scale_fill', 'error'] },
      align: { type: 'string', enum: ['center', 'top_left'] },
      padding: { type: 'integer', description: 'Pixel gap between frames' },
      bg_color: { type: 'string', description: '"transparent" or hex "#RRGGBB"' },
      power_of_2: { type: 'boolean', description: 'Pad output to next power of 2' },
      file_name_order: { type: 'boolean', description: 'Sort by _N filename suffix' },
      trim_input: { type: 'boolean', description: 'Auto-trim transparent edges before compositing' },
      extrude: { type: 'integer', description: 'Extrude outermost pixels by N px per frame' },
      metadata_format: { type: 'string', enum: ['none', 'json_array', 'json_hash', 'css'], description: 'Atlas metadata format. Required (non-none) when layout=packed' },
    },
    required: ['files'],
  },
  async handler(args, env, userId) {
    await checkQuota(env, userId);
    const form = await buildFormData(args, ['files'], env);
    const { body, contentType } = await callCloudRun(`${env.PNG2SS_URL}/to-spritesheet`, form, env);
    return storeAndReturn(env, body, contentType, userId);
  },
});

toolRegistry.register({
  name: 'split_spritesheet',
  description: 'Slice a spritesheet PNG into individual frames, generate TexturePacker-compatible atlas JSON, or both. Provide columns+rows (grid mode) or cell_width+cell_height (cell mode).',
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Spritesheet PNG as HTTPS URL or base64 data URI' },
      columns: { type: 'integer', description: 'Grid columns (grid mode)' },
      rows: { type: 'integer', description: 'Grid rows (grid mode)' },
      cell_width: { type: 'integer', description: 'Cell width in px (cell mode)' },
      cell_height: { type: 'integer', description: 'Cell height in px (cell mode)' },
      padding: { type: 'integer' },
      frame_count: { type: 'integer' },
      column_range: { type: 'string', description: 'e.g. "0-5" or "2"' },
      row_range: { type: 'string' },
      skip_empty: { type: 'boolean', description: 'Remove fully transparent frames. Default: true' },
      trim_top: { type: 'integer' },
      trim_right: { type: 'integer' },
      trim_bottom: { type: 'integer' },
      trim_left: { type: 'integer' },
      output: { type: 'string', enum: ['frames', 'metadata', 'both'], description: 'Default: frames' },
      metadata_format: { type: 'string', enum: ['json_array', 'json_hash', 'css'] },
    },
    required: ['file'],
  },
  async handler(args, env, userId) {
    await checkQuota(env, userId);
    const form = await buildFormData(args, ['file'], env);
    const { body, contentType } = await callCloudRun(`${env.PNG2SS_URL}/split-spritesheet`, form, env);
    return storeAndReturn(env, body, contentType, userId);
  },
});

toolRegistry.register({
  name: 'trim_png',
  description: 'Crop transparent edges from one or more PNG files. Single file returns PNG; multiple files return a ZIP.',
  inputSchema: {
    type: 'object',
    properties: {
      files: { type: 'array', items: { type: 'string' }, description: 'PNG files as HTTPS URLs or base64 data URIs' },
      threshold: { type: 'integer', description: 'Alpha threshold 0-255. Pixels with alpha ≤ threshold are trimmed. Default: 0' },
      padding: { type: 'integer', description: 'Transparent margin to preserve around trimmed content. Default: 0' },
    },
    required: ['files'],
  },
  async handler(args, env, userId) {
    await checkQuota(env, userId);
    const form = await buildFormData(args, ['files'], env);
    const { body, contentType } = await callCloudRun(`${env.PNG2SS_URL}/trim`, form, env);
    return storeAndReturn(env, body, contentType, userId);
  },
});
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run test/tools/png2ss.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tools/index.ts src/tools/png2ss.ts test/tools/png2ss.test.ts
git commit -m "feat: add PNG2SS MCP tools (png_to_spritesheet, split_spritesheet, trim_png)"
```

---

## Task 10: GIF2SS Tool Handlers

**Files:**
- Create: `src/tools/gif2ss.ts`
- Create: `test/tools/gif2ss.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/tools/gif2ss.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolRegistry } from '../../src/tools/index';
import type { Env } from '../../src/types';
import '../../src/tools/gif2ss';

const MOCK_GIF_URL = 'https://example.com/animation.gif';
const MOCK_PNG_URL = 'https://example.com/frame.png';

function makeEnv() {
  return {
    PNG2SS_URL: 'https://png2ss.example.com',
    GIF2SS_URL: 'https://gif2ss.example.com',
    MCP_KEY: 'test-mcp-key',
    WORKER_BASE_URL: 'https://spritesheet-forge.workers.dev',
    SPRITESHEET_OUTPUT: { put: vi.fn().mockResolvedValue(undefined) },
    SESSIONS: {},
    QUOTAS: {
      get: vi.fn().mockResolvedValue(JSON.stringify({ count: 5, updatedAt: '' })),
      put: vi.fn().mockResolvedValue(undefined),
    },
    FREE_QUOTA_LIMIT: '100',
  } as unknown as Env;
}

describe('gif_to_spritesheet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered', () => expect(toolRegistry.get('gif_to_spritesheet')).toBeDefined());

  it('calls GIF2SS /to-spritesheet and returns a URL', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { headers: { 'content-type': 'image/gif', 'content-length': '100' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(100).buffer, { headers: { 'content-type': 'image/gif' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(500).buffer, { headers: { 'content-type': 'image/png' } }));

    const env = makeEnv();
    const tool = toolRegistry.get('gif_to_spritesheet')!;
    const result = await tool.handler({ file: MOCK_GIF_URL }, env, 'user1');
    expect(result.url).toMatch(/^https:\/\/spritesheet-forge\.workers\.dev\/output\//);
    expect(result.content_type).toBe('image/png');
  });
});

describe('gif_to_frames', () => {
  it('is registered', () => expect(toolRegistry.get('gif_to_frames')).toBeDefined());
});

describe('frames_to_animation', () => {
  it('is registered', () => expect(toolRegistry.get('frames_to_animation')).toBeDefined());
});

describe('spritesheet_to_animation', () => {
  it('is registered', () => expect(toolRegistry.get('spritesheet_to_animation')).toBeDefined());
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/tools/gif2ss.test.ts
```

Expected: FAIL — `Cannot find module '../../src/tools/gif2ss'`

- [ ] **Step 3: Create src/tools/gif2ss.ts**

```typescript
import { toolRegistry } from './index';
import { resolveFileInput, generateOutputKey, uploadToR2, outputUrl } from '../file-handler';
import { checkQuota, incrementQuota, getQuotaStatus } from '../quota';
import { MCPError } from '../errors';
import type { Env, ToolResult } from '../types';

async function buildFormData(args: Record<string, unknown>, fileFields: string[], env: Env): Promise<FormData> {
  const form = new FormData();
  for (const field of fileFields) {
    const inputs = Array.isArray(args[field]) ? args[field] as string[] : [args[field] as string];
    for (const input of inputs) {
      const { blob } = await resolveFileInput(input, env);
      form.append(field, blob, 'file');
    }
  }
  for (const [key, value] of Object.entries(args)) {
    if (!fileFields.includes(key) && value !== undefined && value !== null) {
      form.append(key, String(value));
    }
  }
  return form;
}

async function callCloudRun(url: string, form: FormData, env: Env): Promise<{ body: ArrayBuffer; contentType: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-MCP-Key': env.MCP_KEY },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json() as { detail?: string };
    throw new MCPError('UPSTREAM_ERROR', err.detail ?? `Upstream error ${res.status}`, { upstream_status: res.status });
  }
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  return { body: await res.arrayBuffer(), contentType };
}

async function storeAndReturn(env: Env, body: ArrayBuffer, contentType: string, userId: string): Promise<ToolResult> {
  const key = generateOutputKey(contentType);
  await uploadToR2(env, key, body, contentType);
  await incrementQuota(env, userId);
  const quota = await getQuotaStatus(env, userId);
  return {
    url: outputUrl(env, key),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    content_type: contentType,
    size_bytes: body.byteLength,
    quota,
  };
}

toolRegistry.register({
  name: 'gif_to_spritesheet',
  description: 'Convert a GIF animation into a spritesheet PNG with all frames arranged in a grid. Optionally remove the background.',
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'GIF as HTTPS URL or base64 data URI (data:image/gif;base64,...)' },
      columns: { type: 'integer', description: 'Grid columns. Auto-calculated if omitted.' },
      padding: { type: 'integer', description: 'Pixel gap between frames. Default: 0' },
      remove_bg: { type: 'boolean', description: 'Remove background from each frame. Default: false' },
      bg_color: { type: 'string', description: '"auto" or hex "#RRGGBB". Default: "auto"' },
      tolerance: { type: 'integer', description: 'Background removal threshold 0-255. Default: 30' },
    },
    required: ['file'],
  },
  async handler(args, env, userId) {
    await checkQuota(env, userId);
    const form = await buildFormData(args, ['file'], env);
    const { body, contentType } = await callCloudRun(`${env.GIF2SS_URL}/to-spritesheet`, form, env);
    return storeAndReturn(env, body, contentType, userId);
  },
});

toolRegistry.register({
  name: 'gif_to_frames',
  description: 'Extract all frames from a GIF and return them as individual PNGs in a ZIP archive.',
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'GIF as HTTPS URL or base64 data URI' },
      remove_bg: { type: 'boolean', description: 'Remove background from each frame. Default: false' },
      bg_color: { type: 'string', description: '"auto" or hex "#RRGGBB"' },
      tolerance: { type: 'integer', description: 'Background removal threshold 0-255. Default: 30' },
    },
    required: ['file'],
  },
  async handler(args, env, userId) {
    await checkQuota(env, userId);
    const form = await buildFormData(args, ['file'], env);
    const { body, contentType } = await callCloudRun(`${env.GIF2SS_URL}/to-frames`, form, env);
    return storeAndReturn(env, body, contentType, userId);
  },
});

toolRegistry.register({
  name: 'frames_to_animation',
  description: 'Assemble multiple PNG files into an animated GIF or animated WebP.',
  inputSchema: {
    type: 'object',
    properties: {
      files: { type: 'array', items: { type: 'string' }, description: 'PNG frames as HTTPS URLs or base64 data URIs' },
      duration: { type: 'integer', description: 'Frame duration in ms (10-10000). Default: 100' },
      loop: { type: 'integer', description: 'Loop count. 0 = infinite. Default: 0' },
      file_name_order: { type: 'boolean', description: 'Sort by _N filename suffix. Default: false' },
      resize: { type: 'string', enum: ['error', 'fill', 'transparent'], description: 'Dimension mismatch handling. Default: transparent' },
      bg_fill_color: { type: 'string', description: 'Fill color for resize=fill. Hex #RRGGBB. Default: #000000' },
      output_format: { type: 'string', enum: ['gif', 'webp'], description: 'Output format. Default: gif' },
      quality: { type: 'integer', description: 'WebP lossy quality 0-100. Default: 80' },
      lossless: { type: 'boolean', description: 'WebP lossless mode. Default: false' },
    },
    required: ['files'],
  },
  async handler(args, env, userId) {
    await checkQuota(env, userId);
    const form = await buildFormData(args, ['files'], env);
    const { body, contentType } = await callCloudRun(`${env.GIF2SS_URL}/from-frames`, form, env);
    return storeAndReturn(env, body, contentType, userId);
  },
});

toolRegistry.register({
  name: 'spritesheet_to_animation',
  description: 'Slice a spritesheet PNG into frames and produce an animated GIF or WebP. Provide columns+rows (grid mode) or cell_width+cell_height (cell mode).',
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Spritesheet PNG as HTTPS URL or base64 data URI' },
      columns: { type: 'integer', description: 'Grid columns (grid mode)' },
      rows: { type: 'integer', description: 'Grid rows (grid mode)' },
      cell_width: { type: 'integer', description: 'Cell width in px (cell mode)' },
      cell_height: { type: 'integer', description: 'Cell height in px (cell mode)' },
      frame_count: { type: 'integer', description: 'Actual frame count for incomplete last row' },
      padding: { type: 'integer', description: 'Pixel gap between cells. Default: 0' },
      column_range: { type: 'string', description: 'e.g. "0-5" or "2"' },
      row_range: { type: 'string' },
      skip_empty: { type: 'boolean', description: 'Auto-remove fully transparent frames. Default: true' },
      trim_top: { type: 'integer' },
      trim_right: { type: 'integer' },
      trim_bottom: { type: 'integer' },
      trim_left: { type: 'integer' },
      duration: { type: 'integer', description: 'Frame duration in ms. Default: 100' },
      loop: { type: 'integer', description: 'Loop count. 0 = infinite. Default: 0' },
      output_format: { type: 'string', enum: ['gif', 'webp'], description: 'Default: gif' },
      quality: { type: 'integer', description: 'WebP quality 0-100. Default: 80' },
      lossless: { type: 'boolean', description: 'WebP lossless. Default: false' },
    },
    required: ['file'],
  },
  async handler(args, env, userId) {
    await checkQuota(env, userId);
    const form = await buildFormData(args, ['file'], env);
    const { body, contentType } = await callCloudRun(`${env.GIF2SS_URL}/from-spritesheet`, form, env);
    return storeAndReturn(env, body, contentType, userId);
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/tools/gif2ss.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/gif2ss.ts test/tools/gif2ss.test.ts
git commit -m "feat: add GIF2SS MCP tools (gif_to_spritesheet, gif_to_frames, frames_to_animation, spritesheet_to_animation)"
```

---

## Task 11: MCP JSON-RPC Handler

**Files:**
- Create: `src/mcp.ts`

No separate tests — covered indirectly by tool tests; the handler is tested via index.ts in Task 12.

- [ ] **Step 1: Create src/mcp.ts**

```typescript
import { toolRegistry } from './tools/index';
// Side-effect imports to register all tools
import './tools/png2ss';
import './tools/gif2ss';
import { MCPError, formatError } from './errors';
import type { Env } from './types';

interface JSONRPCRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id?: string | number | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function rpcResult(result: unknown, id: unknown): Response {
  return jsonResponse({ jsonrpc: '2.0', result, id: id ?? null });
}

function rpcError(code: number, message: string, id: unknown): Response {
  return jsonResponse({ jsonrpc: '2.0', error: { code, message }, id: id ?? null }, 400);
}

export async function handleMCPRequest(request: Request, env: Env, userId: string): Promise<Response> {
  let body: JSONRPCRequest;
  try {
    body = await request.json() as JSONRPCRequest;
  } catch {
    return rpcError(-32700, 'Parse error', null);
  }

  const { method, params, id } = body;

  try {
    switch (method) {
      case 'initialize':
        return rpcResult({
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'spritesheet-forge', version: '1.0.0' },
        }, id);

      case 'notifications/initialized':
        return new Response(null, { status: 204 });

      case 'tools/list':
        return rpcResult({ tools: toolRegistry.list() }, id);

      case 'tools/call': {
        const { name, arguments: args } = params as { name: string; arguments: Record<string, unknown> };
        const tool = toolRegistry.get(name);
        if (!tool) return rpcError(-32601, `Unknown tool: ${name}`, id);
        const result = await tool.handler(args, env, userId);
        return rpcResult({ content: [{ type: 'text', text: JSON.stringify(result) }] }, id);
      }

      default:
        return rpcError(-32601, `Method not found: ${method}`, id);
    }
  } catch (err) {
    if (err instanceof MCPError) {
      return rpcResult({
        content: [{ type: 'text', text: JSON.stringify(formatError(err)) }],
        isError: true,
      }, id);
    }
    console.error('Unhandled error in MCP handler:', err);
    return rpcError(-32603, 'Internal error', id);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/mcp.ts
git commit -m "feat: add MCP JSON-RPC handler"
```

---

## Task 12: Worker Entry Point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Create src/index.ts**

```typescript
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
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        code_challenge_methods_supported: ['S256'],
      });
    }

    // ── OAuth: start GitHub auth ─────────────────────────────────────────────
    if (url.pathname === '/oauth/authorize' && request.method === 'GET') {
      const clientRedirectUri = url.searchParams.get('redirect_uri') ?? '';
      const clientState = url.searchParams.get('state') ?? '';
      const codeChallenge = url.searchParams.get('code_challenge') ?? '';

      if (!codeChallenge) {
        return new Response('Missing code_challenge (PKCE required)', { status: 400 });
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
    if (url.pathname === '/mcp' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization') ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (!token) {
        return Response.json(
          { error: { code: 'UNAUTHENTICATED', message: 'Authorization header with Bearer token required' } },
          { status: 401 }
        );
      }

      const session = await lookupSession(env, token);
      if (!session) {
        return Response.json(
          { error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired token. Re-authorize via OAuth.' } },
          { status: 401 }
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
```

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass (ssrf-guard, file-handler, quota, auth, tools).

- [ ] **Step 3: Commit**

```bash
git add src/index.ts src/mcp.ts
git commit -m "feat: add Worker entry point with OAuth 2.1 flow, MCP endpoint, and R2 output serving"
```

---

## Task 13: Cloudflare Resources and Deployment Config

**Files:**
- Modify: `wrangler.toml`

- [ ] **Step 1: Create Cloudflare KV namespaces**

```bash
npx wrangler kv namespace create SESSIONS
npx wrangler kv namespace create QUOTAS
```

Note the `id` values printed for each namespace. You will need them in the next step.

- [ ] **Step 2: Create Cloudflare R2 bucket**

```bash
npx wrangler r2 bucket create spritesheet-forge-output
```

- [ ] **Step 3: Update wrangler.toml with real resource IDs**

Replace the contents of `wrangler.toml` with (substitute the real KV IDs from Step 1):

```toml
name = "spritesheet-forge"
main = "src/index.ts"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "SESSIONS"
id = "PASTE_SESSIONS_KV_ID_HERE"

[[kv_namespaces]]
binding = "QUOTAS"
id = "PASTE_QUOTAS_KV_ID_HERE"

[[r2_buckets]]
binding = "SPRITESHEET_OUTPUT"
bucket_name = "spritesheet-forge-output"

[vars]
WORKER_BASE_URL = "https://spritesheet-forge.workers.dev"
FREE_QUOTA_LIMIT = "100"
```

- [ ] **Step 4: Set secrets via wrangler**

Run each command and paste the value when prompted:

```bash
npx wrangler secret put PNG2SS_URL
# Paste: https://png2ss-934861542626.us-central1.run.app

npx wrangler secret put GIF2SS_URL
# Paste: https://gif2ss-934861542626.us-central1.run.app

npx wrangler secret put MCP_KEY
# Paste: a strong random string (generate with: openssl rand -hex 32)

npx wrangler secret put GITHUB_CLIENT_ID
# Paste: from GitHub OAuth App settings

npx wrangler secret put GITHUB_CLIENT_SECRET
# Paste: from GitHub OAuth App settings
```

**Before running the above:** Create a GitHub OAuth App at https://github.com/settings/developers → New OAuth App:
- Application name: `Spritesheet Forge MCP`
- Homepage URL: `https://spritesheet-forge.workers.dev`
- Authorization callback URL: `https://spritesheet-forge.workers.dev/oauth/callback`

- [ ] **Step 5: Also set MCP_KEY in PNG2SS and GIF2SS Cloud Run**

```bash
# PNG2SS
gcloud run services update png2ss \
  --update-env-vars MCP_KEY=THE_SAME_KEY_YOU_USED_ABOVE \
  --region us-central1

# GIF2SS
gcloud run services update gif2ss \
  --update-env-vars MCP_KEY=THE_SAME_KEY_YOU_USED_ABOVE \
  --region us-central1
```

- [ ] **Step 6: Deploy**

```bash
npx wrangler deploy
```

Expected output ends with:
```
✓ Deployed spritesheet-forge (X ms)
  https://spritesheet-forge.workers.dev
```

- [ ] **Step 7: Smoke test the deployment**

```bash
# Health check
curl https://spritesheet-forge.workers.dev/health
# Expected: {"status":"ok"}

# OAuth metadata
curl https://spritesheet-forge.workers.dev/.well-known/oauth-authorization-server
# Expected: JSON with authorization_endpoint, token_endpoint

# MCP without auth (should 401)
curl -X POST https://spritesheet-forge.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
# Expected: {"error":{"code":"UNAUTHENTICATED",...}}
```

- [ ] **Step 8: Commit**

```bash
git add wrangler.toml
git commit -m "chore: add Cloudflare resource bindings and deployment config"
```

---

## Task 14: Update PNG2SS Documentation

**Files:**
- Modify: `/Users/yu-hung/Desktop/MyRepos/DNGTaMe/PNG2SS/README.md`
- Modify: `/Users/yu-hung/Desktop/MyRepos/DNGTaMe/PNG2SS/docs/png2ss-api-reference.md`

_(No commit required for these files.)_

- [ ] **Step 1: Update PNG2SS README.md**

In the `Error Responses` table, the `401` row currently reads:

> Missing or incorrect `X-RapidAPI-Proxy-Secret` or `X-Internal-Key` header

Update to:

> Missing or incorrect `X-RapidAPI-Proxy-Secret`, `X-Internal-Key`, or `X-MCP-Key` header

In the `Local Testing` section, update the env vars block to include:

```bash
RAPIDAPI_PROXY_SECRET=your_secret_here
INTERNAL_KEY=your_internal_key_here
MCP_KEY=your_mcp_key_here
```

In the `RapidAPI` section, after the `Internal Access` subsection, add a new subsection:

```markdown
#### MCP Server Access

For the `spritesheet-forge-mcp` Cloudflare Worker, send the `X-MCP-Key` header with the value from `.env`. Rate limiting is enforced in the MCP Worker layer (100 requests/user/month on the free tier).
```

- [ ] **Step 2: Update PNG2SS API reference**

In `docs/png2ss-api-reference.md`, in the `Authentication` table, add a third row:

| `X-MCP-Key` | For the spritesheet-forge MCP server. Rate-limited per user by the MCP gateway. |

- [ ] **Step 3: Verify no broken references**

```bash
grep -r "X-Internal-Key\|X-MCP-Key\|MCP_KEY" /Users/yu-hung/Desktop/MyRepos/DNGTaMe/PNG2SS/ --include="*.md" --include="*.py"
```

Expected: all occurrences are consistent with the changes above.

---

## Task 15: Update GIF2SS Documentation

**Files:**
- Modify: `/Users/yu-hung/Desktop/MyRepos/DNGTaMe/GIF2SS/README.md`
- Modify: `/Users/yu-hung/Desktop/MyRepos/DNGTaMe/GIF2SS/docs/gif2ss-api-reference.md`

_(No commit required for these files.)_

- [ ] **Step 1: Update GIF2SS README.md**

In the `Error Responses` table, the `403` row currently reads:

> Missing or incorrect `X-RapidAPI-Proxy-Secret` or `X-Internal-Key` header

Update to:

> Missing or incorrect `X-RapidAPI-Proxy-Secret`, `X-Internal-Key`, or `X-MCP-Key` header

Update the env vars block to include `MCP_KEY=your_mcp_key_here`.

After the `Internal Access` subsection in the `RapidAPI` section, add:

```markdown
#### MCP Server Access

For the `spritesheet-forge-mcp` Cloudflare Worker, send the `X-MCP-Key` header. Rate limiting is enforced in the MCP Worker layer (100 requests/user/month on the free tier).
```

- [ ] **Step 2: Update GIF2SS API reference**

In `docs/gif2ss-api-reference.md`, in the `Authentication — Two Keys Explained` table, add a third row for `X-MCP-Key`:

| `X-MCP-Key` | `.env` / Cloud Run env var | **MCP gateway** — sent by spritesheet-forge Worker | Allows the spritesheet-forge MCP server to call the backend directly, with rate limiting enforced at the Worker layer |

- [ ] **Step 3: Verify no broken references**

```bash
grep -r "X-Internal-Key\|X-MCP-Key\|MCP_KEY" /Users/yu-hung/Desktop/MyRepos/DNGTaMe/GIF2SS/ --include="*.md" --include="*.py"
```

Expected: all occurrences are consistent.

---

## Self-Review Checklist

### Spec coverage

| Spec requirement | Covered by |
|---|---|
| Cloudflare Worker as MCP gateway | Tasks 3, 11, 12 |
| GitHub OAuth 2.1 (AS + GitHub IdP) | Tasks 8, 12 |
| KV: sessions + quotas | Tasks 7, 8 |
| R2: 24h TTL output storage | Tasks 6, 12 |
| SSRF guard (all 9 protections) | Task 5 |
| URL + base64 input handling | Task 6 |
| 7 MCP tools (3 PNG + 4 GIF) | Tasks 9, 10 |
| Quota: 100/month, reset monthly | Task 7 |
| Quota status in every response | Tasks 9, 10 |
| Error codes (all 11) | Task 4 |
| X-MCP-Key in PNG2SS | Tasks 1, 14 |
| X-MCP-Key in GIF2SS | Tasks 2, 15 |
| Output served via Worker route | Task 12 |
| PKCE verification | Task 8 |

All spec requirements covered. ✓
