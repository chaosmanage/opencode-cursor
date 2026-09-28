import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Cursor, type ModelSelection, type SDKModel } from "@cursor/sdk";
import { FALLBACK_CONTEXT_WINDOW, FALLBACK_MAX_TOKENS } from "./constants.js";

export interface CursorModel {
  id: string;
  name: string;
  description?: string;
  defaultSelection: ModelSelection;
  variants: Record<string, ModelSelection>;
  contextWindow: number;
  maxTokens: number;
}

let catalog: CursorModel[] = readCache();

function variantId(displayName: string, index: number): string {
  const clean = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return clean || "variant-" + (index + 1);
}

export function modelsFromSdk(rows: SDKModel[]): CursorModel[] {
  return rows.map((row) => {
    const variants: Record<string, ModelSelection> = {};
    let defaultSelection: ModelSelection = { id: row.id };
    for (const [index, variant] of (row.variants || []).entries()) {
      const id = variantId(variant.displayName, index);
      const selection = { id: row.id, params: variant.params };
      variants[id] = selection;
      if (variant.isDefault) defaultSelection = selection;
    }
    return {
      id: row.id,
      name: row.displayName || row.id,
      ...(row.description ? { description: row.description } : {}),
      defaultSelection,
      variants,
      contextWindow: FALLBACK_CONTEXT_WINDOW,
      maxTokens: FALLBACK_MAX_TOKENS,
    };
  });
}

export function getCursorModels(): CursorModel[] {
  return catalog;
}

export async function refreshCursorModels(): Promise<boolean> {
  const rows = await Cursor.models.list();
  if (!rows.length) return false;
  const next = modelsFromSdk(rows);
  const changed = JSON.stringify(next) !== JSON.stringify(catalog);
  catalog = next;
  if (changed) writeCache(next);
  return changed;
}

export function resolveCursorSelection(modelId: string, variant?: string): ModelSelection {
  const model = catalog.find((item) => item.id === modelId);
  if (!model) return { id: modelId };
  if (variant && model.variants[variant]) return model.variants[variant];
  return model.defaultSelection;
}

function cachePath(): string {
  const base = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(base, "opencode-cursor", "models-sdk.json");
}

function readCache(): CursorModel[] {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCache(models: CursorModel[]): void {
  try {
    const file = cachePath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(models, null, 2));
  } catch {
  }
}
