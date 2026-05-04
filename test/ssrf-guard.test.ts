import { describe, it, expect } from 'vitest';
import { validateUrl } from '../src/ssrf-guard';
import { MCPError } from '../src/errors';

describe('validateUrl', () => {
  it('accepts a valid HTTPS URL', () => {
    expect(() => validateUrl('https://example.com/file.png')).not.toThrow();
  });

  it('rejects HTTP URLs', () => {
    expect(() => validateUrl('http://example.com/file.png'))
      .toThrow(MCPError);
    try { validateUrl('http://example.com/file.png'); } catch (e) {
      expect((e as MCPError).code).toBe('INVALID_FILE_URL');
    }
  });

  it('rejects non-URL strings', () => {
    expect(() => validateUrl('not-a-url')).toThrow(MCPError);
    expect(() => validateUrl('')).toThrow(MCPError);
    expect(() => validateUrl('ftp://example.com')).toThrow(MCPError);
  });

  it('rejects GCP metadata endpoint', () => {
    expect(() => validateUrl('https://169.254.169.254/computeMetadata/v1/'))
      .toThrow(MCPError);
    try { validateUrl('https://169.254.169.254/'); } catch (e) {
      expect((e as MCPError).code).toBe('BLOCKED_URL');
    }
  });

  it('rejects metadata.google.internal', () => {
    expect(() => validateUrl('https://metadata.google.internal/computeMetadata/v1/'))
      .toThrow(MCPError);
  });

  it('rejects localhost', () => {
    expect(() => validateUrl('https://localhost/file.png')).toThrow(MCPError);
    expect(() => validateUrl('https://127.0.0.1/file.png')).toThrow(MCPError);
    expect(() => validateUrl('https://[::1]/file.png')).toThrow(MCPError);
  });

  it('rejects private IP ranges', () => {
    expect(() => validateUrl('https://10.0.0.1/file.png')).toThrow(MCPError);
    expect(() => validateUrl('https://192.168.1.1/file.png')).toThrow(MCPError);
    expect(() => validateUrl('https://172.16.0.1/file.png')).toThrow(MCPError);
    expect(() => validateUrl('https://172.31.255.255/file.png')).toThrow(MCPError);
  });

  it('allows 172.32.x.x (outside private range)', () => {
    expect(() => validateUrl('https://172.32.0.1/file.png')).not.toThrow();
  });
});
