export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'QUOTA_EXCEEDED'
  | 'INVALID_FILE_INPUT'
  | 'INVALID_FILE_URL'
  | 'BLOCKED_URL'
  | 'FILE_TOO_LARGE'
  | 'INVALID_CONTENT_TYPE'
  | 'DOWNLOAD_TIMEOUT'
  | 'INVALID_BASE64'
  | 'UPSTREAM_ERROR'
  | 'PROCESSING_ERROR';

const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  QUOTA_EXCEEDED: 429,
  INVALID_FILE_INPUT: 400,
  INVALID_FILE_URL: 400,
  BLOCKED_URL: 400,
  FILE_TOO_LARGE: 413,
  INVALID_CONTENT_TYPE: 400,
  DOWNLOAD_TIMEOUT: 408,
  INVALID_BASE64: 400,
  UPSTREAM_ERROR: 502,
  PROCESSING_ERROR: 500,
};

export class MCPError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  readonly httpStatus: number;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'MCPError';
    this.code = code;
    this.details = details;
    this.httpStatus = HTTP_STATUS[code];
  }
}

export function formatError(err: MCPError): {
  error: { code: string; message: string; details: Record<string, unknown> };
} {
  return {
    error: {
      code: err.code,
      message: err.message,
      details: err.details,
    },
  };
}
