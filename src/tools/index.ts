import type { Env } from '../types';

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  outputSchema?: object;
  annotations?: ToolAnnotations;
  handler: (args: Record<string, unknown>, env: Env, userId: string) => Promise<unknown>;
}

class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Array<{ name: string; description: string; inputSchema: object; outputSchema?: object; annotations?: ToolAnnotations }> {
    return Array.from(this.tools.values()).map(({ name, description, inputSchema, outputSchema, annotations }) => ({
      name,
      description,
      inputSchema,
      ...(outputSchema && { outputSchema }),
      ...(annotations && { annotations }),
    }));
  }
}

export const toolRegistry = new ToolRegistry();
