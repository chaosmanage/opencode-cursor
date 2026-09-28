export interface ContentPart {
  type: string;
  text?: string;
  image_url?: string | { url?: string; detail?: string };
  mime?: string;
  mime_type?: string;
  data?: string;
  url?: string;
  filename?: string;
  name?: string;
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | ContentPart[];
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIToolDef {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  model?: string;
  messages?: OpenAIMessage[];
  stream?: boolean;
  tools?: OpenAIToolDef[];
  temperature?: number;
  max_tokens?: number;
}

export function textContent(content: OpenAIMessage["content"]): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text!)
    .join("\n");
}

export function latestUserMessage(messages: OpenAIMessage[]): OpenAIMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i];
  }
  return undefined;
}

export function toolResultMessages(messages: OpenAIMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role === "tool") {
      out.unshift(msg);
      continue;
    }
    if (msg.role === "assistant" || msg.role === "user") break;
  }
  return out;
}
