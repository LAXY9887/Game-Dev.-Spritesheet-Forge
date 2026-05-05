import { toolRegistry } from './index';
import { resolveFileInput, generateOutputKey, uploadToR2, outputUrl, FILE_TTL_MS } from '../file-handler';
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
    expires_at: new Date(Date.now() + FILE_TTL_MS).toISOString(),
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
      file: { type: 'string', description: 'GIF file — HTTPS URL or data URI. URLs returned by previous tool calls work directly. To encode a local file under 4 MB: base64-encode its bytes and prepend "data:image/gif;base64," (strip any newlines). For files larger than 4 MB, upload first via POST /upload (multipart/form-data, field "file", same Bearer token) and pass the returned URL.' },
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
      file: { type: 'string', description: 'GIF file — HTTPS URL or data URI. URLs returned by previous tool calls work directly. To encode a local file under 4 MB: base64-encode its bytes and prepend "data:image/gif;base64," (strip any newlines). For files larger than 4 MB, upload first via POST /upload (multipart/form-data, field "file", same Bearer token) and pass the returned URL.' },
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
      files: { type: 'array', items: { type: 'string' }, description: 'PNG frames — HTTPS URLs or data URIs. URLs returned by previous tool calls work directly. To encode a local file under 4 MB: base64-encode its bytes and prepend "data:image/png;base64," (strip any newlines). For files larger than 4 MB, upload first via POST /upload (multipart/form-data, field "file", same Bearer token) and pass the returned URL.' },
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
      file: { type: 'string', description: 'Spritesheet PNG — HTTPS URL or data URI. URLs returned by previous tool calls work directly. To encode a local file under 4 MB: base64-encode its bytes and prepend "data:image/png;base64," (strip any newlines). For files larger than 4 MB, upload first via POST /upload (multipart/form-data, field "file", same Bearer token) and pass the returned URL.' },
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
