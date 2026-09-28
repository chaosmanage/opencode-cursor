import { Buffer } from "node:buffer";
import type { ModelParameterValue, ModelSelection } from "@cursor/sdk";

export interface CursorSelectionEnvelope {
  publicId: string;
  variantId?: string;
  model: ModelSelection;
}

export function encodeSelection(selection: CursorSelectionEnvelope): string {
  return Buffer.from(JSON.stringify(selection), "utf8").toString("base64url");
}

export function decodeSelection(encoded: string | null | undefined): CursorSelectionEnvelope | undefined {
  if (!encoded || encoded.length > 8192) return undefined;
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const row = value as Record<string, unknown>;
    if (typeof row.publicId !== "string" || !row.publicId) return undefined;
    if (!row.model || typeof row.model !== "object" || Array.isArray(row.model)) return undefined;
    const model = row.model as Record<string, unknown>;
    if (typeof model.id !== "string" || !model.id) return undefined;
    const params: ModelParameterValue[] = [];
    if (model.params !== undefined) {
      if (!Array.isArray(model.params) || model.params.length > 32) return undefined;
      for (const item of model.params) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
        const p = item as Record<string, unknown>;
        if (typeof p.id !== "string" || typeof p.value !== "string") return undefined;
        params.push({ id: p.id, value: p.value });
      }
    }
    return {
      publicId: row.publicId,
      ...(typeof row.variantId === "string" ? { variantId: row.variantId } : {}),
      model: { id: model.id, ...(params.length ? { params } : {}) },
    };
  } catch {
    return undefined;
  }
}
