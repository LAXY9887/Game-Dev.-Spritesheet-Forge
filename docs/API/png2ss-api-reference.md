# Easy PNG to Sprites — API Reference

Merge multiple PNG files into a single spritesheet in one API call. Supports grid, horizontal, vertical, and bin-packed layouts with optional TexturePacker-compatible JSON metadata — ready for Phaser 3, PixiJS, Unity, and Godot.

> **Note:** The RapidAPI testing playground does not support uploading multiple files to the same form field (`files`). Please test directly using `curl` or your preferred HTTP client. See the examples below for ready-to-use snippets.

---

## Quick Start

```bash
curl -X POST 'https://easy-png-to-sprites.p.rapidapi.com/to-spritesheet' \
  -H 'x-rapidapi-host: easy-png-to-sprites.p.rapidapi.com' \
  -H 'x-rapidapi-key: YOUR_RAPIDAPI_KEY' \
  -F 'files=@frame_0.png' \
  -F 'files=@frame_1.png' \
  -F 'files=@frame_2.png' \
  -o spritesheet.png
```

That's it — you get back a single PNG spritesheet. Read on for layout options, metadata output, and advanced parameters.

---

## Authentication

All requests must include these two headers (provided by your RapidAPI subscription):

| Header | Description |
|---|---|
| `x-rapidapi-host` | `easy-png-to-sprites.p.rapidapi.com` |
| `x-rapidapi-key` | Your RapidAPI subscription key |

Missing or invalid keys return `403 Forbidden` from the RapidAPI gateway.

---

## Endpoints at a glance

| Method | Path | Purpose |
|---|---|---|
| `GET` | [`/health`](#health) | Liveness probe (no auth required). |
| `POST` | [`/to-spritesheet`](#post-to-spritesheet) | Merge multiple PNG files into a single spritesheet. |
| `POST` | [`/split-spritesheet`](#post-split-spritesheet) | Slice a spritesheet PNG into individual frames and/or generate atlas JSON. |
| `POST` | [`/trim`](#post-trim) | Crop transparent edges from one or more PNG files. |

---

## `GET /health`

Returns `{"status": "ok"}` — useful for uptime checks and deployment health probes.

---

## `POST /to-spritesheet`

Merge an ordered list of PNG files into a single spritesheet.

**Content-Type:** `multipart/form-data`

---

## Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `files` | file[] | **yes** | — | One or more PNG files. Upload order determines frame order (unless `file_name_order=true`). |
| `layout` | string | no | `grid` | How frames are arranged: `grid`, `horizontal`, `vertical`, or `packed`. |
| `columns` | int | no | auto | Number of columns in the grid. Auto = `ceil(sqrt(N))`. Only used when `layout=grid`. |
| `cell_mode` | string | no | `auto_max` | How cell size is determined: `auto_max`, `auto_uniform`, or `fixed`. |
| `cell_width` | int | no | — | Cell width in pixels. **Required** when `cell_mode=fixed`. |
| `cell_height` | int | no | — | Cell height in pixels. **Required** when `cell_mode=fixed`. |
| `fit_mode` | string | no | `scale_fit` | What to do when an image is larger than the cell: `scale_fit` (letterbox), `scale_fill` (crop to fill), or `error` (reject). Only applies when `cell_mode=fixed`. |
| `align` | string | no | `center` | Alignment when an image is smaller than the cell: `top_left` or `center`. |
| `padding` | int | no | `0` | Pixel gap between frames. |
| `bg_color` | string | no | `transparent` | Background color: `transparent` or a hex color like `#000000`. |
| `power_of_2` | bool | no | `false` | Pad the output width and height to the next power of 2 (e.g. 300 → 512). Useful for GPU textures. |
| `file_name_order` | bool | no | `false` | Sort frames by the `_N` numeric suffix in filenames (e.g. `frame_2.png` before `frame_10.png`) instead of upload order. |
| `trim_input` | bool | no | `false` | Auto-trim transparent edges from each input PNG before compositing. Useful for assets exported with extra padding. |
| `extrude` | int | no | `0` | Duplicate the outermost row/column of pixels outward by N pixels on all sides of each frame. Prevents texture bleeding in WebGL bilinear filtering. Pair with `padding=N` to reserve space. |
| `metadata_format` | string | no | `none` | Output format for frame metadata. `none` returns a plain PNG. `json_array` / `json_hash` / `css` return a ZIP with the PNG plus a metadata file. **Required** non-`none` when `layout=packed`. |

### Parameter details

**`cell_mode` explained:**

| Value | Behavior |
|---|---|
| `auto_max` | Cell size = largest width × largest height across all inputs. Smaller images are aligned within the cell. |
| `auto_uniform` | All inputs must be the same size (returns `422` if they differ). Cell size = that size. |
| `fixed` | You specify `cell_width` and `cell_height`. Images larger than the cell are handled by `fit_mode`; smaller ones are positioned by `align`. |

**`layout=packed` special behavior:**

When using `packed`, each frame keeps its **original dimensions** — no cell unification, no scaling. The following parameters are ignored: `cell_mode`, `cell_width`, `cell_height`, `fit_mode`, `align`. You **must** set `metadata_format=json_array` because the frame positions are irregular and unusable without metadata.

---

## Choosing a Layout

| Use case | Recommended setup |
|---|---|
| **Animation frames** (walk cycle, explosions) | `layout=grid` (default) — frames tile perfectly |
| **Sprite strip** (single row or column) | `layout=horizontal` or `layout=vertical` |
| **Texture atlas** (mixed-size icons, UI elements) | `layout=packed` + `metadata_format=json_array` |
| **Tilemap grid** (Unity / Godot) | `layout=grid` + `cell_mode=fixed` + `cell_width` + `cell_height` |
| **GPU-ready texture** | Add `power_of_2=true` to any of the above |

**Density tip:** For same-size frames, `grid` is always best (~96% fill). For mixed sizes, `packed` is ~2× denser than `grid`.

---

## Limits

| Limit | Value |
|---|---|
| Max files per request | 100 |
| Max file size | 5 MB |
| Max total upload | 60 MB |
| Accepted format | PNG only |

---

## Response

### When `metadata_format=none` (default)

Returns the spritesheet as a raw PNG binary.

| Status | Content-Type | Body |
|---|---|---|
| `200` | `image/png` | Spritesheet PNG |

### When metadata is requested

Returns a ZIP archive containing the spritesheet PNG plus a metadata file. The metadata filename inside the ZIP depends on the format:

| `metadata_format` | ZIP contents | Metadata file in ZIP |
|---|---|---|
| `json_array` | `spritesheet.png` + metadata | `spritesheet-array.json` |
| `json_hash` | `spritesheet.png` + metadata | `spritesheet-hash.json` |
| `css` | `spritesheet.png` + metadata | `spritesheet.css` |

| Status | Content-Type | Body |
|---|---|---|
| `200` | `application/zip` | ZIP with PNG + metadata file |

### Errors

| Status | Meaning | Example |
|---|---|---|
| `403` | Invalid or missing RapidAPI key | (returned by RapidAPI gateway) |
| `413` | File count or total size exceeded | `{"detail": "Too many files. Maximum is 100."}` |
| `422` | Validation error | `{"detail": "cell_mode=fixed requires both cell_width and cell_height."}` |
| `422` | Invalid PNG | `{"detail": "Invalid PNG: broken_file.png"}` |
| `422` | Packed without metadata | `{"detail": "layout=packed requires metadata_format != 'none' (positions are irregular)."}` |

---

## Metadata Schema (`spritesheet.json`)

When `metadata_format=json_array`, the ZIP includes a JSON file compatible with **Phaser 3** (`load.atlas`) and **PixiJS** (`Assets.load`) out of the box.

```json
{
  "frames": [
    {
      "filename": "frame_0.png",
      "frame":            { "x": 0, "y": 0, "w": 112, "h": 112 },
      "rotated":          false,
      "trimmed":          false,
      "spriteSourceSize": { "x": 0, "y": 0, "w": 112, "h": 112 },
      "sourceSize":       { "w": 112, "h": 112 }
    },
    {
      "filename": "frame_1.png",
      "frame":            { "x": 112, "y": 0, "w": 112, "h": 112 },
      "rotated":          false,
      "trimmed":          false,
      "spriteSourceSize": { "x": 0, "y": 0, "w": 112, "h": 112 },
      "sourceSize":       { "w": 112, "h": 112 }
    }
  ],
  "meta": {
    "app":     "PNG2Spritesheet",
    "version": "1.0",
    "image":   "spritesheet.png",
    "format":  "RGBA8888",
    "size":    { "w": 336, "h": 112 },
    "scale":   "1"
  }
}
```

**Field reference:**

| Field | Description |
|---|---|
| `frame.x/y/w/h` | Position and size of this frame on the spritesheet canvas |
| `sourceSize.w/h` | Original dimensions of the uploaded PNG |
| `spriteSourceSize` | How the image is placed within its cell |
| `rotated` | Always `false` (rotation not supported in v1) |
| `trimmed` | Always `false` (auto-trim not supported in v1) |
| `meta.size` | Total canvas dimensions (matches the PNG output size) |
| `meta.format` | Always `RGBA8888` |

---

## Examples

### 1. Basic grid spritesheet (returns PNG)

```bash
curl -X POST 'https://easy-png-to-sprites.p.rapidapi.com/to-spritesheet' \
  -H 'x-rapidapi-host: easy-png-to-sprites.p.rapidapi.com' \
  -H 'x-rapidapi-key: YOUR_RAPIDAPI_KEY' \
  -F 'files=@frame_0.png' \
  -F 'files=@frame_1.png' \
  -F 'files=@frame_2.png' \
  -F 'files=@frame_3.png' \
  -o spritesheet.png
```

### 2. Horizontal strip

```bash
curl -X POST 'https://easy-png-to-sprites.p.rapidapi.com/to-spritesheet' \
  -H 'x-rapidapi-host: easy-png-to-sprites.p.rapidapi.com' \
  -H 'x-rapidapi-key: YOUR_RAPIDAPI_KEY' \
  -F 'files=@frame_0.png' \
  -F 'files=@frame_1.png' \
  -F 'files=@frame_2.png' \
  -F 'layout=horizontal' \
  -o strip.png
```

### 3. Grid with JSON metadata (returns ZIP)

```bash
curl -X POST 'https://easy-png-to-sprites.p.rapidapi.com/to-spritesheet' \
  -H 'x-rapidapi-host: easy-png-to-sprites.p.rapidapi.com' \
  -H 'x-rapidapi-key: YOUR_RAPIDAPI_KEY' \
  -F 'files=@frame_0.png' \
  -F 'files=@frame_1.png' \
  -F 'files=@frame_2.png' \
  -F 'metadata_format=json_array' \
  -F 'file_name_order=true' \
  -o spritesheet.zip
```

Unzip to get `spritesheet.png` + `spritesheet.json`.

### 4. Fixed cell size with padding (for tilemaps)

```bash
curl -X POST 'https://easy-png-to-sprites.p.rapidapi.com/to-spritesheet' \
  -H 'x-rapidapi-host: easy-png-to-sprites.p.rapidapi.com' \
  -H 'x-rapidapi-key: YOUR_RAPIDAPI_KEY' \
  -F 'files=@tile_0.png' \
  -F 'files=@tile_1.png' \
  -F 'files=@tile_2.png' \
  -F 'cell_mode=fixed' -F 'cell_width=64' -F 'cell_height=64' \
  -F 'padding=2' \
  -o tileset.png
```

### 5. GPU texture atlas (bin-packed, power-of-2, black background)

```bash
curl -X POST 'https://easy-png-to-sprites.p.rapidapi.com/to-spritesheet' \
  -H 'x-rapidapi-host: easy-png-to-sprites.p.rapidapi.com' \
  -H 'x-rapidapi-key: YOUR_RAPIDAPI_KEY' \
  -F 'files=@icon_sword.png' \
  -F 'files=@icon_shield.png' \
  -F 'files=@icon_potion.png' \
  -F 'layout=packed' \
  -F 'metadata_format=json_array' \
  -F 'power_of_2=true' \
  -F 'bg_color=#000000' \
  -o atlas.zip
```

### 6. Using the JSON metadata in Phaser 3

```javascript
// After downloading and extracting atlas.zip:
this.load.atlas('items', 'spritesheet.png', 'spritesheet.json');

// Then use any frame by filename:
this.add.sprite(400, 300, 'items', 'icon_sword.png');
```

### 7. Using the JSON metadata in PixiJS

```javascript
await PIXI.Assets.load('spritesheet.json');
const sprite = PIXI.Sprite.from('icon_sword.png');
app.stage.addChild(sprite);
```

---

---

## `POST /split-spritesheet`

Slice a spritesheet PNG back into individual frames, generate TexturePacker-compatible atlas JSON, or both. This is the reverse of `/to-spritesheet`.

**Content-Type:** `multipart/form-data`

### Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `file` | file | Yes | — | Single spritesheet PNG. Max 20 MB. |
| `columns` | int | Grid mode | — | Grid columns. Min 1. Provide with `rows`. |
| `rows` | int | Grid mode | — | Grid rows. Min 1. Provide with `columns`. |
| `cell_width` | int | Cell mode | — | Cell width in px. Min 1. Provide with `cell_height`. |
| `cell_height` | int | Cell mode | — | Cell height in px. Min 1. Provide with `cell_width`. |
| `padding` | int | No | `0` | Pixel gap between cells in the source spritesheet. |
| `frame_count` | int | No | auto | Truncate to the first N frames after range filtering. Min 1. |
| `column_range` | string | No | all | Columns to extract, e.g. `"0-5"` or `"2"`. 0-indexed. |
| `row_range` | string | No | all | Rows to extract. 0-indexed. |
| `skip_empty` | bool | No | `true` | Remove fully transparent cells from output. |
| `trim_top` | int | No | `0` | Crop px from top of spritesheet before slicing. |
| `trim_right` | int | No | `0` | Crop px from right. |
| `trim_bottom` | int | No | `0` | Crop px from bottom. |
| `trim_left` | int | No | `0` | Crop px from left. |
| `output` | string | No | `frames` | `frames` / `metadata` / `both`. Controls response shape. |
| `metadata_format` | string | No | `json_array` | Atlas format: `json_array` / `json_hash` / `css`. Ignored when `output=frames`. |

**Slicing mode:** Provide (`columns` + `rows`) **or** (`cell_width` + `cell_height`). Cannot mix. One pair is required.

### Response

| `output` | Content-Type | Body |
|---|---|---|
| `frames` (default) | `application/zip` | ZIP of `frame_0.png`, `frame_1.png`, … |
| `metadata` | `application/json` or `text/css` | Standalone atlas file (no PNG extraction) |
| `both` | `application/zip` | ZIP of all frame PNGs + atlas file |

Frame filenames are zero-padded by total frame count: 1–9 frames → `frame_0`, 10–99 → `frame_00`, 100–999 → `frame_000`.

**Standalone atlas filenames** (when `output=metadata`):

| `metadata_format` | Standalone filename |
|---|---|
| `json_array` | `atlas-array.json` |
| `json_hash` | `atlas-hash.json` |
| `css` | `atlas.css` |

**Atlas filenames inside ZIP** (when `output=both`):

| `metadata_format` | Filename in ZIP |
|---|---|
| `json_array` | `spritesheet-array.json` |
| `json_hash` | `spritesheet-hash.json` |
| `css` | `spritesheet.css` |

> **CSS caveat:** The generated `.css` file contains `background-image: url('spritesheet.png')` hardcoded. After downloading, replace this with your actual hosted spritesheet URL.

### curl examples

**Split into frames (returns ZIP):**

```bash
curl -X POST 'https://easy-png-to-sprites.p.rapidapi.com/split-spritesheet' \
  -H 'x-rapidapi-host: easy-png-to-sprites.p.rapidapi.com' \
  -H 'x-rapidapi-key: YOUR_RAPIDAPI_KEY' \
  -F 'file=@spritesheet.png' \
  -F 'columns=4' \
  -F 'rows=3' \
  -o frames.zip
```

**Generate atlas JSON only (no frame extraction):**

```bash
curl -X POST 'https://easy-png-to-sprites.p.rapidapi.com/split-spritesheet' \
  -H 'x-rapidapi-host: easy-png-to-sprites.p.rapidapi.com' \
  -H 'x-rapidapi-key: YOUR_RAPIDAPI_KEY' \
  -F 'file=@spritesheet.png' \
  -F 'columns=4' \
  -F 'rows=3' \
  -F 'output=metadata' \
  -o atlas.json
```

**Both frames and atlas JSON in one ZIP:**

```bash
curl -X POST 'https://easy-png-to-sprites.p.rapidapi.com/split-spritesheet' \
  -H 'x-rapidapi-host: easy-png-to-sprites.p.rapidapi.com' \
  -H 'x-rapidapi-key: YOUR_RAPIDAPI_KEY' \
  -F 'file=@spritesheet.png' \
  -F 'columns=4' \
  -F 'rows=3' \
  -F 'output=both' \
  -o split.zip
```

---

## `POST /trim`

Crop transparent edges from one or more PNG files. Single upload returns `image/png`; multiple uploads return `application/zip`.

**Content-Type:** `multipart/form-data`

### Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `files` | file[] | **yes** | — | One or more PNG files. Max 100 files, 5 MB each, 60 MB total. |
| `threshold` | int | no | `0` | Alpha threshold (0-255). Pixels with alpha ≤ threshold are treated as empty and trimmed. |
| `padding` | int | no | `0` | Pixels of transparent margin to preserve around the trimmed content. |

### Responses

| Condition | Status | Content-Type | Body |
|---|---|---|---|
| Exactly one file uploaded | `200` | `image/png` | Trimmed PNG binary |
| Multiple files uploaded | `200` | `application/zip` | ZIP of trimmed PNGs with original filenames |
| Image is fully empty | `422` | `application/json` | `{"detail": "Cannot trim fully empty image: <filename>"}` |
| Validation / auth / size errors | `401 / 413 / 422` | `application/json` | `{"detail": "..."}` |

### Examples

**Single file (returns PNG):**

```bash
curl -X POST 'https://easy-png-to-sprites.p.rapidapi.com/trim' \
  -H 'x-rapidapi-host: easy-png-to-sprites.p.rapidapi.com' \
  -H 'x-rapidapi-key: YOUR_RAPIDAPI_KEY' \
  -F 'files=@hero.png' \
  -o hero-trimmed.png
```

**Multiple files (returns ZIP):**

```bash
curl -X POST 'https://easy-png-to-sprites.p.rapidapi.com/trim' \
  -H 'x-rapidapi-host: easy-png-to-sprites.p.rapidapi.com' \
  -H 'x-rapidapi-key: YOUR_RAPIDAPI_KEY' \
  -F 'files=@frame_0.png' \
  -F 'files=@frame_1.png' \
  -F 'files=@frame_2.png' \
  -F 'padding=2' \
  -o trimmed.zip
```

With `padding=2`, each output PNG has a 2-pixel transparent margin around its trimmed content.

**Scope:** MVP trims by alpha only. Solid-color background detection is not in scope for this endpoint.

---

## FAQ

**Q: What image formats are supported?**
PNG only. All inputs must be valid PNG files (magic-byte validated before processing).

**Q: What happens if my frames are different sizes?**
With the default `cell_mode=auto_max`, each cell is sized to the largest frame's dimensions. Smaller frames are centered (or top-left aligned with `align=top_left`). For mixed-size inputs, consider `layout=packed` which keeps each frame at its original size.

**Q: Can I control the frame order?**
By default, frames are ordered by upload sequence. Set `file_name_order=true` to sort by the `_N` numeric suffix in filenames (e.g. `frame_1.png`, `frame_2.png`, `frame_10.png` — natural sort, not alphabetical).

**Q: Why does `layout=packed` require metadata?**
Packed layout uses bin-packing to minimize canvas waste. Frame positions are irregular, so without the JSON metadata describing each frame's `x/y/w/h`, the spritesheet is unusable. The API enforces this by returning `422` if you use `packed` without `metadata_format=json_array`.

**Q: What is `power_of_2` for?**
Some GPU APIs (OpenGL, WebGL) require texture dimensions to be powers of 2 (e.g. 256, 512, 1024). Setting `power_of_2=true` pads the output canvas to the next power of 2 on each axis. The extra space is filled with `bg_color`.

**Q: Is my data stored?**
No. All processing happens in memory. Uploaded files and generated output are discarded immediately after the response is sent. Nothing is stored on disk or in any database.

**Q: Can I use this in my CI/CD pipeline?**
Absolutely. The API is stateless and deterministic — same inputs always produce the same output. Use `curl`, `httpx`, `requests`, or any HTTP client in your build scripts.

**Q: The RapidAPI testing playground doesn't work?**
The playground does not support uploading multiple files to the same field (`files`). Please test using `curl` or your HTTP client directly. The examples above are ready to copy-paste.
