import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type ModelSelection, type SDKModel } from "@cursor/sdk";
import { cursorSdk } from "./sdk.js";
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


/**
 * Default context windows published in Cursor's public model documentation.
 *
 * The SDK's model list currently does not expose context-window metadata, so
 * only documented model IDs are overridden here. Unknown/new model IDs remain
 * on FALLBACK_CONTEXT_WINDOW until Cursor documents them or the SDK grows a
 * first-class context-limit field.
 *
 * We intentionally advertise the documented default context, not Max Context:
 * Max Context can require a distinct mode/variant and the SDK does not expose a
 * stable generic signal that lets OpenCode select it safely.
 */
const DOCUMENTED_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  "composer-2.5": 200_000,
  "claude-fable-5": 300_000,
  "claude-fable-5-1": 300_000,
  "claude-opus-5": 300_000,
  "claude-opus-5-5": 300_000,
  "claude-sonnet-5": 200_000,
  "gemini-3.1-pro": 200_000,
  "gemini-3.8-flash": 200_000,
  "gpt-5.5": 272_000,
  "gpt-5.6-luna": 272_000,
  "gpt-5.6-sol": 272_000,
  "gpt-5.6-terra": 272_000,
  "grok-4.5": 256_000,
  "grok-4.6": 256_000,
  "grok-4.7": 256_000,
  "muse-spark-1.3": 300_000,
};

export function contextWindowForModel(modelId: string): number {
  const normalized = modelId.trim().toLowerCase();
  const direct = DOCUMENTED_CONTEXT_WINDOWS[normalized];
  if (direct) return direct;

  // Cursor documents Fast as a speed tier for these models; it does not
  // change the default context boundary, so a separately surfaced "-fast"
  // SDK row can inherit the base model's documented default context.
  if (normalized.endsWith("-fast")) {
    return DOCUMENTED_CONTEXT_WINDOWS[normalized.slice(0, -5)] ?? FALLBACK_CONTEXT_WINDOW;
  }

  return FALLBACK_CONTEXT_WINDOW;
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
      contextWindow: contextWindowForModel(row.id),
      maxTokens: FALLBACK_MAX_TOKENS,
    };
  });
}

export function getCursorModels(): CursorModel[] {
  return catalog;
}

export async function refreshCursorModels(): Promise<boolean> {
  const rows = await cursorSdk().listModels();
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
