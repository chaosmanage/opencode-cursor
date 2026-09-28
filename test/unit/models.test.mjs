import test from "node:test";
import assert from "node:assert/strict";
import {
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
