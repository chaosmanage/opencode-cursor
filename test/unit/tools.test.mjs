import test from "node:test";
import assert from "node:assert/strict";
import { ToolParking } from "../../dist/tools.js";

test("custom tool parks until OpenCode resolves it", async () => {
  const parking = new ToolParking();
  const tools = parking.build([{ type: "function", function: { name: "read", description: "Read", parameters: { type: "object", properties: {} } } }]);
  const promise = tools.read.execute({}, { toolCallId: "call_test" });
  await parking.waitForPending();
  assert.equal(parking.pending.get("call_test").name, "read");
  assert.equal(parking.resolveResults([{ role: "tool", tool_call_id: "call_test", content: "ok" }]), 1);
  assert.deepEqual(await promise, { content: [{ type: "text", text: "ok" }] });
});

test("mutating tools are not annotated read-only", () => {
  const parking = new ToolParking();
  const tools = parking.build([{ type: "function", function: { name: "bash", parameters: { type: "object" } } }]);
  assert.equal(tools.bash.annotations.readOnlyHint, false);
});
