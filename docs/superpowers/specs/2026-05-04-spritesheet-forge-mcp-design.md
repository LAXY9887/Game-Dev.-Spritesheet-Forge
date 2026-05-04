# spritesheet-forge-mcp Design Spec

**Date:** 2026-05-04
**Status:** Approved

---

## Overview

`spritesheet-forge-mcp` is a hosted remote MCP server that exposes two existing Cloud Run APIs — PNG2SS and GIF2SS — as MCP tools for AI agents. Target audience: game developers using Claude, Cursor, Windsurf, or other MCP-compatible clients.

Distribution targets: Anthropic official MCP Registry, Smithery.ai, Glama.ai, Cursor Directory, mcp.so.

---

## Architecture

### Components

```
Claude.ai / Cursor / Windsurf
          │
          │ MCP (Streamable HTTP)
          ▼
┌─────────────────────────────┐
│   Cloudflare Worker         │
│   ├── OAuth 2.1 (GitHub)    │
│   ├── MCP Protocol layer    │◄── Streamable HTTP transport
│   ├── File handler          │◄── URL download / base64 decode
│   ├── SSRF guard            │
│   ├── Quota checker         │
│   └── R2 uploader           │
└──────────┬──────────────────┘
           │              │
        KV store        R2 bucket
        SESSIONS        spritesheet-forge-output
        QUOTAS          (24h TTL on outputs)
           │
           │ X-MCP-Key (multipart/form-data)
           ▼
    ┌──────────────┐   ┌──────────────┐
    │  PNG2SS      │   │  GIF2SS      │
    │  Cloud Run   │   │  Cloud Run   │
    └──────────────┘   └──────────────┘
```

### Tool call flow

1. Agent invokes a tool with URL or base64 file input
2. Worker validates OAuth session
3. Worker checks monthly quota in KV
4. Worker downloads URL or decodes base64 into binary
5. Worker assembles multipart/form-data, sends to Cloud Run with `X-MCP-Key`
6. Cloud Run returns binary result
7. Worker uploads result to R2 with 24h TTL
8. Worker returns R2 download URL + quota status to Agent

### Cloudflare resources

| Resource | Name | Purpose |
|---|---|---|
| Worker | `spritesheet-forge` | Main application |
| KV namespace | `SESSIONS` | OAuth sessions (30-day TTL) |
| KV namespace | `QUOTAS` | Per-user monthly usage |
| R2 bucket | `spritesheet-forge-output` | Temporary output files (24h TTL) |
| Custom domain | `mcp.spritesheet-forge.com` (or `spritesheet-forge.workers.dev` initially) | Public MCP endpoint |

### Repository structure

```
spritesheet-forge-mcp/
├── src/
│   ├── index.ts           # Worker entry point, MCP + OAuth routes
│   ├── auth.ts            # GitHub OAuth 2.1 flow
│   ├── quota.ts           # KV-based quota tracking
│   ├── file-handler.ts    # URL download / base64 decode / R2 upload / SSRF guard
│   ├── tools/
│   │   ├── png2ss.ts      # png_to_spritesheet, split_spritesheet, trim_png
│   │   └── gif2ss.ts      # gif_to_spritesheet, gif_to_frames, frames_to_animation, spritesheet_to_animation
│   └── types.ts           # Shared types
├── wrangler.toml
├── package.json
└── tsconfig.json
```

---

## MCP Tools

### PNG2SS tools

#### `png_to_spritesheet`
Merges multiple PNG files into a single spritesheet. Wraps `POST /to-spritesheet` on PNG2SS.

Input parameters:
- `files` (string[], required) — Array of URLs or base64 data URIs (`data:image/png;base64,...`)
- `layout` (string, optional) — `grid` | `horizontal` | `vertical` | `packed`. Default: `grid`
- `columns` (integer, optional) — Grid columns. Auto-calculated if omitted.
- `cell_mode` (string, optional) — `auto_max` | `auto_uniform` | `fixed`. Default: `auto_max`
- `cell_width` (integer, optional) — Required when `cell_mode=fixed`
- `cell_height` (integer, optional) — Required when `cell_mode=fixed`
- `fit_mode` (string, optional) — `scale_fit` | `scale_fill` | `error`. Default: `scale_fit`
- `align` (string, optional) — `center` | `top_left`. Default: `center`
- `padding` (integer, optional) — Pixel gap between frames. Default: `0`
- `bg_color` (string, optional) — `transparent` or hex `#RRGGBB`. Default: `transparent`
- `power_of_2` (boolean, optional) — Pad output to next power of 2. Default: `false`
- `file_name_order` (boolean, optional) — Sort by `_N` filename suffix. Default: `false`
- `trim_input` (boolean, optional) — Auto-trim transparent edges before compositing. Default: `false`
- `extrude` (integer, optional) — Extrude outermost pixels outward by N px. Default: `0`
- `metadata_format` (string, optional) — `none` | `json_array` | `json_hash` | `css`. Default: `none`

Output: `{ url, expires_at, content_type, size_bytes, quota }`
- `content_type` is `image/png` when `metadata_format=none`, `application/zip` otherwise

---

#### `split_spritesheet`
Slices a spritesheet PNG into individual frames or generates atlas JSON. Wraps `POST /split-spritesheet` on PNG2SS.

Input parameters:
- `file` (string, required) — URL or base64 data URI of the spritesheet PNG
- `columns` (integer, conditional) — Grid columns. Required with `rows` for grid mode.
- `rows` (integer, conditional) — Grid rows. Required with `columns` for grid mode.
- `cell_width` (integer, conditional) — Cell width in px. Required with `cell_height` for cell mode.
- `cell_height` (integer, conditional) — Cell height in px. Required with `cell_width` for cell mode.
- `padding` (integer, optional) — Pixel gap between cells. Default: `0`
- `frame_count` (integer, optional) — Truncate to first N frames.
- `column_range` (string, optional) — Columns to extract, e.g. `"0-5"` or `"2"`. 0-indexed.
- `row_range` (string, optional) — Rows to extract. 0-indexed.
- `skip_empty` (boolean, optional) — Remove fully transparent frames. Default: `true`
- `trim_top` / `trim_right` / `trim_bottom` / `trim_left` (integer, optional) — Crop outer margins before slicing. Default: `0`
- `output` (string, optional) — `frames` | `metadata` | `both`. Default: `frames`
- `metadata_format` (string, optional) — `json_array` | `json_hash` | `css`. Default: `json_array`

Output: `{ url, expires_at, content_type, size_bytes, quota }`

---

#### `trim_png`
Crops transparent edges from one or more PNG files. Wraps `POST /trim` on PNG2SS.

Input parameters:
- `files` (string[], required) — Array of URLs or base64 data URIs
- `threshold` (integer, optional) — Alpha threshold 0–255. Pixels with alpha ≤ threshold are trimmed. Default: `0`
- `padding` (integer, optional) — Transparent margin to preserve around trimmed content. Default: `0`

Output: `{ url, expires_at, content_type, size_bytes, quota }`
- `content_type` is `image/png` for single file, `application/zip` for multiple files

---

### GIF2SS tools

#### `gif_to_spritesheet`
Converts a GIF into a spritesheet PNG. Wraps `POST /to-spritesheet` on GIF2SS.

Input parameters:
- `file` (string, required) — URL or base64 data URI of the GIF
- `columns` (integer, optional) — Grid columns. Auto-calculated if omitted.
- `padding` (integer, optional) — Pixel gap between frames. Default: `0`
- `remove_bg` (boolean, optional) — Remove background from each frame. Default: `false`
- `bg_color` (string, optional) — `"auto"` or hex `#RRGGBB`. Default: `"auto"`
- `tolerance` (integer, optional) — Background removal threshold 0–255. Default: `30`

Output: `{ url, expires_at, content_type: "image/png", size_bytes, quota }`

---

#### `gif_to_frames`
Extracts all frames from a GIF as individual PNGs in a ZIP. Wraps `POST /to-frames` on GIF2SS.

Input parameters:
- `file` (string, required) — URL or base64 data URI of the GIF
- `remove_bg` (boolean, optional) — Remove background from each frame. Default: `false`
- `bg_color` (string, optional) — `"auto"` or hex `#RRGGBB`. Default: `"auto"`
- `tolerance` (integer, optional) — Background removal threshold 0–255. Default: `30`

Output: `{ url, expires_at, content_type: "application/zip", size_bytes, quota }`

---

#### `frames_to_animation`
Assembles multiple PNG files into an animated GIF or WebP. Wraps `POST /from-frames` on GIF2SS.

Input parameters:
- `files` (string[], required) — Array of URLs or base64 data URIs of PNG frames
- `duration` (integer, optional) — Frame duration in ms (10–10000). Default: `100`
- `loop` (integer, optional) — Loop count. `0` = infinite. Default: `0`
- `file_name_order` (boolean, optional) — Sort by `_N` filename suffix. Default: `false`
- `resize` (string, optional) — Dimension mismatch handling: `"error"` | `"fill"` | `"transparent"`. Default: `"transparent"`
- `bg_fill_color` (string, optional) — Fill color for `resize="fill"`. Hex `#RRGGBB`. Default: `"#000000"`
- `output_format` (string, optional) — `"gif"` | `"webp"`. Default: `"gif"`
- `quality` (integer, optional) — WebP lossy quality 0–100. Default: `80`
- `lossless` (boolean, optional) — WebP lossless mode. Default: `false`

Output: `{ url, expires_at, content_type, size_bytes, quota }`
- `content_type` is `image/gif` or `image/webp` following `output_format`

---

#### `spritesheet_to_animation`
Slices a spritesheet PNG and produces an animated GIF or WebP. Wraps `POST /from-spritesheet` on GIF2SS.

Input parameters:
- `file` (string, required) — URL or base64 data URI of the spritesheet PNG
- `columns` (integer, conditional) — Grid columns. Required with `rows` for grid mode.
- `rows` (integer, conditional) — Grid rows. Required with `columns` for grid mode.
- `cell_width` (integer, conditional) — Cell width in px. Required with `cell_height` for cell mode.
- `cell_height` (integer, conditional) — Cell height in px. Required with `cell_width` for cell mode.
- `frame_count` (integer, optional) — Actual frame count for incomplete last row.
- `padding` (integer, optional) — Pixel gap between cells. Default: `0`
- `column_range` (string, optional) — Columns to extract. 0-indexed.
- `row_range` (string, optional) — Rows to extract. 0-indexed.
- `skip_empty` (boolean, optional) — Auto-remove fully transparent frames. Default: `true`
- `trim_top` / `trim_right` / `trim_bottom` / `trim_left` (integer, optional) — Crop outer margins. Default: `0`
- `duration` (integer, optional) — Frame duration in ms (10–10000). Default: `100`
- `loop` (integer, optional) — Loop count. `0` = infinite. Default: `0`
- `output_format` (string, optional) — `"gif"` | `"webp"`. Default: `"gif"`
- `quality` (integer, optional) — WebP lossy quality 0–100. Default: `80`
- `lossless` (boolean, optional) — WebP lossless mode. Default: `false`

Output: `{ url, expires_at, content_type, size_bytes, quota }`

---

## Authentication — GitHub OAuth 2.1

### Flow

1. MCP client connects to the Worker endpoint (`spritesheet-forge.workers.dev` or custom domain)
2. Worker initiates GitHub OAuth: `https://github.com/login/oauth/authorize?scope=read:user`
3. User authorizes on GitHub
4. GitHub redirects to Worker callback with `code`
5. Worker exchanges `code` for access token, fetches GitHub user ID
6. Worker stores session in KV:
   - Key: `session:{uuid}`
   - Value: `{ githubUserId, githubLogin, createdAt }`
   - TTL: 30 days
7. Session cookie set on client for subsequent tool calls

GitHub OAuth scope: `read:user` only — no repository or organization access required.

---

## Quota System

### Storage

```
KV key:   quota:{githubUserId}:{YYYY-MM}
Value:    { count: 42, updatedAt: "2026-05-04T10:00:00Z" }
TTL:      Auto-expires at end of month
```

### Limits

| Tier | Monthly conversions |
|---|---|
| Free | 100 |
| (Future paid tier) | TBD |

Each successful tool call (Cloud Run returns 2xx) increments count by 1.

### Quota in every response

Every successful tool response includes current quota status:

```json
{
  "url": "https://spritesheet-forge.workers.dev/output/abc123.png",
  "expires_at": "2026-05-05T12:00:00Z",
  "content_type": "image/png",
  "size_bytes": 48291,
  "quota": { "used": 43, "limit": 100, "reset_at": "2026-06-01" }
}
```

---

## File Handler

### Input pipeline

```
tool call file parameter
        │
        ├── starts with "https://"?
        │         └── safeDownload(url) — see SSRF guard below
        │
        ├── starts with "data:...;base64,"?
        │         └── decode to ArrayBuffer
        │
        └── else → 400 INVALID_FILE_INPUT
        ↓
   Appended to FormData (multi-file tools append multiple entries)
        ↓
   POST to Cloud Run with X-MCP-Key header
```

### SSRF guard (applied on every URL download)

1. **HTTPS only** — reject any non-`https://` scheme
2. **Blocked hostnames:**
   - `169.254.169.254` (AWS/GCP metadata)
   - `metadata.google.internal`
   - `localhost`, `127.0.0.1`, `::1`
3. **Blocked IP prefixes:** `10.`, `172.16.`–`172.31.`, `192.168.`
4. **HEAD preflight** — check `Content-Length` before downloading body
5. **Size limit** — abort if `Content-Length` > 20 MB (single file) or 60 MB (total)
6. **Download timeout** — `AbortSignal.timeout(10_000)` (10 seconds)
7. **Content-Type validation** — accept only `image/png`, `image/gif`, `image/webp`
8. **Redirect limit** — maximum 3 redirects; re-validate final URL through same checks
9. **Streaming size guard** — abort read if body exceeds limit even if `Content-Length` was absent or falsified

### Output pipeline

```
Cloud Run binary response
        │
        ├── Determine extension from Content-Type
        │   image/png → .png | image/gif → .gif
        │   image/webp → .webp | application/zip → .zip
        │
        └── Upload to R2: output-{uuid}.{ext}
            Metadata: { expiresAt: now + 24h, userId, tool }
        ↓
   Return { url, expires_at, content_type, size_bytes, quota }
```

---

## Error Handling

All errors follow this schema:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

### Error codes

| Code | HTTP | Source | Description |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | Worker | No valid session; re-authorize via OAuth |
| `QUOTA_EXCEEDED` | 429 | Worker | Monthly limit reached; includes reset date |
| `INVALID_FILE_INPUT` | 400 | Worker | Not a valid URL or base64 data URI |
| `INVALID_FILE_URL` | 400 | Worker | URL scheme not HTTPS |
| `BLOCKED_URL` | 400 | Worker | SSRF guard triggered (private IP or metadata host) |
| `FILE_TOO_LARGE` | 413 | Worker | Exceeds 20 MB per file or 60 MB total |
| `INVALID_CONTENT_TYPE` | 400 | Worker | URL response is not an accepted image type |
| `DOWNLOAD_TIMEOUT` | 408 | Worker | URL download exceeded 10 seconds |
| `INVALID_BASE64` | 400 | Worker | base64 decoding failed |
| `UPSTREAM_ERROR` | 502 | Worker | Cloud Run returned 4xx/5xx; original `detail` forwarded |
| `PROCESSING_ERROR` | 500 | Worker | Unexpected internal error |

Cloud Run validation errors (422 with `detail`) are forwarded as `UPSTREAM_ERROR` with the original message intact, so the agent receives actionable feedback.

---

## Backend Changes — PNG2SS & GIF2SS

Both Cloud Run services require one minimal change: accept `X-MCP-Key` as a valid auth header.

### Auth middleware change (both services)

```python
valid = (
    request.headers.get("X-RapidAPI-Proxy-Secret") == RAPIDAPI_SECRET
    or request.headers.get("X-Internal-Key") == INTERNAL_KEY
    or request.headers.get("X-MCP-Key") == MCP_KEY      # new
)
```

`MCP_KEY` is injected via Cloud Run environment variable, same pattern as `INTERNAL_KEY`.

Rate limiting is enforced entirely in the Cloudflare Worker (quota system). Cloud Run has no knowledge of per-user limits.

**Files to modify:**
- PNG2SS: `app/main.py` (auth middleware)
- GIF2SS: `app/main.py` (auth middleware)

**Documentation to update (no commit):**
- PNG2SS: `README.md`, `docs/png2ss-api-reference.md`
- GIF2SS: `README.md`, `docs/gif2ss-api-reference.md`

---

## Key Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Deployment model | Hosted remote | Required for official Claude.ai Connector |
| Auth protocol | OAuth 2.1 | Claude.ai Connector requirement |
| OAuth provider | GitHub only | Best fit for developer audience; simplest implementation |
| Gateway tech | TypeScript on Cloudflare Workers | Industry standard for remote MCP; free tier sufficient |
| File I/O | URL or base64 in; R2 URL out | Flexible input; clean shareable output avoids context window bloat |
| Monetization | Freemium (100/month free) | Grow user base first; KV tracking is low-effort; upgrade path to paid later |
| Rate limiting | Worker-side only | Cloud Run stays simple; all protection at the edge |
| Server name | `spritesheet-forge-mcp` | Descriptive + game dev resonance |
