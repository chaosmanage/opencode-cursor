import test from "node:test";
import assert from "node:assert/strict";
import { encodeSelection, decodeSelection } from "../../dist/model-selection.js";

test("selection round-trips model params", () => {
  const value = { publicId: "x", variantId: "high", model: { id: "cursor-x", params: [{ id: "thinking", value: "high" }] } };
  assert.deepEqual(decodeSelection(encodeSelection(value)), value);
});

test("invalid selection fails closed", () => {
  assert.equal(decodeSelection("not-json"), undefined);
});
