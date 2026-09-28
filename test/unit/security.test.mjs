import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentOptions, trustedLoopbackHeaders } from "../../dist/proxy.js";

test("agent options expose only custom MCP capability", () => {
  const customTools = {
    read: { execute: async () => "ok" },
  };
  const options = buildAgentOptions("/tmp/project", { id: "model" }, "agent", customTools);
  assert.deepEqual(options.tools, ["mcp"]);
  assert.deepEqual(options.local.settingSources, []);
  assert.equal(options.local.sandboxOptions, undefined);
  assert.equal(options.local.customTools, customTools);
});

test("agent options expose no built-ins when OpenCode supplies no tools", () => {
  const options = buildAgentOptions("/tmp/project", { id: "model" }, "plan", {});
  assert.deepEqual(options.tools, []);
});

test("loopback trust rejects browser origins and external hosts", () => {
  assert.equal(trustedLoopbackHeaders({ host: "127.0.0.1:1234" }), true);
  assert.equal(trustedLoopbackHeaders({ host: "localhost:1234" }), true);
  assert.equal(trustedLoopbackHeaders({ host: "[::1]:1234" }), true);
  assert.equal(trustedLoopbackHeaders({ host: "evil.example:1234" }), false);
  assert.equal(trustedLoopbackHeaders({ host: "127.0.0.1:1234", origin: "https://evil.example" }), false);
});
