# Spritesheet Forge MCP

[![smithery badge](https://smithery.ai/badge/lxya98874322688423/spritesheet-forge)](https://smithery.ai/servers/lxya98874322688423/spritesheet-forge)

A hosted [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for game-dev spritesheet workflows. Connect it to Claude or any MCP-compatible AI client and pack, split, trim, and animate sprites through natural language — no local tools required.

**Server endpoint:** `https://mcp.clawstudiouo.com/mcp`

**Articles:**
- [GIF to Game-Ready Spritesheet with Claude MCP: A Complete Walkthrough](https://clawstudiouo.com/blog/spritesheet-forge-mcp-demo) — real demo: GIF → spritesheet → TexturePacker atlas JSON, with tool chaining and Unity/Godot integration notes
- [Building a Remote MCP Server with Cloudflare Workers and GCP Cloud Run](https://clawstudiouo.com/blog/building-remote-mcp-server) — technical deep-dive: OAuth 2.1 + PKCE, internal service auth, R2 file staging, and tool design for LLMs

---

## Table of Contents

- [What This Server Does](#what-this-server-does)
- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [Tools Overview](#tools-overview)
- [File Input Guide](#file-input-guide)
- [Tool Reference](#tool-reference)
- [Working with AI Agents](#working-with-ai-agents)
- [Limits & Quotas](#limits--quotas)
- [Benchmark](#benchmark)
- [FAQ](#faq)
- [Self-Hosting](#self-hosting)

---

## What This Server Does

Spritesheet Forge exposes **7 image-processing tools** over MCP. An AI agent calls them like any other tool — no shell commands, no local dependencies.

| Capability | Tools |
|------------|-------|
| GIF → spritesheet grid | `gif_to_spritesheet` |
| GIF → individual frames | `gif_to_frames` |
| Spritesheet → animated GIF/WebP | `spritesheet_to_animation` |
| Multiple PNGs → spritesheet | `png_to_spritesheet` |
| Spritesheet → split frames + atlas JSON | `split_spritesheet` |
| Frames → animated GIF/WebP | `frames_to_animation` |
| Trim transparent edges from PNGs | `trim_png` |

**Typical agent workflows:**

```
"Convert character.gif into a spritesheet for Unity"
→ gif_to_spritesheet

"Extract every frame from this animation, then trim the transparent borders"
→ gif_to_frames → trim_png (chained — output URL passed directly)

"Turn this spritesheet (4 columns × 3 rows) back into an animated GIF at 120ms per frame"
→ spritesheet_to_animation

"Pack these 12 sprites into a single atlas with a TexturePacker-compatible JSON"
→ png_to_spritesheet (layout=packed, metadata_format=json_hash)
```

### Limitations

- **Input formats:** PNG, GIF, WebP
- **Max file size:** 20 MB per file
- **Output TTL:** Files expire **1 hour** after creation — do not store output URLs for later
- **Quota:** 100 operations per GitHub account per month (free tier)
- **Output format:** Tools return a download URL; the server does not stream binary data directly

---

## Quick Start

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your platform:

```json
{
  "mcpServers": {
    "spritesheet-forge": {
      "type": "http",
      "url": "https://mcp.clawstudiouo.com/mcp"
    }
  }
}
```

Restart Claude Desktop. On first use, Claude will open a GitHub login page to authorize access. After approval you can start using the tools immediately.

### Claude Code (CLI)

```bash
claude mcp add spritesheet-forge --transport http https://mcp.clawstudiouo.com/mcp
```

### Other MCP Clients

Any client that supports **Streamable HTTP** (MCP 2024-11-05 spec) can connect. Use:

- **MCP endpoint:** `https://mcp.clawstudiouo.com/mcp`
- **Auth:** OAuth 2.1 with PKCE (GitHub as IdP) — see [Authentication](#authentication)
- **Discovery:** `GET https://mcp.clawstudiouo.com/.well-known/oauth-authorization-server`

---

## Authentication

Spritesheet Forge uses **GitHub OAuth 2.1 with PKCE**. No API keys to create or rotate — you log in with GitHub and receive a long-lived session token.

### How MCP clients handle it (recommended)

MCP clients like Claude Desktop and Claude Code run the OAuth flow automatically — they open a browser window, you approve the GitHub login, and the token is stored for you. No manual steps needed.

### Getting a token manually (for benchmark / curl testing)

If you need a Bearer token directly — to run the benchmark script, test with curl, or integrate with a custom client — run this single command (requires Python 3, pre-installed on macOS/Linux):

```bash
curl -O https://spritesheet-forge.spritesheet-forge.workers.dev/get-token.py && python3 get-token.py
```

This will:
1. Download the OAuth helper script directly from the server
2. Register a temporary OAuth client via [RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591)
3. Open your browser to the GitHub authorization page
4. Exchange the code for a Bearer token, print it, and save it to `~/.spritesheet-forge-token`

To test against a self-hosted instance:

```bash
python3 get-token.py --base-url https://your-worker.workers.dev
```

### Token lifetime

Session tokens are valid for **30 days**. After expiry, re-run the OAuth flow (or let your MCP client handle it automatically on the next connection).

---

## Tools Overview

### `server_info`

Returns this server's runtime configuration — upload endpoint URL, output TTL, file size limits, and encoding rules. **Call this first** when you need the exact upload URL or are planning a multi-step workflow.

```json
{
  "upload_url": "https://mcp.clawstudiouo.com/upload",
  "output_ttl_seconds": 3600,
  "max_file_bytes": 20971520,
  "base64_threshold_bytes": 4194304,
  "file_input_rules": { ... }
}
```

### `gif_to_spritesheet`

Converts a GIF animation into a spritesheet PNG. Frames are arranged in a grid; column count is auto-calculated from the frame count if not specified. Optional background removal.

### `gif_to_frames`

Extracts every frame from a GIF and returns them as individual PNGs in a ZIP archive. Useful for editing single frames before reassembling.

### `spritesheet_to_animation`

Slices a spritesheet back into frames and assembles them into an animated GIF or WebP. Supports both grid mode (`columns` + `rows`) and cell mode (`cell_width` + `cell_height`).

### `png_to_spritesheet`

Merges multiple PNG files into a single spritesheet. Supports `grid`, `horizontal`, `vertical`, and `packed` (bin-packed) layouts. Can optionally output TexturePacker-compatible atlas JSON alongside the image.

### `split_spritesheet`

The reverse of `png_to_spritesheet` — slices a spritesheet into individual frame PNGs, generates atlas JSON metadata, or both. Supports grid mode and cell mode.

### `frames_to_animation`

Assembles a sequence of PNG frames into an animated GIF or animated WebP. Accepts frames in any order and sorts them by `_N` suffix if `file_name_order=true`.

### `trim_png`

Crops transparent (alpha) edges from one or more PNG files. Single file returns a PNG; multiple files return a ZIP. Useful before packing sprites to remove wasted whitespace.

---

## File Input Guide

All `file` / `files` parameters accept three input types:

### 1. Output URL from a previous tool call (fastest)

If you're chaining tools, just pass the output URL directly:

```
"file": "https://mcp.clawstudiouo.com/output/output-abc123.png"
```

The server reads from its own storage without making an HTTP request — this is always faster than re-uploading.

### 2. Base64 data URI (files < ~185 KB)

Encode the raw file bytes and prepend the MIME type:

```
"file": "data:image/gif;base64,R0lGODlh..."
```

> **Important:** You MUST strip ALL whitespace and newlines from the base64 string before prepending the prefix. Many base64 encoders (e.g. `openssl base64`, some shell tools) insert newlines every 76 characters — these will cause an `INVALID_BASE64` error.

```bash
# Correct — strips newlines
base64 -i file.gif | tr -d '\n'

# Python
import base64
base64.b64encode(open("file.gif","rb").read()).decode()
```

> **AI agent note:** In Claude Code / Claude Desktop, shell command output exceeding ~250 KB is written to a temp file that AI tools cannot read back (256 KB tool limit). A ~185 KB file encodes to ~247 KB base64 — just under the limit. For any file larger than ~185 KB, or any file you encoded via a shell command, use the upload endpoint instead.

### 3. Upload endpoint (files ≥ ~185 KB)

For files ≥ ~185 KB (or any file encoded via shell command), upload first and pass the returned URL:

```bash
# 1. Get the upload URL
upload_url=$(curl -s https://mcp.clawstudiouo.com/mcp ... | jq -r '.upload_url')
# Or: call server_info tool to get upload_url

# 2. Upload the file
curl -X POST https://mcp.clawstudiouo.com/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@animation.gif;type=image/gif"
# Returns: {"url": "https://mcp.clawstudiouo.com/output/upload-xyz.gif", ...}

# 3. Pass the URL to the tool
```

Upload endpoint details:
- **URL:** `https://mcp.clawstudiouo.com/upload` (or call `server_info` for the current value)
- **Method:** `POST`, `multipart/form-data`
- **Field name:** `file`
- **Auth:** Same Bearer token as the MCP connection
- **Max size:** 20 MB
- **Accepted types:** `image/png`, `image/gif`, `image/webp`

> **Why not always base64 for large files?** A 4.7 MB GIF encodes to a ~6.3 MB JSON-RPC payload, which most MCP clients reject or truncate. The latency is nearly identical either way — for beeg.gif (126 frames), base64 took 12472 ms and upload+URL took 12624 ms. The difference is payload safety, not speed. See [Benchmark](#benchmark) for full data.

### Decision rule

| File size | Method |
|-----------|--------|
| < ~185 KB | Base64 data URI |
| ≥ ~185 KB, or encoded via shell command | Upload endpoint → pass URL |
| Previous tool output | Pass URL directly |

### Output TTL

All output URLs — including upload results and tool outputs — expire **1 hour** after creation. Plan multi-step workflows accordingly and do not cache URLs across sessions.

---

## Tool Reference

### `png_to_spritesheet`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `files` | `string[]` | **required** | PNG files |
| `layout` | `string` | `grid` | `grid` \| `horizontal` \| `vertical` \| `packed` |
| `columns` | `integer` | auto | Grid columns |
| `cell_mode` | `string` | `auto_max` | `auto_max` \| `auto_uniform` \| `fixed` |
| `cell_width` | `integer` | — | Required when `cell_mode=fixed` |
| `cell_height` | `integer` | — | Required when `cell_mode=fixed` |
| `fit_mode` | `string` | — | `scale_fit` \| `scale_fill` \| `error` |
| `align` | `string` | — | `center` \| `top_left` |
| `padding` | `integer` | `0` | Pixel gap between frames |
| `bg_color` | `string` | `transparent` | `"transparent"` or `"#RRGGBB"` |
| `power_of_2` | `boolean` | `false` | Pad output to next power of 2 |
| `file_name_order` | `boolean` | `false` | Sort by `_N` filename suffix |
| `trim_input` | `boolean` | `false` | Auto-trim transparent edges before packing |
| `extrude` | `integer` | `0` | Extrude outermost pixels by N px per frame |
| `metadata_format` | `string` | `none` | `none` \| `json_array` \| `json_hash` \| `css`. Required (non-none) for `layout=packed` |

---

### `split_spritesheet`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `file` | `string` | **required** | Spritesheet PNG |
| `columns` | `integer` | — | Grid columns (grid mode) |
| `rows` | `integer` | — | Grid rows (grid mode) |
| `cell_width` | `integer` | — | Cell width px (cell mode) |
| `cell_height` | `integer` | — | Cell height px (cell mode) |
| `padding` | `integer` | `0` | Pixel gap between cells |
| `frame_count` | `integer` | — | Actual frame count for incomplete last row |
| `column_range` | `string` | — | e.g. `"0-5"` or `"2"` |
| `row_range` | `string` | — | e.g. `"0-3"` |
| `skip_empty` | `boolean` | `true` | Remove fully transparent frames |
| `trim_top` | `integer` | `0` | Per-edge trim offset |
| `trim_right` | `integer` | `0` | |
| `trim_bottom` | `integer` | `0` | |
| `trim_left` | `integer` | `0` | |
| `output` | `string` | `frames` | `frames` \| `metadata` \| `both` |
| `metadata_format` | `string` | — | `json_array` \| `json_hash` \| `css` |

---

### `trim_png`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `files` | `string[]` | **required** | PNG files |
| `threshold` | `integer` | `0` | Alpha threshold 0–255. Pixels with alpha ≤ threshold are trimmed |
| `padding` | `integer` | `0` | Transparent margin to preserve around trimmed content |

---

### `gif_to_spritesheet`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `file` | `string` | **required** | GIF file |
| `columns` | `integer` | auto | Grid columns |
| `padding` | `integer` | `0` | Pixel gap between frames |
| `remove_bg` | `boolean` | `false` | Remove background from each frame |
| `bg_color` | `string` | `auto` | `"auto"` or `"#RRGGBB"` |
| `tolerance` | `integer` | `30` | Background removal threshold 0–255 |

---

### `gif_to_frames`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `file` | `string` | **required** | GIF file |
| `remove_bg` | `boolean` | `false` | Remove background from each frame |
| `bg_color` | `string` | `auto` | `"auto"` or `"#RRGGBB"` |
| `tolerance` | `integer` | `30` | Background removal threshold 0–255 |

---

### `frames_to_animation`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `files` | `string[]` | **required** | PNG frames |
| `duration` | `integer` | `100` | Frame duration in ms (10–10000) |
| `loop` | `integer` | `0` | Loop count. `0` = infinite |
| `file_name_order` | `boolean` | `false` | Sort by `_N` filename suffix |
| `resize` | `string` | `transparent` | Dimension mismatch: `error` \| `fill` \| `transparent` |
| `bg_fill_color` | `string` | `#000000` | Fill color when `resize=fill` |
| `output_format` | `string` | `gif` | `gif` \| `webp` |
| `quality` | `integer` | `80` | WebP lossy quality 0–100 |
| `lossless` | `boolean` | `false` | WebP lossless mode |

---

### `spritesheet_to_animation`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `file` | `string` | **required** | Spritesheet PNG |
| `columns` | `integer` | — | Grid columns (grid mode) |
| `rows` | `integer` | — | Grid rows (grid mode) |
| `cell_width` | `integer` | — | Cell width px (cell mode) |
| `cell_height` | `integer` | — | Cell height px (cell mode) |
| `frame_count` | `integer` | — | Actual frame count for incomplete last row |
| `padding` | `integer` | `0` | Pixel gap between cells |
| `column_range` | `string` | — | e.g. `"0-5"` |
| `row_range` | `string` | — | e.g. `"0-3"` |
| `skip_empty` | `boolean` | `true` | Auto-remove fully transparent frames |
| `trim_top` | `integer` | `0` | Per-edge trim offset |
| `trim_right` | `integer` | `0` | |
| `trim_bottom` | `integer` | `0` | |
| `trim_left` | `integer` | `0` | |
| `duration` | `integer` | `100` | Frame duration in ms |
| `loop` | `integer` | `0` | Loop count. `0` = infinite |
| `output_format` | `string` | `gif` | `gif` \| `webp` |
| `quality` | `integer` | `80` | WebP quality 0–100 |
| `lossless` | `boolean` | `false` | WebP lossless |

---

## Working with AI Agents

Spritesheet Forge is designed for agentic use. The tools are self-documenting: each `file` / `files` parameter description contains the encoding instructions, and the `server_info` tool returns runtime configuration.

### Recommended agent workflow

For best results, give the agent this context upfront:

> "I've connected Spritesheet Forge MCP. For any file larger than ~185 KB, call `server_info` first to get the upload endpoint URL and token instructions, then POST the file there before calling the processing tool."

For tiny files (< ~185 KB) the agent can base64-encode directly. For anything larger, calling `server_info` first gives the agent the exact upload URL and explains how to obtain a Bearer token.

### Chaining tools

Output URLs from one tool can be passed directly as input to the next — no re-encoding needed. This is the most efficient pattern:

```
gif_to_spritesheet → split_spritesheet → frames_to_animation
```

Each call reuses the previous output URL. The server reads directly from storage on its end, so there is no extra HTTP overhead.

### TTL in long workflows

Output URLs expire after **1 hour**. If a workflow spans multiple agent turns or takes longer than an hour, re-run the earlier tool to get a fresh URL rather than retrying with a stale one.

### What agents see

When a tool call succeeds, the agent receives:

```json
{
  "url": "https://mcp.clawstudiouo.com/output/output-abc123.png",
  "expires_at": "2026-05-05T12:00:00.000Z",
  "content_type": "image/png",
  "size_bytes": 516432,
  "quota": { "used": 4, "limit": 100, "reset_at": "2026-06-01T00:00:00.000Z" }
}
```

The `url` field is what to pass to the next tool or present to the user for download.

---

## Limits & Quotas

| Limit | Value |
|-------|-------|
| Max file size | 20 MB |
| Base64 practical limit | ~185 KB for AI agents (above this, use upload endpoint) |
| Output file TTL | 1 hour |
| Upload TTL | 1 hour |
| Free quota | 100 operations / GitHub account / month |
| Quota reset | 1st of each month |
| Session token lifetime | 30 days |

---

## Benchmark

A reproducible benchmark covering all 7 tools and a direct comparison of base64 vs upload-endpoint efficiency is available in [`benchmark/`](benchmark/).

Reference run results (2026-05-05) including actual output files are in [`benchmark/sample/`](benchmark/sample/). The `sample/` directory is a fixed snapshot and is not updated on subsequent runs.

**Key findings from the reference run:**

| Method | Fixture | Total |
|--------|---------|------:|
| Direct base64 | smol.gif 221 KB | 2787 ms |
| Upload + URL | smol.gif 221 KB | 3519 ms |
| Direct base64 | beeg.gif 4.7 MB | 12472 ms |
| Upload + URL | beeg.gif 4.7 MB | 12624 ms |

For large files (≥ 4 MB), base64 and upload+URL have nearly identical latency. The reason to use the upload endpoint is payload size: a 4.7 MB GIF encodes to a ~6.3 MB JSON-RPC payload that most MCP clients will reject.

To run the benchmark yourself:

```bash
# 1. Get a Bearer token
curl -O https://spritesheet-forge.spritesheet-forge.workers.dev/get-token.py && python3 get-token.py

# 2. Export and run
export SPRITESHEET_TOKEN="your_token"
bash benchmark/run.sh
```

---

## FAQ

**Q: My base64 upload fails with `INVALID_BASE64`.**

Strip ALL whitespace and newlines from the base64 string before prepending the data URI prefix. Many encoders (e.g. `openssl base64`) insert newlines every 76 characters. Use `| tr -d '\n'` in shell or Python's `base64.b64encode(...).decode()`.

---

**Q: I get `INVALID_FILE_URL` when passing a previous tool's output URL.**

The URL has expired (1-hour TTL). Re-run the tool that produced it to get a fresh URL.

---

**Q: How do I chain tool outputs?**

Pass the `url` field from one tool's response directly as the `file` input of the next tool. No re-encoding or re-uploading needed — the server reads from its own storage.

---

**Q: Which input image formats are supported?**

PNG, GIF, and WebP. JPEG is not supported as input (no transparency channel).

---

**Q: What does the output look like? Can I preview it?**

The output URL is a direct download link (`Content-Disposition: inline` for images). You can open it in a browser tab — it will display inline if your browser supports the format — or download it directly with curl. URLs expire after 1 hour.

---

**Q: I hit the quota limit. What now?**

Quota resets on the 1st of each month. The current usage is returned in every tool response under the `quota` field. If you need higher limits, consider [self-hosting](#self-hosting).

---

**Q: Can I use this without an AI client?**

Yes — the MCP endpoint accepts standard JSON-RPC 2.0 over HTTP. You can call it with curl or any HTTP client as long as you include a valid `Authorization: Bearer <token>` header. See [`benchmark/run.sh`](benchmark/run.sh) for a working shell example.

---

**Q: The agent keeps trying to encode a large file as base64 instead of using the upload endpoint.**

Tell the agent explicitly: *"This file is larger than ~185 KB. Call `server_info` first to get the upload URL and token instructions, then POST the file there before calling the tool."* The `server_info` tool returns the exact upload URL and explains both the threshold and how to obtain a Bearer token.

---

## Self-Hosting

The server runs on Cloudflare Workers backed by KV (sessions/quota) and R2 (output storage). To deploy your own instance:

```bash
git clone https://github.com/LAXY9887/Game-Dev.-Spritesheet-Forge.git
cd "Game-Dev.-Spritesheet-Forge"
npm install

# Configure secrets
npx wrangler secret put MCP_KEY          # shared key for Cloud Run backend
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET

# Set your worker URL in wrangler.toml → [vars] WORKER_BASE_URL

npm run deploy
```

You will also need the two Cloud Run backend services (`gif2ss` and `png2ss`) running. See the backend repositories for setup instructions.


