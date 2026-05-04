# Spritesheet Forge MCP

A remote [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for game-dev spritesheet workflows. Connect it to Claude or any MCP-compatible client to pack, split, trim, and animate sprites through natural language.

**Hosted at:** `https://mcp.clawstudiouo.com`

---

## Quick Start

### Claude Desktop

Add this to your `claude_desktop_config.json`:

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

On first use, Claude will open a GitHub login page to authorize access.

### Claude Code (CLI)

```bash
claude mcp add spritesheet-forge --transport http https://mcp.clawstudiouo.com/mcp
```

---

## Authentication

Spritesheet Forge uses **GitHub OAuth 2.1** (PKCE). No API keys to manage — just log in with your GitHub account. Your session is stored server-side and persists across requests.

---

## Available Tools

### PNG Tools

#### `png_to_spritesheet`
Merge multiple PNG files into a single spritesheet.

| Parameter | Type | Description |
|-----------|------|-------------|
| `files` | `string[]` | **Required.** PNG files as HTTPS URLs or base64 data URIs |
| `layout` | `string` | `grid` \| `horizontal` \| `vertical` \| `packed`. Default: `grid` |
| `columns` | `integer` | Grid columns. Auto-calculated if omitted |
| `cell_mode` | `string` | `auto_max` \| `auto_uniform` \| `fixed`. Default: `auto_max` |
| `cell_width` | `integer` | Required when `cell_mode=fixed` |
| `cell_height` | `integer` | Required when `cell_mode=fixed` |
| `fit_mode` | `string` | `scale_fit` \| `scale_fill` \| `error` |
| `align` | `string` | `center` \| `top_left` |
| `padding` | `integer` | Pixel gap between frames |
| `bg_color` | `string` | `"transparent"` or hex `"#RRGGBB"` |
| `power_of_2` | `boolean` | Pad output dimensions to next power of 2 |
| `file_name_order` | `boolean` | Sort by `_N` filename suffix |
| `trim_input` | `boolean` | Auto-trim transparent edges before compositing |
| `extrude` | `integer` | Extrude outermost pixels by N px per frame |
| `metadata_format` | `string` | `none` \| `json_array` \| `json_hash` \| `css`. Required (non-none) when `layout=packed` |

---

#### `split_spritesheet`
Slice a spritesheet PNG into individual frames, generate atlas JSON, or both.

| Parameter | Type | Description |
|-----------|------|-------------|
| `file` | `string` | **Required.** Spritesheet PNG as HTTPS URL or base64 data URI |
| `columns` | `integer` | Grid columns (grid mode) |
| `rows` | `integer` | Grid rows (grid mode) |
| `cell_width` | `integer` | Cell width in px (cell mode) |
| `cell_height` | `integer` | Cell height in px (cell mode) |
| `padding` | `integer` | Pixel gap between cells |
| `frame_count` | `integer` | Actual frame count for incomplete last row |
| `column_range` | `string` | e.g. `"0-5"` or `"2"` |
| `row_range` | `string` | e.g. `"0-3"` |
| `skip_empty` | `boolean` | Remove fully transparent frames. Default: `true` |
| `trim_top/right/bottom/left` | `integer` | Per-edge trim offsets |
| `output` | `string` | `frames` \| `metadata` \| `both`. Default: `frames` |
| `metadata_format` | `string` | `json_array` \| `json_hash` \| `css` |

---

#### `trim_png`
Crop transparent edges from one or more PNG files. Single file returns a PNG; multiple files return a ZIP.

| Parameter | Type | Description |
|-----------|------|-------------|
| `files` | `string[]` | **Required.** PNG files as HTTPS URLs or base64 data URIs |
| `threshold` | `integer` | Alpha threshold 0–255. Pixels ≤ threshold are trimmed. Default: `0` |
| `padding` | `integer` | Transparent margin to preserve around content. Default: `0` |

---

### GIF Tools

#### `gif_to_spritesheet`
Convert a GIF animation into a spritesheet PNG with all frames in a grid.

| Parameter | Type | Description |
|-----------|------|-------------|
| `file` | `string` | **Required.** GIF as HTTPS URL or base64 data URI |
| `columns` | `integer` | Grid columns. Auto-calculated if omitted |
| `padding` | `integer` | Pixel gap between frames. Default: `0` |
| `remove_bg` | `boolean` | Remove background from each frame. Default: `false` |
| `bg_color` | `string` | `"auto"` or hex `"#RRGGBB"`. Default: `"auto"` |
| `tolerance` | `integer` | Background removal threshold 0–255. Default: `30` |

---

#### `gif_to_frames`
Extract all frames from a GIF and return them as individual PNGs in a ZIP archive.

| Parameter | Type | Description |
|-----------|------|-------------|
| `file` | `string` | **Required.** GIF as HTTPS URL or base64 data URI |
| `remove_bg` | `boolean` | Remove background from each frame. Default: `false` |
| `bg_color` | `string` | `"auto"` or hex `"#RRGGBB"` |
| `tolerance` | `integer` | Background removal threshold 0–255. Default: `30` |

---

#### `frames_to_animation`
Assemble multiple PNG files into an animated GIF or animated WebP.

| Parameter | Type | Description |
|-----------|------|-------------|
| `files` | `string[]` | **Required.** PNG frames as HTTPS URLs or base64 data URIs |
| `duration` | `integer` | Frame duration in ms (10–10000). Default: `100` |
| `loop` | `integer` | Loop count. `0` = infinite. Default: `0` |
| `file_name_order` | `boolean` | Sort by `_N` filename suffix. Default: `false` |
| `resize` | `string` | Dimension mismatch handling: `error` \| `fill` \| `transparent`. Default: `transparent` |
| `bg_fill_color` | `string` | Fill color for `resize=fill`. Hex `#RRGGBB`. Default: `#000000` |
| `output_format` | `string` | `gif` \| `webp`. Default: `gif` |
| `quality` | `integer` | WebP lossy quality 0–100. Default: `80` |
| `lossless` | `boolean` | WebP lossless mode. Default: `false` |

---

#### `spritesheet_to_animation`
Slice a spritesheet PNG into frames and produce an animated GIF or WebP.

| Parameter | Type | Description |
|-----------|------|-------------|
| `file` | `string` | **Required.** Spritesheet PNG as HTTPS URL or base64 data URI |
| `columns` | `integer` | Grid columns (grid mode) |
| `rows` | `integer` | Grid rows (grid mode) |
| `cell_width` | `integer` | Cell width in px (cell mode) |
| `cell_height` | `integer` | Cell height in px (cell mode) |
| `frame_count` | `integer` | Actual frame count for incomplete last row |
| `padding` | `integer` | Pixel gap between cells. Default: `0` |
| `column_range` | `string` | e.g. `"0-5"` |
| `row_range` | `string` | e.g. `"0-3"` |
| `skip_empty` | `boolean` | Auto-remove fully transparent frames. Default: `true` |
| `trim_top/right/bottom/left` | `integer` | Per-edge trim offsets |
| `duration` | `integer` | Frame duration in ms. Default: `100` |
| `loop` | `integer` | Loop count. `0` = infinite. Default: `0` |
| `output_format` | `string` | `gif` \| `webp`. Default: `gif` |
| `quality` | `integer` | WebP quality 0–100. Default: `80` |
| `lossless` | `boolean` | WebP lossless. Default: `false` |

---

## File Inputs

All `file` / `files` parameters accept:

- **HTTPS URL** — e.g. `https://example.com/sprite.png` (must be publicly accessible)
- **Base64 data URI** — e.g. `data:image/png;base64,iVBORw0KGgo...`

---

## Output

Every tool returns a JSON object:

```json
{
  "url": "https://mcp.clawstudiouo.com/output/<key>",
  "expires_at": "2026-05-05T12:00:00.000Z",
  "content_type": "image/png",
  "size_bytes": 48392,
  "quota": {
    "used": 3,
    "limit": 100,
    "resets_at": "2026-06-01"
  }
}
```

Output files are stored for **24 hours** and then automatically deleted.

---

## Quota

Free tier: **100 operations per month** per GitHub account. Quota resets on the 1st of each month.

---

## License

MIT
