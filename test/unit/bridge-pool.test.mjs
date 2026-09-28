import test from "node:test";
import assert from "node:assert/strict";
import { consumeBridge } from "../../dist/bridge-pool.js";
import { ToolParking } from "../../dist/tools.js";

test("bridge consumes SDK events through terminal boundary", async () => {
  const events = [
    { type: "thinking", agent_id: "a", run_id: "r", text: "think" },
    { type: "assistant", agent_id: "a", run_id: "r", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } },
  ];
  const seen = [];
  const iterator = (async function* () { for (const event of events) yield event; })()[Symbol.asyncIterator]();
  const bridge = {
    id: "b",
    sessionKey: "/tmp::session",
    agent: { close() {} },
    run: { cancel: async () => {} },
    tools: new ToolParking(),
    iterator,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    closed: false,
  };
  const boundary = await consumeBridge(bridge, (event) => seen.push(event.type));
  assert.deepEqual(seen, ["thinking", "assistant"]);
  assert.deepEqual(boundary, { kind: "done" });
});
