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

This phase benchmarks `gif_to_spritesheet` across three combinations:

| Method | Fixture | Size | Notes |
|--------|---------|------|-------|
| Direct base64 | `smol.gif` | 221 KB | Single round-trip |
| Upload + URL | `smol.gif` | 221 KB | Two round-trips |
| Upload + URL | `beeg.gif` | 4.7 MB | Base64 not tested (>4 MB threshold) |

The **4 MB threshold** is the recommended cutover: above that size, embedding
base64 in the JSON-RPC payload adds significant overhead with no benefit over
uploading first.

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

## Sample Output

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
    ↑ uploaded in 1908ms
  ✓ beeg.gif 4.7 MB — upload(1908ms) + URL  [base64 N/A]  12584ms

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALL PASSED  Passed: 10  Failed: 0  Total: 10
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
avoids a separate upload round-trip. The tradeoff is a larger JSON-RPC payload.

For large files (≥ 4 MB), **upload + URL** is the only practical option.
Embedding a 4.7 MB file as base64 would produce a ~6.3 MB JSON payload, which
exceeds typical MCP client limits.

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
