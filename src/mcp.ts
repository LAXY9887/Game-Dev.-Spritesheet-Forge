import { toolRegistry } from './tools/index';
// Side-effect imports to register all tools
import './tools/server-info';
import './tools/png2ss';
import './tools/gif2ss';
import { MCPError, formatError } from './errors';
import type { Env } from './types';

interface JSONRPCRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id?: string | number | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function rpcResult(result: unknown, id: unknown): Response {
  return jsonResponse({ jsonrpc: '2.0', result, id: id ?? null });
}

function rpcError(code: number, message: string, id: unknown): Response {
  return jsonResponse({ jsonrpc: '2.0', error: { code, message }, id: id ?? null }, 400);
}

export async function handleMCPRequest(request: Request, env: Env, userId: string): Promise<Response> {
  let body: JSONRPCRequest;
  try {
    body = await request.json() as JSONRPCRequest;
  } catch {
    return rpcError(-32700, 'Parse error', null);
  }

  const { method, params, id } = body;

  try {
    switch (method) {
      case 'initialize':
        return rpcResult({
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'spritesheet-forge', version: '1.0.0' },
          instructions:
            `Full documentation (tools, parameters, file input rules, agent workflow guide): ${env.WORKER_BASE_URL}/ — ` +
            'fetch this URL to learn how to use this server. ' +
            'For runtime config (upload URL, TTL, encoding rules), call the server_info tool.',
        }, id);

      case 'notifications/initialized':
        return new Response(null, { status: 204 });

      case 'tools/list':
        return rpcResult({ tools: toolRegistry.list() }, id);

      case 'tools/call': {
        const { name, arguments: args } = params as { name: string; arguments: Record<string, unknown> };
        const tool = toolRegistry.get(name);
        if (!tool) return rpcError(-32601, `Unknown tool: ${name}`, id);
        const result = await tool.handler(args, env, userId);
        return rpcResult({ content: [{ type: 'text', text: JSON.stringify(result) }] }, id);
      }

      default:
        return rpcError(-32601, `Method not found: ${method}`, id);
    }
  } catch (err) {
    if (err instanceof MCPError) {
      return rpcResult({
        content: [{ type: 'text', text: JSON.stringify(formatError(err)) }],
        isError: true,
      }, id);
    }
    console.error('Unhandled error in MCP handler:', err);
    return rpcError(-32603, 'Internal error', id);
  }
}
