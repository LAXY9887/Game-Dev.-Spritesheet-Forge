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
