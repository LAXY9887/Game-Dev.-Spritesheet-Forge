import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveFileInput, generateOutputKey, outputUrl } from '../src/file-handler';
import { MCPError } from '../src/errors';

const mockEnv = {
  WORKER_BASE_URL: 'https://spritesheet-forge.workers.dev',
  SPRITESHEET_OUTPUT: {
    put: vi.fn().mockResolvedValue(undefined),
  },
} as unknown as import('../src/types').Env;

describe('resolveFileInput', () => {
  beforeEach(() => vi.clearAllMocks());

  it('decodes a valid base64 PNG data URI', async () => {
    // 1x1 transparent PNG in base64
    const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const result = await resolveFileInput(png1x1, mockEnv);
    expect(result.blob.type).toBe('image/png');
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('rejects invalid base64', async () => {
    await expect(resolveFileInput('data:image/png;base64,!!!invalid!!!', mockEnv))
      .rejects.toThrow(MCPError);
    try {
      await resolveFileInput('data:image/png;base64,!!!', mockEnv);
    } catch (e) {
      expect((e as MCPError).code).toBe('INVALID_BASE64');
    }
  });

  it('rejects non-HTTPS URL via SSRF guard', async () => {
    await expect(resolveFileInput('http://example.com/file.png', mockEnv))
      .rejects.toThrow(MCPError);
  });

  it('rejects plain strings that are neither URL nor base64', async () => {
    await expect(resolveFileInput('just-a-string', mockEnv))
      .rejects.toThrow(MCPError);
    try {
      await resolveFileInput('just-a-string', mockEnv);
    } catch (e) {
      expect((e as MCPError).code).toBe('INVALID_FILE_INPUT');
    }
  });

  it('fetches a valid HTTPS URL', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { 'content-type': 'image/png', 'content-length': '4' },
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([137, 80, 78, 71]).buffer, {
          headers: { 'content-type': 'image/png' },
        })
      );
    const result = await resolveFileInput('https://example.com/frame.png', mockEnv);
    expect(result.blob.type).toBe('image/png');
  });

  it('rejects URL that returns non-image content type', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('<html>', {
        headers: { 'content-type': 'text/html', 'content-length': '6' },
      })
    );
    await expect(resolveFileInput('https://example.com/page.html', mockEnv))
      .rejects.toThrow(MCPError);
    try {
      await resolveFileInput('https://example.com/page.html', mockEnv);
    } catch (e) {
      expect((e as MCPError).code).toBe('INVALID_CONTENT_TYPE');
    }
  });

  it('rejects files over 20MB', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        headers: { 'content-type': 'image/png', 'content-length': String(21 * 1024 * 1024) },
      })
    );
    await expect(resolveFileInput('https://example.com/huge.png', mockEnv))
      .rejects.toThrow(MCPError);
    try {
      await resolveFileInput('https://example.com/huge.png', mockEnv);
    } catch (e) {
      expect((e as MCPError).code).toBe('FILE_TOO_LARGE');
    }
  });
});

describe('generateOutputKey', () => {
  it('generates a key with correct extension for image/png', () => {
    const key = generateOutputKey('image/png');
    expect(key).toMatch(/^output-[a-f0-9]{32}\.png$/);
  });

  it('generates a key with correct extension for application/zip', () => {
    const key = generateOutputKey('application/zip');
    expect(key).toMatch(/\.zip$/);
  });
});

describe('outputUrl', () => {
  it('returns the correct Worker URL for a key', () => {
    const url = outputUrl(mockEnv, 'output-abc.png');
    expect(url).toBe('https://spritesheet-forge.workers.dev/output/output-abc.png');
  });
});
