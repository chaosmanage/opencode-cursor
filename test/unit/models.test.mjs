import test from "node:test";
import assert from "node:assert/strict";
import { modelsFromSdk } from "../../dist/models.js";
import { getCursorModels, refreshCursorModels } from "../../dist/models.js";
import { setCursorSdkOverridesForTests } from "../../dist/sdk.js";

test("SDK preset variants map to stable OpenCode variant ids", () => {
  const [model] = modelsFromSdk([{
    id: "cursor-model",
    displayName: "Cursor Model",
    variants: [
      { displayName: "High Thinking", params: [{ id: "thinking", value: "high" }], isDefault: true },
      { displayName: "Fast", params: [{ id: "speed", value: "fast" }] },
    ],
  }]);
  assert.equal(model.id, "cursor-model");
  assert.deepEqual(model.defaultSelection, {
    id: "cursor-model",
    params: [{ id: "thinking", value: "high" }],
  });
  assert.deepEqual(model.variants["high-thinking"].params, [{ id: "thinking", value: "high" }]);
  assert.deepEqual(model.variants.fast.params, [{ id: "speed", value: "fast" }]);
});

test("SDK parameter values become variants even without preset variants", () => {
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
  assert.deepEqual(model.defaultSelection.params, [{ id: "reasoning_effort", value: "low" }]);
});

test("parameter-derived variants preserve defaults for other parameters", () => {
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
  assert.deepEqual(model.variants.fast.params, [
    { id: "reasoning_effort", value: "low" },
    { id: "fast", value: "true" },
  ]);
});

test("preset variants remain authoritative and duplicate parameter selections are not repeated", () => {
  const [model] = modelsFromSdk([{
    id: "preset-model",
    displayName: "Preset Model",
    parameters: [{
      id: "reasoning_effort",
      values: [{ value: "low" }, { value: "high" }],
    }],
    variants: [
      {
        displayName: "High Thinking",
        params: [{ id: "reasoning_effort", value: "high" }],
        isDefault: true,
      },
    ],
  }]);

  assert.equal(model.variants["high-thinking"]?.params?.[0]?.value, "high");
  assert.equal(Object.values(model.variants).filter(
    (selection) => selection.params?.[0]?.value === "high",
  ).length, 1);
  assert.equal(model.variants.low?.params?.[0]?.value, "low");
  assert.equal(model.defaultSelection.params?.[0]?.value, "high");
});

test("Cursor models defer context-window management to Cursor", () => {
  const mapped = modelsFromSdk([
    { id: "composer-2.5", displayName: "Composer 2.5", variants: [] },
    { id: "claude-opus-5-5", displayName: "Claude Opus 5.5", variants: [] },
    { id: "future-new-model", displayName: "Future New Model", variants: [] },
  ]);
  assert.deepEqual(mapped.map((model) => model.contextWindow), [0, 0, 0]);
});

test("model refresh uses the official SDK facade", async (t) => {
  setCursorSdkOverridesForTests({
    listModels: async () => [{
      id: "sdk-model",
      displayName: "SDK Model",
      variants: [],
    }],
  });
  t.after(() => setCursorSdkOverridesForTests());
  await refreshCursorModels();
  assert.equal(getCursorModels().some((model) => model.id === "sdk-model"), true);
});
