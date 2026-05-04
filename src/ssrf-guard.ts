import { MCPError } from './errors';

const BLOCKED_HOSTNAMES = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'localhost',
  '127.0.0.1',
  '::1',
]);

function isPrivateIp(hostname: string): boolean {
  if (hostname.startsWith('10.')) return true;
  if (hostname.startsWith('192.168.')) return true;
  // 172.16.0.0 – 172.31.255.255
  const match = hostname.match(/^172\.(\d+)\./);
  if (match) {
    const second = parseInt(match[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

export function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MCPError('INVALID_FILE_URL', `Invalid URL: ${url}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new MCPError('INVALID_FILE_URL', 'Only HTTPS URLs are accepted');
  }

  const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, ''); // strip IPv6 brackets

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new MCPError('BLOCKED_URL', `Blocked host: ${hostname}`);
  }

  if (isPrivateIp(hostname)) {
    throw new MCPError('BLOCKED_URL', `Blocked private IP range: ${hostname}`);
  }
}
