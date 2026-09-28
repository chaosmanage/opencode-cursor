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

type CursorParameter = NonNullable<SDKModel["parameters"]>[number];

let catalog: CursorModel[] = readCache();

function variantId(displayName: string, index: number): string {
  const clean = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return clean || "variant-" + (index + 1);
}

function normalizedParameterName(value: string | undefined): string {
  return (value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * OpenCode renders model variants in its Thinking selector, so only Cursor
 * controls that actually represent reasoning/thinking effort belong there.
 * Other SDK parameters (fast, context, optimize_for, etc.) must not be exposed
 * as OpenCode variants.
 */
export function isThinkingParameter(parameter: Pick<CursorParameter, "id" | "displayName">): boolean {
  const id = normalizedParameterName(parameter.id);
  if (
    id === "reasoning" ||
    id === "reasoning_effort" ||
    id === "reasoning_level" ||
    id === "effort" ||
    id === "thinking" ||
    id === "thinking_effort" ||
    id === "thinking_level"
  ) {
    return true;
  }

  const label = normalizedParameterName(parameter.displayName);
  return (
    label.includes("reasoning") ||
    label.includes("thinking") ||
    label === "effort" ||
    label.endsWith("_effort")
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

function thinkingKey(
  params: readonly ModelParameterValue[] | undefined,
  thinkingIds: ReadonlySet<string>,
): string {
  return JSON.stringify(
    [...(params || [])]
      .filter((item) => thinkingIds.has(item.id))
      .map((item) => ({ id: item.id, value: item.value }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

function choiceLabel(row: SDKModel, parameter: CursorParameter, value: { value: string; displayName?: string }): string {
  const display = value.displayName?.trim();
  if (display && normalizedParameterName(display) !== normalizedParameterName(row.displayName)) {
    return display;
  }
  return value.value;
}

function labelForPreset(
  row: SDKModel,
  params: readonly ModelParameterValue[] | undefined,
  thinkingParameters: readonly CursorParameter[],
  fallback: string,
): string {
  const relevant = (params || []).filter((item) =>
    thinkingParameters.some((parameter) => parameter.id === item.id),
  );
  if (relevant.length !== 1) return fallback;

  const selected = relevant[0];
  const parameter = thinkingParameters.find((item) => item.id === selected.id);
  const value = parameter?.values?.find((item) => item.value === selected.value);
  if (!parameter || !value) return selected.value;
  return choiceLabel(row, parameter, value);
}

function discoveredSelections(row: SDKModel): {
  defaultSelection: ModelSelection;
  variants: Record<string, ModelSelection>;
} {
  const parameters = row.parameters || [];
  const defaultParams: ModelParameterValue[] = [];
  for (const parameter of parameters) {
    const first = parameter.values?.[0];
    if (first) defaultParams.push({ id: parameter.id, value: first.value });
  }

  let defaultSelection: ModelSelection = {
    id: row.id,
    ...(defaultParams.length ? { params: defaultParams } : {}),
  };

  const thinkingParameters = parameters.filter(isThinkingParameter);
  const thinkingIds = new Set(thinkingParameters.map((parameter) => parameter.id));
  const variants: Record<string, ModelSelection> = {};
  const seenThinkingSelections = new Set<string>();

  const addVariant = (label: string, selection: ModelSelection, index: number) => {
    const key = thinkingKey(selection.params, thinkingIds);
    if (key === "[]" || seenThinkingSelections.has(key)) return;
    seenThinkingSelections.add(key);

    let id = variantId(label, index);
    let suffix = 2;
    const base = id;
    while (variants[id]) id = base + "-" + suffix++;
    variants[id] = selection;
  };

  // Presets can define the SDK's true default selection even when they contain
  // non-thinking parameters. Preserve that default, but only expose a preset in
  // OpenCode's Thinking menu when it actually selects a reasoning control.
  for (const [index, variant] of (row.variants || []).entries()) {
    const selection: ModelSelection = {
      id: row.id,
      ...(variant.params?.length ? { params: variant.params } : {}),
    };
    if (variant.isDefault) defaultSelection = selection;
    if ((variant.params || []).some((param) => thinkingIds.has(param.id))) {
      addVariant(
        labelForPreset(row, variant.params, thinkingParameters, variant.displayName),
        selection,
        index,
      );
    }
  }

  // Preset variants are not guaranteed to enumerate every reasoning value.
  // Discover missing thinking levels from the SDK parameter definitions. Base
  // them on the SDK's default selection so unrelated defaults stay intact.
  const baseParams = defaultSelection.params || defaultParams;
  for (const [parameterIndex, parameter] of thinkingParameters.entries()) {
    for (const [valueIndex, value] of (parameter.values || []).entries()) {
      const selection: ModelSelection = {
        id: row.id,
        params: withParam(baseParams, parameter.id, value.value),
      };
      addVariant(
        choiceLabel(row, parameter, value),
        selection,
        (row.variants?.length || 0) + parameterIndex * 100 + valueIndex,
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
      // OpenCode's zero sentinel disables OpenCode-side overflow compaction.
      // The durable Cursor agent owns the conversation and applies the actual
      // selected model's context policy.
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
