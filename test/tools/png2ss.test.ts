import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolRegistry } from '../../src/tools/index';
import type { Env } from '../../src/types';

// Import the module to trigger registration
import '../../src/tools/png2ss';

const MOCK_PNG_URL = 'https://example.com/frame.png';

function makeEnv() {
  // Stateful KV mock so get() reflects what put() wrote
  const kvStore = new Map<string, string>();
  kvStore.set('quota:user1:' + new Date().toISOString().slice(0, 7), JSON.stringify({ count: 5, updatedAt: '' }));
  const quotasMock = {
    get: vi.fn((key: string) => Promise.resolve(kvStore.get(key) ?? null)),
    put: vi.fn((key: string, value: string) => { kvStore.set(key, value); return Promise.resolve(undefined); }),
  };
  return {
    PNG2SS_URL: 'https://png2ss.example.com',
    GIF2SS_URL: 'https://gif2ss.example.com',
    MCP_KEY: 'test-mcp-key',
    WORKER_BASE_URL: 'https://spritesheet-forge.workers.dev',
    SPRITESHEET_OUTPUT: { put: vi.fn().mockResolvedValue(undefined) },
    SESSIONS: {},
    QUOTAS: quotasMock,
    FREE_QUOTA_LIMIT: '100',
  } as unknown as Env;
}

describe('png_to_spritesheet tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered in the tool registry', () => {
    expect(toolRegistry.get('png_to_spritesheet')).toBeDefined();
  });

  it('calls PNG2SS /to-spritesheet and returns a URL', async () => {
    global.fetch = vi.fn()
      // HEAD preflight for SSRF check (resolveFileInput URL path)
      .mockResolvedValueOnce(new Response(null, { headers: { 'content-type': 'image/png', 'content-length': '100' } }))
      // Actual file download
      .mockResolvedValueOnce(new Response(new Uint8Array(100).buffer, { headers: { 'content-type': 'image/png' } }))
      // Cloud Run response
      .mockResolvedValueOnce(new Response(new Uint8Array(200).buffer, { headers: { 'content-type': 'image/png' } }));

    const env = makeEnv();
    const tool = toolRegistry.get('png_to_spritesheet')!;
    const result = await tool.handler({ files: [MOCK_PNG_URL] }, env, 'user1');

    expect(result.url).toMatch(/^https:\/\/spritesheet-forge\.workers\.dev\/output\//);
    expect(result.content_type).toBe('image/png');
    expect(result.quota.used).toBe(6); // was 5, incremented to 6
    expect(env.SPRITESHEET_OUTPUT.put).toHaveBeenCalledOnce();
  });

  it('throws UPSTREAM_ERROR when Cloud Run returns 422', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { headers: { 'content-type': 'image/png', 'content-length': '100' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(100).buffer, { headers: { 'content-type': 'image/png' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'cell_mode=fixed requires cell_width' }), { status: 422 }));

    const env = makeEnv();
    const tool = toolRegistry.get('png_to_spritesheet')!;
    await expect(tool.handler({ files: [MOCK_PNG_URL], cell_mode: 'fixed' }, env, 'user1'))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });
});

describe('split_spritesheet tool', () => {
  it('is registered', () => {
    expect(toolRegistry.get('split_spritesheet')).toBeDefined();
  });
});

describe('trim_png tool', () => {
  it('is registered', () => {
    expect(toolRegistry.get('trim_png')).toBeDefined();
  });
});
