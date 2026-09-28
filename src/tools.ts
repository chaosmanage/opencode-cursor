import { randomUUID } from "node:crypto";
import type {
  SDKCustomTool,
  SDKCustomToolResult,
  SDKJsonValue,
  SDKToolAnnotations,
} from "@cursor/sdk";
import type { OpenAIToolDef, OpenAIMessage } from "./openai.js";
import { customToolContent } from "./media.js";

export interface PendingTool {
  id: string;
  name: string;
  arguments: string;
  resolve: (result: SDKCustomToolResult) => void;
  reject: (error: unknown) => void;
}

const READ_ONLY = new Set([
  "read", "glob", "grep", "list", "webfetch", "websearch",
  "codesearch", "todoread", "lsp_diagnostics", "lsp_hover", "skill",
]);

export class ToolParking {
  readonly pending = new Map<string, PendingTool>();
  private waiters = new Set<() => void>();

  notify(): void {
    for (const waiter of this.waiters) waiter();
    this.waiters.clear();
  }

  waitForPending(): Promise<void> {
    if (this.pending.size) return Promise.resolve();
    return new Promise((resolve) => this.waiters.add(resolve));
  }

  build(tools: OpenAIToolDef[]): Record<string, SDKCustomTool> {
    const out: Record<string, SDKCustomTool> = {};
    for (const tool of tools) {
      const name = tool.function?.name?.trim();
      if (!name) continue;
      const readOnly = READ_ONLY.has(name);
      const annotations: SDKToolAnnotations = {
        readOnlyHint: readOnly,
        destructiveHint: readOnly ? false : undefined,
      };
      out[name] = {
        description: tool.function.description || name,
        inputSchema: (tool.function.parameters || {
          type: "object",
          properties: {},
        }) as Record<string, SDKJsonValue>,
        annotations,
        execute: async (args, context) => {
          const id = context.toolCallId || "call_" + randomUUID().replace(/-/g, "").slice(0, 24);
          return new Promise<SDKCustomToolResult>((resolve, reject) => {
            this.pending.set(id, {
              id,
              name,
              arguments: JSON.stringify(args || {}),
              resolve,
              reject,
            });
            this.notify();
          });
        },
      };
    }
    return out;
  }

  resolveResults(messages: OpenAIMessage[]): number {
    let resolved = 0;
    for (const message of messages) {
      if (message.role !== "tool" || !message.tool_call_id) continue;
      const pending = this.pending.get(message.tool_call_id);
      if (!pending) continue;
      pending.resolve({ content: customToolContent(message.content) });
      this.pending.delete(message.tool_call_id);
      resolved++;
    }
    return resolved;
  }

  rejectAll(error: unknown): void {
    for (const item of this.pending.values()) item.reject(error);
    this.pending.clear();
    this.notify();
  }
}
