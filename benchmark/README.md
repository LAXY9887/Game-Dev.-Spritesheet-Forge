# spritesheet-forge-mcp Benchmark

Reproducible correctness and performance benchmarks for all 7 tools in the
[spritesheet-forge-mcp](https://github.com/LAXY9887/Game-Dev.-Spritesheet-Forge)
remote MCP server.

---

## What Is Being Tested

### Phase 1 — Tool Coverage

Every tool is called with a real image fixture and verified to return a valid
output URL. Tests are chained: the spritesheet produced in Test 1 is reused as
input for Tests 3–7, mirroring a typical agent workflow.

| # | Tool | Input | Expected Output |
|---|------|-------|-----------------|
| 1 | `gif_to_spritesheet` | `smol.gif` (base64) | Spritesheet PNG (3×2 grid) |
| 2 | `gif_to_frames` | `smol.gif` (base64) | ZIP of 6 individual PNGs |
| 3 | `split_spritesheet` | Spritesheet from #1 | ZIP + TexturePacker JSON |
| 4 | `spritesheet_to_animation` | Spritesheet from #1 | Animated GIF |
| 5 | `trim_png` | Spritesheet from #1 | Trimmed PNG |
| 6 | `png_to_spritesheet` | Spritesheet from #1 (×2) | Horizontal composite |
| 7 | `frames_to_animation` | Spritesheet from #1 (×2) | Animated GIF |

### Phase 2 — Upload vs Base64 Efficiency

The server accepts file input two ways:

- **Base64 data URI** — inline in the JSON-RPC call body  
  (`data:image/gif;base64,…`)
- **Upload endpoint** — `POST /upload` returns a temporary URL that any tool
  accepts directly as input

This phase benchmarks `gif_to_spritesheet` across four combinations:

| Method | Fixture | Size | Notes |
|--------|---------|------|-------|
| Direct base64 | `smol.gif` | 221 KB | Single round-trip |
| Upload + URL | `smol.gif` | 221 KB | Two round-trips |
| Direct base64 | `beeg.gif` | 4.7 MB | ~6.3 MB JSON payload |
| Upload + URL | `beeg.gif` | 4.7 MB | Two round-trips |

The **4 MB threshold** is the hard cutover. Above that size:

- A 4.7 MB GIF becomes a **~6.3 MB JSON-RPC payload** when base64-encoded.
  Most MCP clients reject or truncate payloads above 4–8 MB, making this
  approach unreliable regardless of server support.
- Latency is **not** the deciding factor — as shown in the benchmark results
  below, beeg.gif base64 (12497 ms) and upload+URL (12584 ms) are within 1%
  of each other. Cloud Run processing time dominates for large files; the
  upload round-trip is negligible.

**Agent guidance:** If you are choosing between base64 and upload for a file,
check the benchmark Phase 2 table. For files ≥ 4 MB, always use `POST /upload`
first — not for speed, but because a 6+ MB JSON payload will likely be rejected
by your MCP client before it ever reaches the server.

---

## Fixtures

| File | Size | Frames | Canvas | Used in |
|------|------|--------|--------|---------|
| `fixtures/smol.gif` | 221 KB | 6 | 498 × 413 | Phase 1 + Phase 2 |
| `fixtures/beeg.gif` | 4.7 MB | 126 | 374 × 211 | Phase 2 only |

---

## How to Run

### Prerequisites

- `curl` and `python3` available in `$PATH`
- A valid Bearer token (obtain via the OAuth flow at  
  `https://mcp.clawstudiouo.com/oauth/authorize`)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/LAXY9887/Game-Dev.-Spritesheet-Forge.git
cd "Game-Dev.-Spritesheet-Forge"

# 2. Set your token
export SPRITESHEET_TOKEN="your_bearer_token_here"

# 3. Run
bash benchmark/run.sh
```

To test against a self-hosted instance:

```bash
export SPRITESHEET_BASE_URL="https://your-worker.workers.dev"
export SPRITESHEET_TOKEN="your_token"
bash benchmark/run.sh
```

Results are automatically saved to `benchmark/results/YYYY-MM-DD.txt`.

---

## Results — 2026-05-05

A committed reference run is available in [`sample/2026-05-05.txt`](sample/2026-05-05.txt).
Output URLs have expired (1-hour TTL) and are included for format reference only.
The sample covers 11 tests (7 Phase 1 + 4 Phase 2).

### Phase 1 — Tool Coverage

| Tool | Time |
|------|-----:|
| `gif_to_spritesheet` | 3580 ms |
| `gif_to_frames` | 3092 ms |
| `split_spritesheet` (3×2, frames + atlas JSON) | 6362 ms |
| `spritesheet_to_animation` (3×2 → animated GIF) | 3236 ms |
| `trim_png` | 2872 ms |
| `png_to_spritesheet` (2-image horizontal) | 3732 ms |
| `frames_to_animation` (2 frames → GIF) | 4408 ms |

### Phase 2 — Upload vs Base64 Efficiency

| Method | Fixture | Upload | Tool call | Total |
|--------|---------|-------:|----------:|------:|
| Direct base64 | smol.gif 221 KB | — | 3182 ms | **3182 ms** |
| Upload + URL | smol.gif 221 KB | 597 ms | 2832 ms | **3429 ms** |
| Direct base64 | beeg.gif 4.7 MB | — | 12497 ms | **12497 ms** |
| Upload + URL | beeg.gif 4.7 MB | 1908 ms | 10676 ms | **12584 ms** |

> beeg.gif base64 and upload+URL are within 1% of each other — both dominated by Cloud Run processing 126 frames. The upload overhead (~1908 ms) is absorbed by faster tool-call time (payload is a short URL instead of 6.3 MB of JSON).

### Full console output

```
spritesheet-forge-mcp Benchmark
Endpoint : https://mcp.clawstudiouo.com
Date     : 2026-05-05 02:37 UTC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Preparing fixtures...
  smol.gif  encoded  (302714 bytes as data URI)
  beeg.gif  ready    (upload-only, >4 MB)

Phase 1 — Tool Coverage  (smol.gif · 221 KB · 6 frames · 498×413)
───────────────────────────────────────────────────────────────────────────
  ✓ gif_to_spritesheet                                  3580ms
  ✓ gif_to_frames                                       3092ms
  ✓ split_spritesheet  (3×2, frames+atlas JSON)         6362ms
  ✓ spritesheet_to_animation  (3×2 → animated gif)     3236ms
  ✓ trim_png                                            2872ms
  ✓ png_to_spritesheet  (2-image horizontal)            3732ms
  ✓ frames_to_animation  (2 frames → gif)               4408ms

Phase 2 — Upload vs Base64 Efficiency
───────────────────────────────────────────────────────────────────────────
  ✓ smol.gif 221 KB — direct base64                    3182ms
    ↑ uploaded in 597ms
  ✓ smol.gif 221 KB — upload(597ms) + URL              3429ms
  ✓ beeg.gif 4.7 MB — direct base64                   12497ms
    ↑ uploaded in 1908ms
  ✓ beeg.gif 4.7 MB — upload(1908ms) + URL            12584ms

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALL PASSED  Passed: 11  Failed: 0  Total: 11
```

---

## Interpreting Results

### Tool latency breakdown

Each tool call involves three stages:

1. **Input resolution** — base64 decode *or* R2 direct read (for own-domain URLs)
2. **Cloud Run processing** — the actual image operation (dominant cost)
3. **R2 upload** — storing the output and returning a URL

Network latency to Cloudflare's edge is typically 10–50 ms and is included in
all measurements.

### Upload vs base64

For small files (< 4 MB), **direct base64** wins on total latency because it
avoids a separate upload round-trip. The tradeoff is a slightly larger
JSON-RPC payload (221 KB × 4/3 ≈ 295 KB for smol.gif), which is well within
any client limit.

For large files (≥ 4 MB), **the constraint is payload size, not latency.**
The Phase 2 benchmark shows beeg.gif base64 (12497 ms) and upload+URL
(12584 ms) are within 1% of each other — Cloud Run processing 126 frames
dominates in both cases. The reason to use upload+URL is that a 4.7 MB file
encodes to a **~6.3 MB JSON-RPC payload**, which most MCP clients will reject
or truncate before the request ever reaches the server.

**Decision rule for agents:** file < 4 MB → base64; file ≥ 4 MB → `POST /upload` first.

### Chained tool calls

When the output URL of one tool is passed as input to the next, the server
reads the file **directly from R2** without making an HTTP request. This makes
chained workflows (e.g. `gif_to_spritesheet` → `spritesheet_to_animation`)
faster than passing external URLs.

---

## Output Expiry

All output files (tool results and uploads) expire **1 hour** after creation.
The URLs in saved result files will be unreachable after that window. Re-run
the benchmark to generate fresh URLs.
