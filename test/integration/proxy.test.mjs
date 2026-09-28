import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getProxyBaseUrl,
  releaseProxy,
  startProxy,
} from "../../dist/proxy.js";
import { setCursorSdkOverridesForTests } from "../../dist/sdk.js";

function fakeRun(agentId, streamFactory) {
  return {
    id: "run-test",
    agentId,
    status: "running",
    supports: () => true,
    unsupportedReason: () => undefined,
    stream: streamFactory,
    conversation: async () => [],
    wait: async () => ({ id: "run-test", status: "finished" }),
    cancel: async () => {},
    onDidChangeStatus: () => () => {},
  };
}

function fakeAgent(send) {
  return {
    agentId: "agent-test",
    model: { id: "fake-model" },
    send,
    close() {},
    reload: async () => {},
    listArtifacts: async () => [],
    downloadArtifact: async () => Buffer.alloc(0),
    getUsage: async () => ({
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
      },
      runs: [],
    }),
  };
}

async function request(body, session = "integration") {
  const response = await fetch(getProxyBaseUrl() + "/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-opencode-cursor-directory": "/tmp/project",
      "x-opencode-cursor-session": session,
      "x-opencode-cursor-agent": "build",
      "x-opencode-cursor-kind": "primary",
    },
    body: JSON.stringify(body),
  });
  return response;
}

test("proxy completes a text turn through a fake SDK agent", async (t) => {
  process.env.XDG_STATE_HOME = await mkdtemp(join(tmpdir(), "cursor-sdk-test-"));
  setCursorSdkOverridesForTests({
    createAgent: async () =>
      fakeAgent(async () =>
        fakeRun("agent-test", async function* () {
          yield {
            type: "assistant",
            agent_id: "agent-test",
            run_id: "run-test",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "hello from cursor" }],
            },
          };
          yield {
            type: "usage",
            agent_id: "agent-test",
            run_id: "run-test",
            usage: {
              inputTokens: 10,
              outputTokens: 4,
              cacheReadTokens: 2,
              cacheWriteTokens: 0,
              totalTokens: 16,
              reasoningTokens: 1,
            },
          };
        }),
      ),
  });
  await startProxy();
  t.after(async () => {
    await releaseProxy();
    setCursorSdkOverridesForTests();
  });

  const response = await request({
    model: "fake-model",
    stream: false,
    messages: [{ role: "user", content: "hello" }],
  }, "text-turn");
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.choices[0].message.content, "hello from cursor");
  assert.equal(json.usage.prompt_tokens, 12);
  assert.equal(json.usage.completion_tokens, 4);
});

test("proxy parks a custom tool in OpenCode and resumes the same run", async (t) => {
  process.env.XDG_STATE_HOME = await mkdtemp(join(tmpdir(), "cursor-sdk-tool-test-"));
  let toolPromise;
  setCursorSdkOverridesForTests({
    createAgent: async () =>
      fakeAgent(async (_message, sendOptions) => {
        const tool = sendOptions.local.customTools.read;
        toolPromise = tool.execute({ path: "README.md" }, { toolCallId: "call_1" });
        return fakeRun("agent-test", async function* () {
          const result = await toolPromise;
          const text =
            typeof result === "object" && result && "content" in result
              ? result.content.find((part) => part.type === "text")?.text || ""
              : String(result);
          yield {
            type: "assistant",
            agent_id: "agent-test",
            run_id: "run-test",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "tool said: " + text }],
            },
          };
        });
      }),
  });
  await startProxy();
  t.after(async () => {
    await releaseProxy();
    setCursorSdkOverridesForTests();
  });

  const tools = [{
    type: "function",
    function: {
      name: "read",
      description: "Read a file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  }];

  const first = await request({
    model: "fake-model",
    stream: false,
    tools,
    messages: [{ role: "user", content: "read the readme" }],
  }, "tool-turn");
  assert.equal(first.status, 200);
  const firstJson = await first.json();
  assert.equal(firstJson.choices[0].finish_reason, "tool_calls");
  assert.equal(firstJson.choices[0].message.tool_calls[0].id, "call_1");

  const second = await request({
    model: "fake-model",
    stream: false,
    tools,
    messages: [
      { role: "user", content: "read the readme" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "read", arguments: "{\"path\":\"README.md\"}" },
        }],
      },
      { role: "tool", tool_call_id: "call_1", content: "README CONTENT" },
    ],
  }, "tool-turn");
  assert.equal(second.status, 200);
  const secondJson = await second.json();
  assert.equal(secondJson.choices[0].message.content, "tool said: README CONTENT");
  assert.equal(secondJson.choices[0].finish_reason, "stop");
});
