# Easy GIF2Sprite API Reference

**Base URL:** `https://easy-gif-to-sprites.p.rapidapi.com`

All requests must include the standard RapidAPI authentication headers:

```
X-RapidAPI-Key: YOUR_API_KEY
X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com
```

## Endpoints

| Method   | Path                  | Description                     |
| -------- | --------------------- | ------------------------------- |
| `POST` | `/to-spritesheet`   | GIF → single sprite sheet PNG  |
| `POST` | `/to-frames`        | GIF → individual PNGs in a ZIP |
| `POST` | `/from-frames`      | Multiple PNGs → animated GIF   |
| `POST` | `/from-spritesheet` | SpriteSheet PNG → animated GIF |
| `GET`  | `/health`           | Service health check            |

---

## ⚠️ NOTICE

End point `/from-frames` can NOT be test on RapidAPI console, due to the single file upload limitation. You should test this end point on your PC.

---

## POST /to-spritesheet

Converts a GIF animation into a single PNG sprite sheet with all frames arranged in a grid.

### Request

**Content-Type:** `multipart/form-data`

| Parameter     | Type    | Required                | Default    | Description                                                                                                                                                       |
| ------------- | ------- | ----------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file`      | file    | One of `file`/`url` | —         | GIF file to upload                                                                                                                                                |
| `url`       | string  | One of `file`/`url` | —         | Publicly accessible URL of a GIF file                                                                                                                             |
| `columns`   | integer | No                      | auto       | Number of columns in the grid. If omitted, calculated as `ceil(sqrt(frame_count))` to produce the closest-to-square layout. Minimum: `1`.                     |
| `padding`   | integer | No                      | `0`      | Pixel gap between frames. Minimum:`0`.                                                                                                                          |
| `remove_bg` | boolean | No                      | `false`  | Remove background from each frame before compositing.                                                                                                             |
| `bg_color`  | string  | No                      | `"auto"` | Background color to remove.`"auto"` samples the four corner pixels of each frame. Or specify a hex color, e.g. `"#FFFFFF"`. Ignored when `remove_bg=false`. |
| `tolerance` | integer | No                      | `30`     | Color distance threshold for background removal (0–255). Higher values remove more of the background. Ignored when `remove_bg=false`.                          |

`file` and `url` are mutually exclusive. Providing both or neither returns a `400` error.

### Response

| Status     | Content-Type         | Body                                |
| ---------- | -------------------- | ----------------------------------- |
| `200 OK` | `image/png`        | Raw PNG binary                      |
| `400`    | `application/json` | See[Error Responses](#error-responses) |
| `413`    | `application/json` | Input exceeds 20 MB                 |
| `422`    | `application/json` | Invalid parameter value             |
| `500`    | `application/json` | Internal processing error           |

### Examples

**Basic — file upload:**

```bash
curl -X POST https://easy-gif-to-sprites.p.rapidapi.com/to-spritesheet \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com" \
  -F "file=@animation.gif" \
  --output spritesheet.png
```

**Custom grid layout:**

```bash
curl -X POST https://easy-gif-to-sprites.p.rapidapi.com/to-spritesheet \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com" \
  -F "file=@animation.gif" \
  -F "columns=4" \
  -F "padding=8" \
  --output spritesheet.png
```

**From URL:**

```bash
curl -X POST https://easy-gif-to-sprites.p.rapidapi.com/to-spritesheet \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com" \
  -F "url=https://example.com/animation.gif" \
  --output spritesheet.png
```

**Background removal — auto-detect:**

```bash
curl -X POST https://easy-gif-to-sprites.p.rapidapi.com/to-spritesheet \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com" \
  -F "file=@animation.gif" \
  -F "remove_bg=true" \
  --output spritesheet.png
```

**Background removal — specified color:**

```bash
curl -X POST https://easy-gif-to-sprites.p.rapidapi.com/to-spritesheet \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com" \
  -F "file=@animation.gif" \
  -F "remove_bg=true" \
  -F "bg_color=#FFFFFF" \
  -F "tolerance=40" \
  --output spritesheet.png
```

---

## POST /to-frames

Extracts all frames from a GIF and returns them as individual PNGs inside a ZIP archive.

⚠️ NOTICE: A ZIP file output can not be shown or downloaded by runing tests on RapidAPI.

### Request

**Content-Type:** `multipart/form-data`

| Parameter     | Type    | Required                | Default    | Description                                                                                                |
| ------------- | ------- | ----------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| `file`      | file    | One of `file`/`url` | —         | GIF file to upload                                                                                         |
| `url`       | string  | One of `file`/`url` | —         | Publicly accessible URL of a GIF file                                                                      |
| `remove_bg` | boolean | No                      | `false`  | Remove background from each frame.                                                                         |
| `bg_color`  | string  | No                      | `"auto"` | Background color to remove.`"auto"` or a hex color e.g. `"#FFFFFF"`. Ignored when `remove_bg=false`. |
| `tolerance` | integer | No                      | `30`     | Color distance threshold for background removal (0–255). Ignored when `remove_bg=false`.                |

### Response

| Status     | Content-Type         | Body                                |
| ---------- | -------------------- | ----------------------------------- |
| `200 OK` | `application/zip`  | ZIP archive                         |
| `400`    | `application/json` | See[Error Responses](#error-responses) |
| `413`    | `application/json` | Input exceeds 20 MB                 |
| `422`    | `application/json` | Invalid parameter value             |
| `500`    | `application/json` | Internal processing error           |

The ZIP contains one PNG per frame, named with zero-padded indices:

| Frame count     | File names                             |
| --------------- | -------------------------------------- |
| 1–9 frames     | `frame_0.png` – `frame_8.png`     |
| 10–99 frames   | `frame_00.png` – `frame_98.png`   |
| 100–999 frames | `frame_000.png` – `frame_998.png` |

### Examples

**Basic — file upload:**

```bash
curl -X POST https://easy-gif-to-sprites.p.rapidapi.com/to-frames \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com" \
  -F "file=@animation.gif" \
  --output frames.zip
```

**With background removal:**

```bash
curl -X POST https://easy-gif-to-sprites.p.rapidapi.com/to-frames \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com" \
  -F "file=@animation.gif" \
  -F "remove_bg=true" \
  -F "bg_color=#000000" \
  -F "tolerance=25" \
  --output frames.zip
```

---

## POST /from-frames

Assembles multiple PNG file uploads into an animated GIF.

### Request

**Content-Type:** `multipart/form-data`

| Parameter           | Type    | Required | Default           | Description                                                                |
| ------------------- | ------- | -------- | ----------------- | -------------------------------------------------------------------------- |
| `files`           | file[]  | Yes      | —                | Multiple PNG files                                                         |
| `duration`        | integer | No       | `100`           | Frame duration in milliseconds. Min:`10`, Max: `10000`.                |
| `loop`            | integer | No       | `0`             | Loop count.`0` = infinite loop.                                          |
| `file_name_order` | boolean | No       | `false`         | Sort frames by `_N` filename suffix instead of upload order.             |
| `resize`          | string  | No       | `"transparent"` | Dimension mismatch handling:`"error"`, `"fill"`, or `"transparent"`. |
| `bg_fill_color`   | string  | No       | `"#000000"`     | Fill color when `resize="fill"`. Hex `#RRGGBB`. Ignored otherwise.     |
| `output_format`   | string  | No       | `"gif"`         | Output format:`"gif"` or `"webp"` (animated WebP).                   |
| `quality`         | integer | No       | `80`            | WebP lossy quality (0–100). Ignored when `output_format="gif"` or `lossless=true`. |
| `lossless`        | boolean | No       | `false`         | WebP lossless mode. Larger file but pixel-perfect. Ignored when `output_format="gif"`. |

**No `url` parameter** — multi-file upload is file-only.

**Limits:** max 100 files, 5 MB per file, 60 MB total. PNG only.

#### Frame Ordering

- `file_name_order=false` (default): frames ordered by upload order.
- `file_name_order=true`: sorted by the numeric suffix `_N` before the file extension (e.g., `walk_0.png` → 0, `walk_12.png` → 12). Files without `_N` suffix return `400`.

#### Dimension Mismatch

- `resize="transparent"` (default): smaller frames are centered on a transparent canvas.
- `resize="fill"`: smaller frames are centered on a canvas filled with `bg_fill_color`.
- `resize="transparent"`: smaller frames are centered on a transparent canvas.

### Response

| Status     | Content-Type                           | Body                            |
| ---------- | -------------------------------------- | ------------------------------- |
| `200 OK` | `image/gif` or `image/webp`        | Raw GIF or animated WebP binary |
| `400`    | `application/json`                   | Validation error                |
| `413`    | `application/json`                   | File too large / too many files |
| `422`    | `application/json`                   | Invalid parameter value         |

Content-Type follows `output_format`: `image/gif` for `gif`, `image/webp` for `webp`.

### Examples

**Basic — multiple PNGs:**

```bash
curl -X POST https://easy-gif-to-sprites.p.rapidapi.com/from-frames \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com" \
  -F "files=@frame_01.png" \
  -F "files=@frame_02.png" \
  -F "files=@frame_03.png" \
  -F "duration=100" \
  --output animation.gif
```

**With filename ordering:**

```bash
curl -X POST https://easy-gif-to-sprites.p.rapidapi.com/from-frames \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com" \
  -F "files=@walk_2.png" \
  -F "files=@walk_0.png" \
  -F "files=@walk_1.png" \
  -F "file_name_order=true" \
  --output animation.gif
```

**With dimension mismatch handling:**

```bash
curl -X POST https://easy-gif-to-sprites.p.rapidapi.com/from-frames \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com" \
  -F "files=@small.png" \
  -F "files=@large.png" \
  -F "resize=fill" \
  -F "bg_fill_color=#FFFFFF" \
  --output animation.gif
```

**Animated WebP output:**

```bash
curl -X POST https://easy-gif-to-sprites.p.rapidapi.com/from-frames \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com" \
  -F "files=@frame_01.png" \
  -F "files=@frame_02.png" \
  -F "files=@frame_03.png" \
  -F "output_format=webp" \
  -F "quality=80" \
  --output animation.webp
```

---

## POST /from-spritesheet

Slices a SpriteSheet PNG into individual frames and produces an animated GIF.

### Request

**Content-Type:** `multipart/form-data`

| Parameter        | Type    | Required                | Default  | Description                                                                                   |
| ---------------- | ------- | ----------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `file`         | file    | One of `file`/`url` | —       | SpriteSheet PNG file                                                                          |
| `url`          | string  | One of `file`/`url` | —       | Publicly accessible URL of a SpriteSheet PNG                                                  |
| `columns`      | integer | See below               | —       | Number of columns in the grid. Min:`1`.                                                     |
| `rows`         | integer | See below               | —       | Number of rows in the grid. Min:`1`.                                                        |
| `cell_width`   | integer | See below               | —       | Width of each cell in pixels. Min:`1`.                                                      |
| `cell_height`  | integer | See below               | —       | Height of each cell in pixels. Min:`1`.                                                     |
| `frame_count`  | integer | No                      | auto     | Actual number of frames (for incomplete last row). Min:`1`.                                 |
| `padding`      | integer | No                      | `0`    | Pixel gap between cells in the spritesheet. Min:`0`.                                        |
| `column_range` | string  | No                      | all      | Column range to extract (0-indexed).`"0-5"` = columns 0 through 5. `"2"` = column 2 only. |
| `row_range`    | string  | No                      | all      | Row range to extract (0-indexed).`"0"` = first row only. `"1-3"` = rows 1 through 3.      |
| `skip_empty`   | boolean | No                      | `true` | Automatically remove fully transparent frames from the output.                                |
| `trim_top`     | integer | No                      | `0`    | Crop pixels from the top of the spritesheet before slicing. Min: `0`.                         |
| `trim_right`   | integer | No                      | `0`    | Crop pixels from the right of the spritesheet before slicing. Min: `0`.                       |
| `trim_bottom`  | integer | No                      | `0`    | Crop pixels from the bottom of the spritesheet before slicing. Min: `0`.                      |
| `trim_left`    | integer | No                      | `0`    | Crop pixels from the left of the spritesheet before slicing. Min: `0`.                        |
| `duration`     | integer | No                      | `100`  | Frame duration in milliseconds. Min:`10`, Max: `10000`.                                   |
| `loop`         | integer | No                      | `0`    | Loop count.`0` = infinite loop.                                                             |
| `output_format`| string  | No                      | `"gif"`| Output format:`"gif"` or `"webp"` (animated WebP).                                       |
| `quality`      | integer | No                      | `80`   | WebP lossy quality (0–100). Ignored when `output_format="gif"` or `lossless=true`.    |
| `lossless`     | boolean | No                      | `false`| WebP lossless mode. Larger file but pixel-perfect. Ignored when `output_format="gif"`.    |

**Slicing mode (one required):**

- **Grid mode:** `columns` + `rows` (both required)
- **Cell mode:** `cell_width` + `cell_height`

Cannot mix modes.

**How padding works:**

- Grid mode: `cell_width = (image_width - (columns-1) * padding) / columns`
- Cell mode: `columns = (image_width + padding) / (cell_width + padding)`
- Padding is the gap between cells only — not on the outer edges of the spritesheet.

**Trim (outer margins):** Use `trim_top`, `trim_right`, `trim_bottom`, `trim_left` to crop extra space around the entire spritesheet before slicing. This is applied first — before padding, range, or any other processing.

```
┌──────────────────────────────┐
│        trim_top              │  ← cropped
│  ┌────────────────────────┐  │
│  │  cell │ pad │ cell     │  │
│t │  ─────┼─────┼─────     │ t│
│r │  cell │ pad │ cell     │ r│
│i │                        │ i│
│m │    actual grid area    │ m│
│_ │                        │ _│
│l │                        │ r│
│  └────────────────────────┘  │
│        trim_bottom           │  ← cropped
└──────────────────────────────┘
```

**Range selection:** Use `column_range` and `row_range` to extract a sub-region of the spritesheet. For example, `column_range="0-5"` + `row_range="0"` extracts only the first 6 cells of row 0. Processing order: range → frame_count → skip_empty.

**Transparency:** Transparent regions in the source PNG are preserved as GIF transparency in the output.

### Response

| Status     | Content-Type                       | Body                            |
| ---------- | ---------------------------------- | ------------------------------- |
| `200 OK` | `image/gif` or `image/webp`    | Raw GIF or animated WebP binary |
| `400`    | `application/json`               | Validation error                |
| `413`    | `application/json`               | File too large                  |
| `422`    | `application/json`               | Invalid parameter value         |

Content-Type follows `output_format`: `image/gif` for `gif`, `image/webp` for `webp`.

### Examples

**Grid mode — columns + rows:**

```bash
curl -X POST https://easy-gif-to-sprites.p.rapidapi.com/from-spritesheet \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com" \
  -F "file=@spritesheet.png" \
  -F "columns=4" \
  -F "rows=3" \
  -F "duration=80" \
  --output animation.gif
```

**Cell mode:**

```bash
curl -X POST https://easy-gif-to-sprites.p.rapidapi.com/from-spritesheet \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com" \
  -F "file=@spritesheet.png" \
  -F "cell_width=64" \
  -F "cell_height=64" \
  -F "frame_count=10" \
  --output animation.gif
```

**From URL:**

```bash
curl -X POST https://easy-gif-to-sprites.p.rapidapi.com/from-spritesheet \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com" \
  -F "url=https://example.com/spritesheet.png" \
  -F "columns=8" \
  -F "rows=4" \
  --output animation.gif
```

**With padding (gaps between cells):**

```bash
curl -X POST https://easy-gif-to-sprites.p.rapidapi.com/from-spritesheet \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com" \
  -F "file=@spritesheet.png" \
  -F "columns=4" \
  -F "rows=3" \
  -F "padding=5" \
  --output animation.gif
```

**With outer margin trimming:**
```bash
curl -X POST https://easy-gif-to-sprites.p.rapidapi.com/from-spritesheet \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com" \
  -F "file=@spritesheet.png" \
  -F "columns=4" \
  -F "rows=3" \
  -F "trim_top=10" \
  -F "trim_right=10" \
  -F "trim_bottom=10" \
  -F "trim_left=10" \
  --output animation.gif
```

**Extract specific range (first row, columns 0–5 only):**

```bash
curl -X POST https://easy-gif-to-sprites.p.rapidapi.com/from-spritesheet \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com" \
  -F "file=@spritesheet.png" \
  -F "columns=8" \
  -F "rows=4" \
  -F "column_range=0-5" \
  -F "row_range=0" \
  --output first_row.gif
```

**Keep empty frames (disable auto-removal):**

```bash
curl -X POST https://easy-gif-to-sprites.p.rapidapi.com/from-spritesheet \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com" \
  -F "file=@spritesheet.png" \
  -F "columns=4" \
  -F "rows=3" \
  -F "skip_empty=false" \
  --output animation_with_blanks.gif
```

**Animated WebP output:**

```bash
curl -X POST https://easy-gif-to-sprites.p.rapidapi.com/from-spritesheet \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com" \
  -F "file=@spritesheet.png" \
  -F "columns=4" \
  -F "rows=3" \
  -F "output_format=webp" \
  -F "quality=80" \
  --output animation.webp
```

---

## Output Formats: GIF vs Animated WebP

The `/from-frames` and `/from-spritesheet` endpoints support two animation output formats:

| Aspect            | GIF (`output_format=gif`) | Animated WebP (`output_format=webp`) |
| ----------------- | --------------------------- | -------------------------------------- |
| Color depth       | 256 colors (palette)        | 24-bit + full alpha                    |
| Transparency      | 1-bit (on/off)              | Full alpha channel                     |
| Typical file size | Larger                      | 25–50% smaller                        |
| Compatibility     | Universal                   | All modern browsers; some older tools may not display |

### WebP Parameters

- `quality` (0–100, default 80) — lossy compression quality. Higher = better quality, larger file. Ignored when `lossless=true`.
- `lossless` (boolean, default false) — when true, output is pixel-perfect (larger file). When false, lossy compression is used.

When `output_format=gif`, both `quality` and `lossless` are ignored.

---

## GET /health

Returns the service status. Does not require authentication.

### Response

```json
{ "status": "ok" }
```

---

## Background Removal

Background removal uses a flood-fill algorithm seeded from all four corners of each frame simultaneously. Pixels within the specified color distance (`tolerance`) of the target color are made transparent.

### bg_color: `"auto"` vs hex

| Mode                 | Behavior                                                                                                                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"auto"` (default) | Samples the RGBA values of the four corner pixels. If all corners are within `tolerance` of each other, their average is used as the target color. If corners diverge beyond `tolerance`, the frame is skipped silently (left unchanged). |
| `"#RRGGBB"`        | Uses the specified color as the target for all frames regardless of corner pixels.                                                                                                                                                            |

### Tolerance Guide

| Tolerance    | Effect                                                               |
| ------------ | -------------------------------------------------------------------- |
| `0`        | Exact color match only                                               |
| `15–30`   | Good for clean flat-color backgrounds (default:`30`)               |
| `50–80`   | Handles slight gradients or compressed backgrounds                   |
| `&gt; 100` | Aggressive — risks removing foreground pixels near background color |

### When to use hex vs auto

- Use `"auto"` when the GIF has a consistent solid background that fills the corners (most common case).
- Use a hex color when the subject reaches into the corners of the frame, or when you know the exact background color.

---

## Authentication — Two Keys Explained

There are two different keys involved. They serve completely different purposes and should not be confused:

| Key                         | Where to find it                               | Used by                                         | Purpose                                                                                                  |
| --------------------------- | ---------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `X-RapidAPI-Key`          | RapidAPI Developer Dashboard&gt; Apps          | **Callers** — included in every request  | Identifies the caller to the RapidAPI gateway for auth and billing                                       |
| `X-RapidAPI-Proxy-Secret` | Hub Listing&gt; Gateway &gt; Firewall Settings | **Backend only** — never sent by callers | Injected by RapidAPI proxy when forwarding to the backend, used to verify the request came from RapidAPI |

- `X-RapidAPI-Key` is consumed by the RapidAPI gateway and **never forwarded to the backend**.
- `X-RapidAPI-Proxy-Secret` is added by the proxy and **never visible to callers**.

### Testing Note

The **RapidAPI test console** (Hub Listing &gt; Test tab) converts uploaded image files to PNG before sending — this will cause a `400 Invalid GIF` error when testing file uploads. Use the `url` parameter instead when testing via the console, or test file uploads directly with curl.

### RapidAPI Firewall Settings

| Setting                   | Recommended   | Reason                                                                                                                                                                                                                                                                                         |
| ------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Threat Protection         | **OFF** | Claims to only scan "non-binary data in multipart/form-data", but actually scans binary GIF data and produces false-positive `400` blocks on larger files. This API has no SQL or JavaScript attack surface — Threat Protection provides no security benefit and breaks core functionality. |
| Request Schema Validation | **OFF** | FastAPI + Pydantic already validates all parameters server-side with proper error responses (`422`).                                                                                                                                                                                         |

---

## Error Responses

All error responses follow this schema:

```json
{ "detail": "Human-readable error message" }
```

| Status                        | Cause                                                                                                                                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400 Bad Request`           | Not a GIF file; both `file` and `url` provided; neither `file` nor `url` provided; URL is unreachable or returns a non-GIF; `bg_color` is not `"auto"` or a valid `#RRGGBB` hex string |
| `413 Content Too Large`     | Input file or URL download exceeds 20 MB                                                                                                                                                             |
| `422 Unprocessable Entity`  | `columns &lt; 1`; `padding &lt; 0`; `tolerance` outside 0–255                                                                                                                                 |
| `500 Internal Server Error` | Unexpected processing failure                                                                                                                                                                        |

---

## Limits

| Limit                | Value                                                          |
| -------------------- | -------------------------------------------------------------- |
| Max input size       | 20 MB (`/from-frames`: 5 MB per file, 60 MB total, 100 files) |
| Accepted inputs      | GIF (`GIF87a`/`GIF89a`) for `/to-*`; PNG for `/from-*`     |
| Output formats       | PNG, ZIP, GIF, animated WebP                                   |
| URL download timeout | 10 seconds                                                     |
| Max request timeout  | 60 seconds                                                     |

---

## Code Examples

### Python (requests)

```python
import requests

url = "https://easy-gif-to-sprites.p.rapidapi.com/to-spritesheet"
headers = {
    "X-RapidAPI-Key": "YOUR_API_KEY",
    "X-RapidAPI-Host": "easy-gif-to-sprites.p.rapidapi.com",
}

with open("animation.gif", "rb") as f:
    response = requests.post(url, headers=headers, files={"file": f})

response.raise_for_status()
with open("spritesheet.png", "wb") as out:
    out.write(response.content)
```

### JavaScript (fetch)

```javascript
const form = new FormData();
form.append("file", fs.createReadStream("animation.gif"));
form.append("columns", "4");
form.append("padding", "8");

const response = await fetch("https://easy-gif-to-sprites.p.rapidapi.com/to-spritesheet", {
  method: "POST",
  headers: {
    "X-RapidAPI-Key": "YOUR_API_KEY",
    "X-RapidAPI-Host": "easy-gif-to-sprites.p.rapidapi.com",
  },
  body: form,
});

const buffer = await response.arrayBuffer();
fs.writeFileSync("spritesheet.png", Buffer.from(buffer));
```

### PHP (cURL)

```php
$curl = curl_init();
curl_setopt_array($curl, [
    CURLOPT_URL => "https://easy-gif-to-sprites.p.rapidapi.com/to-frames",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => [
        "file" => new CURLFile("animation.gif"),
        "remove_bg" => "true",
    ],
    CURLOPT_HTTPHEADER => [
        "X-RapidAPI-Key: YOUR_API_KEY",
        "X-RapidAPI-Host: easy-gif-to-sprites.p.rapidapi.com",
    ],
]);
$response = curl_exec($curl);
file_put_contents("frames.zip", $response);
curl_close($curl);
```
