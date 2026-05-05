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
          'Files < 4 MB (MCP payload limit): base64-encode the raw bytes, then prepend "data:<mime>;base64," — ' +
          'you MUST strip ALL whitespace and newlines from the base64 string before prepending, ' +
          'otherwise the server will reject it with INVALID_BASE64. ' +
          'AGENT WARNING: in Claude Code / Claude Desktop, shell command output exceeding ~250 KB is written to ' +
          'a temp file that cannot be read back (256 KB tool limit). ' +
          'This makes base64 impractical for files larger than ~185 KB when using shell tools to encode. ' +
          'If the file requires a shell command to encode, prefer the upload endpoint regardless of file size.',
        large_file:
          `Files ≥ 4 MB, or any file encoded via shell command: ` +
          `POST the file to ${uploadUrl} (multipart/form-data, field name "file", Bearer token required). ` +
          'Use the "url" field from the JSON response as the tool\'s file input. ' +
          'This avoids both the 4 MB MCP payload limit and the ~250 KB shell output context limit.',
        token_for_upload:
          'The upload endpoint requires a Bearer token. ' +
          'MCP clients (Claude Desktop, Claude Code) store this token internally in an encrypted format that cannot be read from the filesystem. ' +
          'The only reliable way to obtain a token is to run the helper script: ' +
          '"python3 scripts/get-token.py" from the spritesheet-forge repository root ' +
          '(https://github.com/LAXY9887/Game-Dev.-Spritesheet-Forge). ' +
          'The script opens a GitHub login page and saves the token to ~/.spritesheet-forge-token. ' +
          'Tell the user: "Please clone https://github.com/LAXY9887/Game-Dev.-Spritesheet-Forge and run python3 scripts/get-token.py, then share the token printed to the terminal." ' +
          'If the user cannot obtain a token, ask them to provide the file as a public HTTPS URL instead.',
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
