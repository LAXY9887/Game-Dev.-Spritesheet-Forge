import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolRegistry } from '../../src/tools/index';
import type { Env } from '../../src/types';
import '../../src/tools/gif2ss';

const MOCK_GIF_URL = 'https://example.com/animation.gif';
const MOCK_PNG_URL = 'https://example.com/frame.png';

function makeEnv() {
  return {
    PNG2SS_URL: 'https://png2ss.example.com',
    GIF2SS_URL: 'https://gif2ss.example.com',
    MCP_KEY: 'test-mcp-key',
    WORKER_BASE_URL: 'https://spritesheet-forge.workers.dev',
    SPRITESHEET_OUTPUT: { put: vi.fn().mockResolvedValue(undefined) },
    SESSIONS: {},
    QUOTAS: {
      get: vi.fn().mockResolvedValue(JSON.stringify({ count: 5, updatedAt: '' })),
      put: vi.fn().mockResolvedValue(undefined),
    },
    FREE_QUOTA_LIMIT: '100',
  } as unknown as Env;
}

describe('gif_to_spritesheet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered', () => expect(toolRegistry.get('gif_to_spritesheet')).toBeDefined());

  it('calls GIF2SS /to-spritesheet and returns a URL', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { headers: { 'content-type': 'image/gif', 'content-length': '100' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(100).buffer, { headers: { 'content-type': 'image/gif' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(500).buffer, { headers: { 'content-type': 'image/png' } }));

    const env = makeEnv();
    const tool = toolRegistry.get('gif_to_spritesheet')!;
    const result = await tool.handler({ file: MOCK_GIF_URL }, env, 'user1');
    expect(result.url).toMatch(/^https:\/\/spritesheet-forge\.workers\.dev\/output\//);
    expect(result.content_type).toBe('image/png');
  });
});

describe('gif_to_frames', () => {
  it('is registered', () => expect(toolRegistry.get('gif_to_frames')).toBeDefined());
});

describe('frames_to_animation', () => {
  it('is registered', () => expect(toolRegistry.get('frames_to_animation')).toBeDefined());
});

describe('spritesheet_to_animation', () => {
  it('is registered', () => expect(toolRegistry.get('spritesheet_to_animation')).toBeDefined());
});
