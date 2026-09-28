import type { SDKImage, SDKCustomToolContent } from "@cursor/sdk";
import type { ContentPart, OpenAIMessage } from "./openai.js";

function urlOf(part: ContentPart): string | undefined {
  if (typeof part.image_url === "string") return part.image_url;
  if (part.image_url && typeof part.image_url === "object") return part.image_url.url;
  return part.url;
}

function mimeOf(part: ContentPart): string {
  return part.mime_type || part.mime || "image/png";
}

function dataUrl(url: string): { data: string; mimeType: string } | undefined {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/i.exec(url.trim());
  if (!match) return undefined;
  return { mimeType: match[1] || "image/png", data: match[2] };
}

export function imagesFromContent(content: OpenAIMessage["content"]): SDKImage[] {
  if (!Array.isArray(content)) return [];
  const out: SDKImage[] = [];
  for (const part of content) {
    const type = (part.type || "").toLowerCase();
    if (!["image", "image_url", "input_image", "file", "input_file"].includes(type)) continue;
    const url = urlOf(part);
    if (url) {
      const parsed = dataUrl(url);
      if (parsed) out.push(parsed);
      else if (/^https?:\/\//i.test(url)) out.push({ url });
      continue;
    }
    if (typeof part.data === "string" && part.data.trim()) {
      out.push({ data: part.data.replace(/^data:[^,]*,/, ""), mimeType: mimeOf(part) });
    }
  }
  return out;
}

export function customToolContent(content: OpenAIMessage["content"]): SDKCustomToolContent[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [{ type: "text", text: "" }];
  const out: SDKCustomToolContent[] = [];
  for (const part of content) {
    if (part.type === "text" && typeof part.text === "string") {
      out.push({ type: "text", text: part.text });
      continue;
    }
    for (const image of imagesFromContent([part])) {
      if ("data" in image) {
        out.push({ type: "image", data: image.data, mimeType: image.mimeType });
      } else {
        out.push({ type: "text", text: "[Image attachment: " + image.url + "]" });
      }
    }
  }
  return out.length ? out : [{ type: "text", text: "" }];
}
