import { MCPError } from './errors';
import { validateUrl } from './ssrf-guard';
import type { Env } from './types';

const MAX_SINGLE_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
const ALLOWED_CONTENT_TYPES = new Set([
  'image/png',
  'image/gif',
  'image/webp',
  'application/zip',
]);

const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/zip': 'zip',
};

export interface ResolvedFile {
  blob: Blob;
  contentType: string;
}

export function generateOutputKey(contentType: string): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const ext = EXTENSION[contentType] ?? 'bin';
  return `output-${hex}.${ext}`;
}

export function outputUrl(env: Pick<Env, 'WORKER_BASE_URL'>, key: string): string {
  return `${env.WORKER_BASE_URL}/output/${key}`;
}

export async function resolveFileInput(input: string, _env: Env): Promise<ResolvedFile> {
  if (input.startsWith('data:')) {
    return decodeDataUri(input);
  }
  if (input.startsWith('https://') || input.startsWith('http://')) {
    return downloadUrl(input);
  }
  throw new MCPError('INVALID_FILE_INPUT', 'File input must be an HTTPS URL or a base64 data URI (data:image/...;base64,...)');
}

function decodeDataUri(dataUri: string): ResolvedFile {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) {
    throw new MCPError('INVALID_BASE64', 'Malformed data URI — expected data:<mime>;base64,<data>');
  }
  const [, mimeType, b64] = match;
  let binary: ArrayBuffer;
  try {
    const binaryStr = atob(b64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    binary = bytes.buffer;
  } catch {
    throw new MCPError('INVALID_BASE64', 'Failed to decode base64 data');
  }
  return { blob: new Blob([binary], { type: mimeType }), contentType: mimeType };
}

async function downloadUrl(url: string): Promise<ResolvedFile> {
  // SSRF guard — throws MCPError on violation
  validateUrl(url);

  // HEAD preflight: check content-length before downloading
  let headRes: Response;
  try {
    headRes = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new MCPError('DOWNLOAD_TIMEOUT', 'URL HEAD request timed out after 10 seconds');
    }
    throw new MCPError('INVALID_FILE_URL', `Failed to reach URL: ${(err as Error).message}`);
  }

  const contentLength = parseInt(headRes.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_SINGLE_FILE_BYTES) {
    throw new MCPError('FILE_TOO_LARGE', `File size ${contentLength} exceeds 20 MB limit`);
  }

  const contentType = (headRes.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new MCPError('INVALID_CONTENT_TYPE', `Content-Type '${contentType}' is not accepted. Expected image/png, image/gif, or image/webp`);
  }

  // Full download
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new MCPError('DOWNLOAD_TIMEOUT', 'URL download timed out after 10 seconds');
    }
    throw new MCPError('INVALID_FILE_URL', `Download failed: ${(err as Error).message}`);
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_SINGLE_FILE_BYTES) {
    throw new MCPError('FILE_TOO_LARGE', `Downloaded file (${buffer.byteLength} bytes) exceeds 20 MB limit`);
  }

  return { blob: new Blob([buffer], { type: contentType }), contentType };
}

export async function uploadToR2(
  env: Env,
  key: string,
  body: ArrayBuffer,
  contentType: string
): Promise<void> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await env.SPRITESHEET_OUTPUT.put(key, body, {
    httpMetadata: { contentType },
    customMetadata: { expiresAt },
  });
}
