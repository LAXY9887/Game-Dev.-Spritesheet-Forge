import { toolRegistry } from './index';
import { FILE_TTL_MS } from '../file-handler';
import type { Env } from '../types';

const BASE64_THRESHOLD_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

toolRegistry.register({
  name: 'server_info',
  description:
    'Returns this server\'s runtime configuration: upload endpoint URL, output file TTL, file size limits, and base64 encoding rules. ' +
    'Call this before working with large files (≥ 4 MB) or when building multi-step workflows that chain tool outputs.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  async handler(_args, env: Env, _userId) {
    const uploadUrl = `${env.WORKER_BASE_URL}/upload`;
    const ttlMinutes = FILE_TTL_MS / 1000 / 60;
    return {
      upload_url: uploadUrl,
      output_ttl_seconds: FILE_TTL_MS / 1000,
      max_file_bytes: MAX_FILE_BYTES,
      base64_threshold_bytes: BASE64_THRESHOLD_BYTES,
      file_input_rules: {
        small_file:
          `Files < ${BASE64_THRESHOLD_BYTES / 1024 / 1024} MB: ` +
          'base64-encode the raw bytes, then prepend "data:<mime>;base64," — ' +
          'you MUST strip ALL whitespace and newlines from the base64 string before prepending, ' +
          'otherwise the server will reject it with INVALID_BASE64.',
        large_file:
          `Files ≥ ${BASE64_THRESHOLD_BYTES / 1024 / 1024} MB: ` +
          `POST the file to ${uploadUrl} (multipart/form-data, field name "file", ` +
          'same Bearer token as the MCP connection). ' +
          'Use the "url" field from the JSON response as the tool\'s file input. ' +
          'Note: base64-encoding a 4.7 MB file produces a ~6.3 MB JSON payload that most MCP clients will reject.',
        previous_output:
          'Output URLs from any tool on this server can be passed directly as input to other tools ' +
          '— no re-encoding or re-uploading needed. The server reads them directly from storage.',
        ttl_warning:
          `Output URLs expire ${ttlMinutes} minutes after creation. ` +
          'Do not store them for use in later sessions. ' +
          'If a URL may be stale, re-run the originating tool to get a fresh one.',
      },
    };
  },
});
