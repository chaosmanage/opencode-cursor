import type { SDKUserMessage } from "@cursor/sdk";
import type { OpenAIMessage } from "./openai.js";
import { latestUserMessage, textContent } from "./openai.js";
import { imagesFromContent } from "./media.js";

export const TOOL_ROUTING_GUIDANCE = [
  "# OpenCode Tool Routing",
  "Prefer direct OpenCode tools for ordinary filesystem and shell work.",
  "When the user gives an exact path, use read/edit/bash directly; do not glob, grep, or search just to rediscover it.",
  "Use execute only for connected MCP orchestration or when no direct OpenCode tool can perform the operation.",
  "For a simple mutation, make the change and perform at most one targeted verification unless the result is ambiguous.",
].join("\n");

export function codeModeCatalog(messages: OpenAIMessage[]): string {
  const system = messages.filter((m) => m.role === "system").map((m) => textContent(m.content)).join("\n");
  const at = system.indexOf("# Code Mode");
  if (at < 0) return "";
  const rest = system.slice(at);
  const next = rest.slice(1).search(/\n# /);
  return (next < 0 ? rest : rest.slice(0, next + 1)).trim();
}

export function primaryPrompt(messages: OpenAIMessage[]): SDKUserMessage {
  const latest = latestUserMessage(messages);
  const text = latest ? textContent(latest.content) : "";
  const catalog = codeModeCatalog(messages);
  const finalText = catalog
    ? TOOL_ROUTING_GUIDANCE + "\n\n" + catalog + "\n\n" + text
    : text;
  return {
    text: finalText || "Continue.",
    ...(latest ? { images: imagesFromContent(latest.content) } : {}),
  };
}

export function metaPrompt(messages: OpenAIMessage[]): SDKUserMessage {
  const sections: string[] = [];
  const images = [];
  for (const message of messages) {
    if (message.role === "tool") continue;
    const text = textContent(message.content).trim();
    if (text) sections.push(message.role.toUpperCase() + ":\n" + text);
    images.push(...imagesFromContent(message.content));
  }
  return { text: sections.join("\n\n") || "Respond to the request.", ...(images.length ? { images } : {}) };
}


export function recoveryPrompt(messages: OpenAIMessage[]): SDKUserMessage {
  const catalog = codeModeCatalog(messages);
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    const text = textContent(message.content).trim();
    if (message.role === "tool") {
      lines.push(
        "TOOL RESULT" +
          (message.tool_call_id ? " (" + message.tool_call_id + ")" : "") +
          ":\n" +
          (text || "[empty tool result]"),
      );
      continue;
    }
    if (message.role === "assistant" && message.tool_calls?.length) {
      const calls = message.tool_calls.map((call) =>
        call.function.name + "(" + call.function.arguments + ")",
      );
      lines.push("ASSISTANT TOOL CALLS:\n" + calls.join("\n"));
    }
    if (text) lines.push(message.role.toUpperCase() + ":\n" + text);
  }
  const latest = latestUserMessage(messages);
  const prefix =
    "The Cursor agent state could not be resumed. Reconstruct the working context from this OpenCode transcript and continue the latest user request. Do not repeat completed work unless needed.\n\n";
  return {
    text:
      prefix +
      (catalog ? TOOL_ROUTING_GUIDANCE + "\n\n" + catalog + "\n\n" : "") +
      lines.join("\n\n"),
    ...(latest ? { images: imagesFromContent(latest.content) } : {}),
  };
}

export function hasPriorConversation(messages: OpenAIMessage[]): boolean {
  let users = 0;
  for (const message of messages) {
    if (message.role === "assistant" || message.role === "tool") return true;
    if (message.role === "user" && ++users > 1) return true;
  }
  return false;
}
