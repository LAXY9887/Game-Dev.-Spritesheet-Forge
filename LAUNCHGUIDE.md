# Spritesheet Forge

## Tagline
Game-dev sprite tools: pack, split, trim, and animate PNG/GIF sprites via AI.

## Description
Spritesheet Forge is a remote MCP server for game developers and pixel artists. It wraps two Cloud Run image-processing APIs to let AI agents (Claude, etc.) manipulate sprites through natural language — no local tools required.

Supported workflows:
- **GIF → Spritesheet**: Extract all frames from an animated GIF and pack them into a grid PNG, with optional background removal.
- **GIF → Frames ZIP**: Explode a GIF into individual PNG frames in a ZIP archive.
- **PNG frames → Animation**: Reassemble PNG frames into an animated GIF or WebP.
- **Spritesheet → Animation**: Slice a packed spritesheet back into frames and re-animate it.
- **PNG → Spritesheet**: Merge multiple PNG files into one sheet (grid, horizontal, vertical, or bin-packed) with optional TexturePacker-compatible JSON atlas.
- **Split Spritesheet**: Slice any spritesheet by grid or fixed cell size; export frames as ZIP and/or atlas JSON (json_array, json_hash, CSS).
- **Trim PNG**: Batch-remove transparent edges from one or more PNGs.

Authentication is handled via GitHub OAuth 2.1 + PKCE — users log in with their GitHub account through any MCP-compatible client (Claude Desktop, Claude Code) with no manual token setup.

## Setup Requirements
- No environment variables required for end users — authentication is automatic via GitHub OAuth. MCP clients (Claude Desktop, Claude Code) run the OAuth flow on first use.
- For the upload endpoint (files ≥ 4 MB), a Bearer token is needed. Run the one-line helper: `curl -O https://mcp.clawstudiouo.com/get-token.py && python3 get-token.py`

## Category
Developer Tools

## Use Cases
Game Development, Pixel Art, Sprite Animation, Texture Atlas, Image Processing

## Features
- Convert animated GIFs to spritesheet PNGs with configurable grid columns, padding, and background removal
- Extract GIF frames as individual PNGs in a ZIP archive
- Reassemble PNG frame sequences into animated GIF or WebP with custom duration, loop count, and resize handling
- Slice any spritesheet PNG by grid (columns × rows) or fixed cell size (cell_width × cell_height)
- Pack multiple PNG frames into a spritesheet with grid, horizontal, vertical, or bin-packed layouts
- Generate TexturePacker-compatible atlas JSON (json_array, json_hash) and CSS sprite maps
- Batch trim transparent edges from PNG files (single file or ZIP of multiple)
- Chain tool outputs — pass any output URL directly as input to the next tool without re-uploading
- OAuth 2.1 + PKCE authentication via GitHub — no API key management for users
- Per-user monthly quota with automatic reset on the 1st of each month
- Output files hosted with 1-hour TTL; re-run any tool to refresh
- Supports data URI (base64) for small files and a multipart upload endpoint for files up to 20 MB

## Getting Started
- "Convert this GIF to a spritesheet PNG with 4 columns"
- "Extract all frames from my animation as individual PNGs in a ZIP"
- "Pack these PNG frames into an animated GIF at 80ms per frame"
- "Slice this spritesheet — it has 6 columns and 4 rows"
- "Merge these sprites into a packed spritesheet and give me the atlas JSON"
- "Trim the transparent edges from all these PNG files"
- Tool: gif_to_spritesheet — Convert an animated GIF to a spritesheet PNG grid
- Tool: gif_to_frames — Extract GIF frames as individual PNGs in a ZIP
- Tool: frames_to_animation — Assemble PNG files into an animated GIF or WebP
- Tool: spritesheet_to_animation — Slice a spritesheet and re-animate it
- Tool: png_to_spritesheet — Pack multiple PNGs into a spritesheet with optional atlas metadata
- Tool: split_spritesheet — Slice a spritesheet into frames and/or export atlas JSON
- Tool: trim_png — Crop transparent edges from one or more PNG files
- Tool: server_info — Get upload URL, TTL, and file encoding rules (call before large-file workflows)

## Tags
spritesheet, game-dev, pixel-art, animation, gif, png, sprite, texture-atlas, game-assets, image-processing, webp, game-development, 2d-game, indie-game, sprite-sheet

## Documentation URL
https://mcp.clawstudiouo.com/

## Health Check URL
https://mcp.clawstudiouo.com/health
