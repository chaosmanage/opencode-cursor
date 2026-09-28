import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

async function request(body, session = "integration", directory = "/tmp/project") {
  const response = await fetch(getProxyBaseUrl() + "/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-opencode-cursor-directory": directory,
      "x-opencode-cursor-session": session,
      "x-opencode-cursor-agent": "build",
      "x-opencode-cursor-kind": "primary",
    },
    body: JSON.stringify(body),
  });
  return response;
}

test("broken ambient Cursor MCP settings are excluded from SDK agent options", async (t) => {
  process.env.XDG_STATE_HOME = await mkdtemp(join(tmpdir(), "cursor-sdk-settings-state-"));
  const directory = await mkdtemp(join(tmpdir(), "cursor-sdk-settings-project-"));
  await mkdir(join(directory, ".cursor"));
  await writeFile(join(directory, ".cursor", "mcp.json"), "{ deliberately invalid JSON");
  let optionsSeen;
  setCursorSdkOverridesForTests({
    createAgent: async (options) => {
      optionsSeen = options;
      return fakeAgent(async () => fakeRun("agent-test", async function* () {
        yield {
          type: "assistant",
          agent_id: "agent-test",
          run_id: "run-test",
          message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
        };
      }));
    },
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
  }, "settings-isolation", directory);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).choices[0].message.content, "ok");
  assert.equal(optionsSeen.local.cwd, directory);
  assert.deepEqual(optionsSeen.local.settingSources, []);
  assert.deepEqual(optionsSeen.tools, []);
});

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


test("streamed Cursor usage accumulates cumulative SDK events and is emitted once", async (t) => {
  process.env.XDG_STATE_HOME = await mkdtemp(join(tmpdir(), "cursor-sdk-usage-stream-test-"));
  const finalUsage = {
    inputTokens: 15,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 20,
    reasoningTokens: 2,
  };
  setCursorSdkOverridesForTests({
    createAgent: async () =>
      fakeAgent(async () => ({
        ...fakeRun("agent-test", async function* () {
          yield {
            type: "usage",
            agent_id: "agent-test",
            run_id: "run-test",
            usage: {
              inputTokens: 10,
              outputTokens: 2,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 12,
              reasoningTokens: 1,
            },
          };
          yield {
            type: "usage",
            agent_id: "agent-test",
            run_id: "run-test",
            usage: finalUsage,
          };
        }),
        usage: finalUsage,
      })),
  });
  await startProxy();
  t.after(async () => {
    await releaseProxy();
    setCursorSdkOverridesForTests();
  });

  const response = await request({
    model: "fake-model",
    stream: true,
    messages: [{ role: "user", content: "usage" }],
  }, "usage-stream");
  assert.equal(response.status, 200);
  const events = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)));
  const usageEvents = events.filter((event) => event.usage);
  assert.equal(usageEvents.length, 1);
  assert.deepEqual(usageEvents[0].usage, {
    prompt_tokens: 15,
    completion_tokens: 5,
    total_tokens: 20,
    completion_tokens_details: { reasoning_tokens: 2 },
  });
});

test("completed run usage is a fallback when the SDK stream omits usage events", async (t) => {
  process.env.XDG_STATE_HOME = await mkdtemp(join(tmpdir(), "cursor-sdk-usage-fallback-test-"));
  const finalUsage = {
    inputTokens: 11,
    outputTokens: 4,
    cacheReadTokens: 3,
    cacheWriteTokens: 1,
    totalTokens: 19,
    reasoningTokens: 0,
  };
  setCursorSdkOverridesForTests({
    createAgent: async () =>
      fakeAgent(async () => ({
        ...fakeRun("agent-test", async function* () {
          yield {
            type: "assistant",
            agent_id: "agent-test",
            run_id: "run-test",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "done" }],
            },
          };
        }),
        usage: finalUsage,
      })),
  });
  await startProxy();
  t.after(async () => {
    await releaseProxy();
    setCursorSdkOverridesForTests();
  });

  const response = await request({
    model: "fake-model",
    stream: true,
    messages: [{ role: "user", content: "usage fallback" }],
  }, "usage-fallback");
  assert.equal(response.status, 200);
  const events = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)));
  const final = events.find((event) => event.usage);
  assert.deepEqual(final.usage, {
    prompt_tokens: 15,
    completion_tokens: 4,
    total_tokens: 19,
    prompt_tokens_details: { cached_tokens: 3, cache_write_tokens: 1 },
  });
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


test("usage is split across parked tool boundaries without double counting", async (t) => {
  process.env.XDG_STATE_HOME = await mkdtemp(join(tmpdir(), "cursor-sdk-tool-usage-test-"));
  let toolPromise;
  setCursorSdkOverridesForTests({
    createAgent: async () =>
      fakeAgent(async (_message, sendOptions) => {
        toolPromise = sendOptions.local.customTools.read.execute(
          { path: "README.md" },
          { toolCallId: "call_usage" },
        );
        return fakeRun("agent-test", async function* () {
          yield {
            type: "usage",
            agent_id: "agent-test",
            run_id: "run-test",
            usage: {
              inputTokens: 10,
              outputTokens: 2,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 12,
            },
          };
          await toolPromise;
          yield {
            type: "usage",
            agent_id: "agent-test",
            run_id: "run-test",
            usage: {
              inputTokens: 15,
              outputTokens: 5,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 20,
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
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
      },
    },
  }];

  const first = await request({
    model: "fake-model",
    stream: false,
    tools,
    messages: [{ role: "user", content: "read" }],
  }, "tool-usage");
  const firstJson = await first.json();
  assert.deepEqual(firstJson.usage, {
    prompt_tokens: 10,
    completion_tokens: 2,
    total_tokens: 12,
  });
  assert.equal(firstJson.choices[0].finish_reason, "tool_calls");

  const second = await request({
    model: "fake-model",
    stream: false,
    tools,
    messages: [
      { role: "user", content: "read" },
      {
        role: "assistant",
        content: null,
        tool_calls: firstJson.choices[0].message.tool_calls,
      },
      { role: "tool", tool_call_id: "call_usage", content: "README" },
    ],
  }, "tool-usage");
  const secondJson = await second.json();
  assert.deepEqual(secondJson.usage, {
    prompt_tokens: 5,
    completion_tokens: 3,
    total_tokens: 8,
  });
});

test("proxy groups parallel custom tools and resumes after both results", async (t) => {
  process.env.XDG_STATE_HOME = await mkdtemp(join(tmpdir(), "cursor-sdk-parallel-test-"));
  setCursorSdkOverridesForTests({
    createAgent: async () =>
      fakeAgent(async (_message, sendOptions) => {
        const readPromise = sendOptions.local.customTools.read.execute(
          { path: "a.txt" },
          { toolCallId: "call_a" },
        );
        const grepPromise = sendOptions.local.customTools.grep.execute(
          { pattern: "needle" },
          { toolCallId: "call_b" },
        );
        return fakeRun("agent-test", async function* () {
          const [readResult, grepResult] = await Promise.all([readPromise, grepPromise]);
          const first = readResult.content.find((part) => part.type === "text")?.text || "";
          const second = grepResult.content.find((part) => part.type === "text")?.text || "";
          yield {
            type: "assistant",
            agent_id: "agent-test",
            run_id: "run-test",
            message: {
              role: "assistant",
              content: [{ type: "text", text: first + "|" + second }],
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

  const tools = [
    {
      type: "function",
      function: {
        name: "read",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    },
    {
      type: "function",
      function: {
        name: "grep",
        parameters: { type: "object", properties: { pattern: { type: "string" } } },
      },
    },
  ];

  const first = await request({
    model: "fake-model",
    stream: false,
    tools,
    messages: [{ role: "user", content: "inspect files" }],
  }, "parallel-turn");
  assert.equal(first.status, 200);
  const firstJson = await first.json();
  assert.equal(firstJson.choices[0].message.tool_calls.length, 2);
  assert.deepEqual(
    firstJson.choices[0].message.tool_calls.map((call) => call.id).sort(),
    ["call_a", "call_b"],
  );

  const second = await request({
    model: "fake-model",
    stream: false,
    tools,
    messages: [
      { role: "user", content: "inspect files" },
      {
        role: "assistant",
        content: null,
        tool_calls: firstJson.choices[0].message.tool_calls,
      },
      { role: "tool", tool_call_id: "call_a", content: "READ" },
      { role: "tool", tool_call_id: "call_b", content: "GREP" },
    ],
  }, "parallel-turn");
  assert.equal(second.status, 200);
  const secondJson = await second.json();
  assert.equal(secondJson.choices[0].message.content, "READ|GREP");
});

test("completed sessions resume the persisted Cursor agent on the next turn", async (t) => {
  process.env.XDG_STATE_HOME = await mkdtemp(join(tmpdir(), "cursor-sdk-resume-test-"));
  let resumes = 0;
  const makeAgent = (text) =>
    fakeAgent(async () =>
      fakeRun("agent-test", async function* () {
        yield {
          type: "assistant",
          agent_id: "agent-test",
          run_id: "run-test",
          message: { role: "assistant", content: [{ type: "text", text }] },
        };
      }),
    );
  setCursorSdkOverridesForTests({
    createAgent: async () => makeAgent("first"),
    resumeAgent: async () => {
      resumes++;
      return makeAgent("second");
    },
  });
  await startProxy();
  t.after(async () => {
    await releaseProxy();
    setCursorSdkOverridesForTests();
  });

  const first = await request({
    model: "fake-model",
    stream: false,
    messages: [{ role: "user", content: "one" }],
  }, "resume-turn");
  assert.equal((await first.json()).choices[0].message.content, "first");

  const second = await request({
    model: "fake-model",
    stream: false,
    messages: [
      { role: "user", content: "one" },
      { role: "assistant", content: "first" },
      { role: "user", content: "two" },
    ],
  }, "resume-turn");
  assert.equal((await second.json()).choices[0].message.content, "second");
  assert.equal(resumes, 1);
});

test("utility requests use isolated tool-less agents", async (t) => {
  process.env.XDG_STATE_HOME = await mkdtemp(join(tmpdir(), "cursor-sdk-meta-test-"));
  let createdOptions;
  let sentOptions;
  setCursorSdkOverridesForTests({
    createAgent: async (options) => {
      createdOptions = options;
      return fakeAgent(async (_message, options2) => {
        sentOptions = options2;
        return {
          ...fakeRun("agent-meta", async function* () {}),
          wait: async () => ({
            id: "run-meta",
            status: "finished",
            result: "A title",
            usage: {
              inputTokens: 3,
              outputTokens: 2,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 5,
            },
          }),
        };
      });
    },
  });
  await startProxy();
  t.after(async () => {
    await releaseProxy();
    setCursorSdkOverridesForTests();
  });

  const response = await fetch(getProxyBaseUrl() + "/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-opencode-cursor-directory": "/tmp/project",
      "x-opencode-cursor-session": "meta-turn",
      "x-opencode-cursor-agent": "build",
      "x-opencode-cursor-kind": "title",
    },
    body: JSON.stringify({
      model: "fake-model",
      stream: false,
      tools: [{
        type: "function",
        function: { name: "bash", parameters: { type: "object" } },
      }],
      messages: [{ role: "user", content: "generate title" }],
    }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).choices[0].message.content, "A title");
  assert.deepEqual(createdOptions.tools, []);
  assert.deepEqual(createdOptions.local.settingSources, []);
  assert.equal(sentOptions.mode, "agent");
});

test("cancelling an HTTP stream cancels the active Cursor run", async (t) => {
  process.env.XDG_STATE_HOME = await mkdtemp(join(tmpdir(), "cursor-sdk-cancel-test-"));
  let cancelled = false;
  let release;
  const blocker = new Promise((resolve) => {
    release = resolve;
  });
  setCursorSdkOverridesForTests({
    createAgent: async () =>
      fakeAgent(async () => ({
        ...fakeRun("agent-test", async function* () {
          await blocker;
        }),
        cancel: async () => {
          cancelled = true;
          release();
        },
      })),
  });
  await startProxy();
  t.after(async () => {
    release();
    await releaseProxy();
    setCursorSdkOverridesForTests();
  });

  const response = await request({
    model: "fake-model",
    stream: true,
    messages: [{ role: "user", content: "long turn" }],
  }, "cancel-turn");
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  await reader.cancel();
  for (let i = 0; i < 40 && !cancelled; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(cancelled, true);
});
