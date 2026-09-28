import test from "node:test";
import assert from "node:assert/strict";
import { contextWindowForModel, modelsFromSdk } from "../../dist/models.js";

test("SDK variants map to stable OpenCode variant ids", () => {
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


import { getCursorModels, refreshCursorModels } from "../../dist/models.js";
import { setCursorSdkOverridesForTests } from "../../dist/sdk.js";

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


test("documented Cursor context windows override the conservative fallback", () => {
  assert.equal(contextWindowForModel("composer-2.5"), 200_000);
  assert.equal(contextWindowForModel("claude-opus-5-5"), 300_000);
  assert.equal(contextWindowForModel("claude-fable-5-1"), 300_000);
  assert.equal(contextWindowForModel("gpt-5.6-sol"), 272_000);
  assert.equal(contextWindowForModel("gpt-5.6-sol-fast"), 272_000);
  assert.equal(contextWindowForModel("grok-4.7"), 256_000);
  assert.equal(contextWindowForModel("muse-spark-1.3"), 300_000);
  assert.equal(contextWindowForModel("future-undocumented-model"), 200_000);
});

test("SDK model mapping uses documented context metadata", () => {
  const mapped = modelsFromSdk([
    { id: "claude-opus-5-5", displayName: "Claude Opus 5.5", variants: [] },
    { id: "grok-4.7", displayName: "Grok 4.7", variants: [] },
    { id: "unknown-model", displayName: "Unknown", variants: [] },
  ]);
  assert.deepEqual(mapped.map((model) => model.contextWindow), [300_000, 256_000, 200_000]);
});
