import type { SDKUserMessage } from "@cursor/sdk";
import type { OpenAIMessage } from "./openai.js";
import { latestUserMessage, textContent } from "./openai.js";
import { imagesFromContent } from "./media.js";

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
  const finalText = catalog ? catalog + "\n\n" + text : text;
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
