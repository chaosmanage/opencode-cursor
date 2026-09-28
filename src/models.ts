import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  type ModelParameterValue,
  type ModelSelection,
  type SDKModel,
} from "@cursor/sdk";
import { cursorSdk } from "./sdk.js";
import { FALLBACK_MAX_TOKENS } from "./constants.js";

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

function paramsKey(params: readonly ModelParameterValue[] | undefined): string {
  return JSON.stringify(
    [...(params || [])]
      .map((item) => ({ id: item.id, value: item.value }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

function withParam(
  base: readonly ModelParameterValue[],
  id: string,
  value: string,
): ModelParameterValue[] {
  const next = base.filter((item) => item.id !== id);
  next.push({ id, value });
  return next;
}

function discoveredSelections(row: SDKModel): {
  defaultSelection: ModelSelection;
  variants: Record<string, ModelSelection>;
} {
  const defaultParams: ModelParameterValue[] = [];
  for (const parameter of row.parameters || []) {
    const first = parameter.values?.[0];
    if (first) defaultParams.push({ id: parameter.id, value: first.value });
  }

  let defaultSelection: ModelSelection = {
    id: row.id,
    ...(defaultParams.length ? { params: defaultParams } : {}),
  };
  const variants: Record<string, ModelSelection> = {};
  const seen = new Set<string>();

  const addVariant = (
    label: string,
    selection: ModelSelection,
    index: number,
    fallbackPrefix?: string,
  ) => {
    const key = paramsKey(selection.params);
    if (seen.has(key)) return;
    seen.add(key);

    let id = variantId(label, index);
    if (variants[id]) {
      id = variantId((fallbackPrefix ? fallbackPrefix + " " : "") + label, index);
    }
    let suffix = 2;
    const base = id;
    while (variants[id]) id = base + "-" + suffix++;

    variants[id] = selection;
  };

  for (const [index, variant] of (row.variants || []).entries()) {
    const selection: ModelSelection = {
      id: row.id,
      ...(variant.params?.length ? { params: variant.params } : {}),
    };
    addVariant(variant.displayName, selection, index);
    if (variant.isDefault) defaultSelection = selection;
  }

  // Cursor documents parameters as the source of truth for model-specific
  // controls such as reasoning effort. Preset variants do not necessarily
  // enumerate every allowed parameter value, so surface any remaining values
  // dynamically instead of hardcoding per-model thinking levels.
  for (const [parameterIndex, parameter] of (row.parameters || []).entries()) {
    if (!parameter.values || parameter.values.length <= 1) continue;
    for (const [valueIndex, value] of parameter.values.entries()) {
      const params = withParam(defaultParams, parameter.id, value.value);
      const selection: ModelSelection = { id: row.id, params };
      addVariant(
        value.displayName || value.value,
        selection,
        (row.variants?.length || 0) + parameterIndex * 100 + valueIndex,
        parameter.displayName || parameter.id,
      );
    }
  }

  return { defaultSelection, variants };
}

export function modelsFromSdk(rows: SDKModel[]): CursorModel[] {
  return rows.map((row) => {
    const selections = discoveredSelections(row);
    return {
      id: row.id,
      name: row.displayName || row.id,
      ...(row.description ? { description: row.description } : {}),
      ...selections,
      // OpenCode uses context=0 as its sentinel for "do not perform
      // OpenCode-side context overflow compaction". Cursor owns the durable
      // agent conversation and compacts it against the selected model's real
      // context window, so we intentionally do not invent a numeric limit.
      contextWindow: 0,
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
