import test from "node:test";
import assert from "node:assert/strict";
import { modelsFromSdk } from "../../dist/models.js";

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
