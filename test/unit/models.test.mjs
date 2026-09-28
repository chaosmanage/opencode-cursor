import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  contextWindowForModel,
  getCursorModels,
  isThinkingParameter,
  modelsFromSdk,
  refreshCursorModels,
} from "../../dist/models.js";
import { setCursorSdkOverridesForTests } from "../../dist/sdk.js";

test("recognizes reasoning controls but rejects unrelated Cursor parameters", () => {
  assert.equal(isThinkingParameter({ id: "reasoning_effort", displayName: "Reasoning Effort" }), true);
  assert.equal(isThinkingParameter({ id: "reasoning", displayName: "Reasoning" }), true);
  assert.equal(isThinkingParameter({ id: "effort", displayName: "Effort" }), true);
  assert.equal(isThinkingParameter({ id: "thinking_level", displayName: "Thinking Level" }), true);

  assert.equal(isThinkingParameter({ id: "fast", displayName: "Fast" }), false);
  assert.equal(isThinkingParameter({ id: "context", displayName: "Context" }), false);
  assert.equal(isThinkingParameter({ id: "optimize_for", displayName: "Optimize For" }), false);
  assert.equal(isThinkingParameter({ id: "model", displayName: "GPT-5.6 Luna" }), false);
});

test("reasoning parameter values become OpenCode thinking variants", () => {
  const [model] = modelsFromSdk([{
    id: "reasoning-model",
    displayName: "Reasoning Model",
    parameters: [{
      id: "reasoning_effort",
      displayName: "Reasoning Effort",
      values: [
        { value: "low", displayName: "Low" },
        { value: "medium", displayName: "Medium" },
        { value: "high", displayName: "High" },
      ],
    }],
  }]);

  assert.deepEqual(Object.keys(model.variants), ["low", "medium", "high"]);
  assert.deepEqual(model.variants.low.params, [{ id: "reasoning_effort", value: "low" }]);
  assert.deepEqual(model.variants.medium.params, [{ id: "reasoning_effort", value: "medium" }]);
  assert.deepEqual(model.variants.high.params, [{ id: "reasoning_effort", value: "high" }]);
});

test("unrelated parameters never pollute the Thinking menu", () => {
  const [model] = modelsFromSdk([{
    id: "parameterized-model",
    displayName: "Parameterized Model",
    parameters: [
      {
        id: "fast",
        displayName: "Fast",
        values: [{ value: "false" }, { value: "true", displayName: "Fast" }],
      },
      {
        id: "context",
        displayName: "Context",
        values: [{ value: "default" }, { value: "max", displayName: "Max" }],
      },
      {
        id: "optimize_for",
        displayName: "Optimize For",
        values: [
          { value: "cost", displayName: "Cost" },
          { value: "balanced", displayName: "Balance" },
          { value: "intelligence", displayName: "Intelligence" },
        ],
      },
    ],
    variants: [
      { displayName: "Fast", params: [{ id: "fast", value: "true" }] },
      { displayName: "Max Context", params: [{ id: "context", value: "max" }] },
    ],
  }]);

  assert.deepEqual(model.variants, {});
});

test("reasoning variants preserve unrelated default parameter values", () => {
  const [model] = modelsFromSdk([{
    id: "multi-param-model",
    displayName: "Multi Param Model",
    parameters: [
      {
        id: "reasoning_effort",
        values: [{ value: "low" }, { value: "high" }],
      },
      {
        id: "fast",
        values: [{ value: "false" }, { value: "true", displayName: "Fast" }],
      },
    ],
  }]);

  assert.deepEqual(model.variants.high.params, [
    { id: "fast", value: "false" },
    { id: "reasoning_effort", value: "high" },
  ]);
});

test("reasoning preset labels come from the actual reasoning choice", () => {
  const [model] = modelsFromSdk([{
    id: "gpt-5-6-luna",
    displayName: "GPT-5.6 Luna",
    parameters: [{
      id: "reasoning_effort",
      displayName: "Reasoning Effort",
      values: [
        { value: "low", displayName: "Low" },
        { value: "high", displayName: "High" },
      ],
    }],
    variants: [
      {
        displayName: "GPT-5.6 Luna",
        params: [{ id: "reasoning_effort", value: "high" }],
        isDefault: true,
      },
    ],
  }]);

  assert.deepEqual(Object.keys(model.variants).sort(), ["high", "low"]);
  assert.equal(model.variants.high.params?.[0]?.value, "high");
});

test("non-thinking preset can still define the SDK default without becoming a variant", () => {
  const [model] = modelsFromSdk([{
    id: "composer-2.5",
    displayName: "Composer 2.5",
    parameters: [{
      id: "fast",
      displayName: "Fast",
      values: [{ value: "false" }, { value: "true", displayName: "Fast" }],
    }],
    variants: [{
      displayName: "Fast",
      params: [{ id: "fast", value: "true" }],
      isDefault: true,
    }],
  }]);

  assert.deepEqual(model.variants, {});
  assert.deepEqual(model.defaultSelection.params, [{ id: "fast", value: "true" }]);
});

test("known Cursor models use documented default context windows and unknown models stay uncapped", () => {
  const mapped = modelsFromSdk([
    { id: "composer-2.5", displayName: "Composer 2.5", variants: [] },
    { id: "claude-opus-5-5", displayName: "Claude Opus 5.5", variants: [] },
    { id: "gpt-5.6-luna", displayName: "GPT-5.6 Luna", variants: [] },
    { id: "future-new-model", displayName: "Future New Model", variants: [] },
  ]);
  assert.deepEqual(mapped.map((model) => model.contextWindow), [200000, 300000, 272000, 0]);
});

test("SDK context metadata overrides the documented fallback when a future SDK provides it", () => {
  assert.equal(contextWindowForModel({
    id: "composer-2.5",
    displayName: "Composer 2.5",
    contextWindow: 333000,
  }), 333000);
});

test("cached zero limits are backfilled without replacing positive SDK limits", async () => {
  const dataHome = await mkdtemp(join(tmpdir(), "cursor-sdk-cache-migration-"));
  const cacheDir = join(dataHome, "opencode-cursor");
  await mkdir(cacheDir);
  await writeFile(join(cacheDir, "models-sdk.json"), JSON.stringify([
    { id: "composer-2.5", contextWindow: 0 },
    { id: "gpt-5.6-luna", contextWindow: 333000 },
    { id: "unlisted-model", contextWindow: 0 },
  ]));
  const output = execFileSync(process.execPath, [
    "--input-type=module", "-e",
    "import { getCursorModels } from './dist/models.js'; console.log(JSON.stringify(getCursorModels().map(({ contextWindow }) => contextWindow)))",
  ], { env: { ...process.env, XDG_DATA_HOME: dataHome }, encoding: "utf8" });
  assert.deepEqual(JSON.parse(output), [200000, 333000, 0]);
});

test("model refresh uses the official SDK facade", async (t) => {
  const originalDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), "cursor-sdk-model-cache-test-"));
  setCursorSdkOverridesForTests({
    listModels: async () => [{
      id: "sdk-model",
      displayName: "SDK Model",
      variants: [],
    }],
  });
  t.after(() => {
    setCursorSdkOverridesForTests();
    if (originalDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = originalDataHome;
  });
  await refreshCursorModels();
  assert.equal(getCursorModels().some((model) => model.id === "sdk-model"), true);
});
