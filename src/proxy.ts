import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  Agent,
  AuthenticationError,
  type AgentModeOption,
  type ModelSelection,
  type SDKAgent,
  type SDKMessage,
} from "@cursor/sdk";
import {
  AGENT_HEADER,
  DIRECTORY_HEADER,
  KIND_HEADER,
  PROVIDER_ID,
  SESSION_HEADER,
  SSE_HEARTBEAT_MS,
  SELECTION_HEADER,
} from "./constants.js";
import { getBridge, putBridge, consumeBridge, closeBridge, closeAllBridges, type ParkedBridge } from "./bridge-pool.js";
import { decodeSelection } from "./model-selection.js";
import { failureResponse } from "./failure.js";
import { log } from "./log.js";
import { primaryPrompt, metaPrompt } from "./prompt.js";
import { getSession, setSession, forgetSession } from "./session-store.js";
import { ToolParking } from "./tools.js";
import { toOpenAIUsage, usageGrowth, type OpenAIUsage } from "./usage.js";
import type { ChatCompletionRequest, OpenAIMessage } from "./openai.js";
import { toolResultMessages } from "./openai.js";

let server: ReturnType<typeof createServer> | undefined;
let baseUrl: string | undefined;
let holders = 0;

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function trusted(req: IncomingMessage): boolean {
  if (req.headers.origin) return false;
  const host = String(req.headers.host || "");
  return /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 25 * 1024 * 1024) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function modelSelection(req: IncomingMessage, body: ChatCompletionRequest): ModelSelection {
  const selected = decodeSelection(header(req, SELECTION_HEADER));
  if (selected) return selected.model;
  return { id: body.model || "default" };
}

function mode(req: IncomingMessage): AgentModeOption {
  return header(req, AGENT_HEADER)?.toLowerCase() === "plan" ? "plan" : "agent";
}

function sessionKey(req: IncomingMessage): string {
  const cwd = header(req, DIRECTORY_HEADER) || process.cwd();
  const id = header(req, SESSION_HEADER) || randomUUID();
  return cwd + "::" + id;
}

function completionId(key: string): string {
  return "chatcmpl_" + createHash("sha1").update(key + Date.now()).digest("hex").slice(0, 24);
}

async function openAgent(
  key: string,
  cwd: string,
  model: ModelSelection,
  runMode: AgentModeOption,
  tools: ToolParking,
  body: ChatCompletionRequest,
): Promise<SDKAgent> {
  const customTools = tools.build(body.tools || []);
  const options = {
    model,
    mode: runMode,
    tools: Object.keys(customTools).length ? ["mcp"] : [],
    local: {
      cwd,
      settingSources: [],
      customTools,
      sandboxOptions: { enabled: true },
    },
  };
  const saved = getSession(key);
  if (saved?.agentId && saved.cwd === cwd) {
    try {
      return await Agent.resume(saved.agentId, options);
    } catch (error) {
      log.warn("Cursor agent resume failed; starting a fresh agent", {
        key,
        message: error instanceof Error ? error.message : String(error),
      });
      forgetSession(key);
    }
  }
  return Agent.create(options);
}

function isMeta(kind: string | undefined): boolean {
  return kind === "title" || kind === "compaction" || kind === "generate";
}

interface Collected {
  content: string;
  reasoning: string;
  usage?: OpenAIUsage;
  statusError?: string;
}

async function collectBoundary(bridge: ParkedBridge): Promise<{ boundary: Awaited<ReturnType<typeof consumeBridge>>; collected: Collected }> {
  const collected: Collected = { content: "", reasoning: "" };
  const boundary = await consumeBridge(bridge, (event: SDKMessage) => {
    if (event.type === "assistant") {
      for (const block of event.message.content) {
        if (block.type === "text") collected.content += block.text;
      }
    } else if (event.type === "thinking") {
      collected.reasoning += event.text;
    } else if (event.type === "usage") {
      const current = toOpenAIUsage(event.usage);
      if (current) {
        collected.usage = usageGrowth(current, bridge.lastUsage);
        bridge.lastUsage = current;
      }
    } else if (event.type === "status" && event.status === "ERROR") {
      collected.statusError = event.message || "Cursor agent failed";
    }
  });
  return { boundary, collected };
}

function jsonCompletion(
  id: string,
  model: string,
  collected: Collected,
  tools: Array<{ id: string; name: string; arguments: string }>,
): Response {
  return Response.json({
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: collected.content,
        ...(collected.reasoning ? { reasoning_content: collected.reasoning } : {}),
        ...(tools.length ? {
          tool_calls: tools.map((tool) => ({
            id: tool.id,
            type: "function",
            function: { name: tool.name, arguments: tool.arguments },
          })),
        } : {}),
      },
      finish_reason: tools.length ? "tool_calls" : "stop",
    }],
    ...(collected.usage ? { usage: collected.usage } : {}),
  });
}

function streamCollectedCompletion(
  id: string,
  model: string,
  collected: Collected,
  tools: Array<{ id: string; name: string; arguments: string }>,
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (payload: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode("data: " + JSON.stringify(payload) + "\n\n"));
      };
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
      }, SSE_HEARTBEAT_MS);
      heartbeat.unref?.();
      try {
        send({
          id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        });
        if (collected.reasoning) {
          send({
            id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
            choices: [{ index: 0, delta: { reasoning_content: collected.reasoning }, finish_reason: null }],
          });
        }
        if (collected.content) {
          send({
            id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
            choices: [{ index: 0, delta: { content: collected.content }, finish_reason: null }],
          });
        }
        tools.forEach((tool, index) => send({
          id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
          choices: [{
            index: 0,
            delta: { tool_calls: [{ index, id: tool.id, type: "function", function: { name: tool.name, arguments: tool.arguments } }] },
            finish_reason: null,
          }],
        }));
        send({
          id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
          choices: [{ index: 0, delta: {}, finish_reason: tools.length ? "tool_calls" : "stop" }],
          ...(collected.usage ? { usage: collected.usage } : {}),
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        closed = true;
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

function streamBridgeCompletion(
  id: string,
  model: string,
  bridge: ParkedBridge,
): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let latestUsage: OpenAIUsage | undefined;
      const created = Math.floor(Date.now() / 1000);
      const send = (payload: unknown) => {
        if (closed || cancelled) return;
        controller.enqueue(encoder.encode("data: " + JSON.stringify(payload) + "\n\n"));
      };
      const heartbeat = setInterval(() => {
        if (!closed && !cancelled) {
          controller.enqueue(encoder.encode(": ping\n\n"));
        }
      }, SSE_HEARTBEAT_MS);
      heartbeat.unref?.();

      try {
        send({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        });

        const boundary = await consumeBridge(bridge, (event: SDKMessage) => {
          if (event.type === "assistant") {
            for (const block of event.message.content) {
              if (block.type !== "text" || !block.text) continue;
              send({
                id,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{ index: 0, delta: { content: block.text }, finish_reason: null }],
              });
            }
          } else if (event.type === "thinking" && event.text) {
            send({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta: { reasoning_content: event.text }, finish_reason: null }],
            });
          } else if (event.type === "usage") {
            const current = toOpenAIUsage(event.usage);
            if (current) {
              latestUsage = usageGrowth(current, bridge.lastUsage);
              bridge.lastUsage = current;
            }
          } else if (event.type === "status" && event.status === "ERROR") {
            throw new Error(event.message || "Cursor agent failed");
          }
        });

        const tools = boundary.kind === "park" ? boundary.tools : [];
        for (const [index, tool] of tools.entries()) {
          send({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index,
                  id: tool.id,
                  type: "function",
                  function: { name: tool.name, arguments: tool.arguments },
                }],
              },
              finish_reason: null,
            }],
          });
        }

        send({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: tools.length ? "tool_calls" : "stop",
          }],
          ...(latestUsage ? { usage: latestUsage } : {}),
        });
        if (boundary.kind === "done") closeBridge(bridge.sessionKey);
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        closeBridge(bridge.sessionKey, failure);
        send({
          error: {
            message: error instanceof Error ? error.message : String(error),
            type: "server_error",
            code: "cursor_stream_error",
          },
        });
      } finally {
        clearInterval(heartbeat);
        if (!cancelled) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
        closed = true;
      }
    },
    cancel(reason) {
      cancelled = true;
      closeBridge(
        bridge.sessionKey,
        reason instanceof Error ? reason : new Error("OpenCode disconnected from Cursor stream"),
      );
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

async function handleChat(req: IncomingMessage): Promise<Response> {
  const body = await readJson(req) as ChatCompletionRequest;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const cwd = header(req, DIRECTORY_HEADER) || process.cwd();
  const kind = header(req, KIND_HEADER) || "primary";
  const key = sessionKey(req);
  const selection = modelSelection(req, body);
  const id = completionId(key);

  if (isMeta(kind)) {
    const agent = await Agent.create({
      model: selection,
      tools: [],
      local: { cwd, settingSources: [], sandboxOptions: { enabled: true } },
    });
    try {
      const run = await agent.send(metaPrompt(messages), { model: selection, mode: "agent" });
      const result = await run.wait();
      if (result.status === "error") throw new Error(result.error?.message || "Cursor utility request failed");
      const collected: Collected = {
        content: result.result || "",
        reasoning: "",
        usage: toOpenAIUsage(result.usage),
      };
      return body.stream ? streamCollectedCompletion(id, body.model || selection.id, collected, []) : jsonCompletion(id, body.model || selection.id, collected, []);
    } finally {
      agent.close();
    }
  }

  const trailingResults = toolResultMessages(messages);
  let bridge = getBridge(key);
  if (bridge && trailingResults.length) {
    const resolved = bridge.tools.resolveResults(trailingResults);
    if (!resolved) throw new Error("No pending Cursor tool call matched the OpenCode tool result.");
  } else if (!bridge) {
    const parking = new ToolParking();
    const agent = await openAgent(key, cwd, selection, mode(req), parking, body);
    const run = await agent.send(primaryPrompt(messages), {
      model: selection,
      mode: mode(req),
      local: { customTools: parking.build(body.tools || []) },
    });
    bridge = {
      id: randomUUID(),
      sessionKey: key,
      agent,
      run,
      tools: parking,
      iterator: run.stream()[Symbol.asyncIterator](),
      createdAt: Date.now(),
      lastActivity: Date.now(),
      closed: false,
    };
    putBridge(bridge);
    setSession(key, { agentId: agent.agentId, cwd, modelId: selection.id });
  } else if (!trailingResults.length) {
    if (bridge.run.steer && messages.length) {
      const latest = primaryPrompt(messages).text;
      const outcome = await bridge.run.steer(latest);
      if (outcome === "revert_to_followup") {
        closeBridge(key, new Error("Cursor requested a follow-up turn"));
        const parking = new ToolParking();
        const agent = await openAgent(key, cwd, selection, mode(req), parking, body);
        const run = await agent.send(primaryPrompt(messages), {
          model: selection,
          mode: mode(req),
          local: { customTools: parking.build(body.tools || []) },
        });
        bridge = {
          id: randomUUID(),
          sessionKey: key,
          agent,
          run,
          tools: parking,
          iterator: run.stream()[Symbol.asyncIterator](),
          createdAt: Date.now(),
          lastActivity: Date.now(),
          closed: false,
        };
        putBridge(bridge);
        setSession(key, { agentId: agent.agentId, cwd, modelId: selection.id });
      }
    } else {
      throw new Error("A Cursor turn is already active for this OpenCode session.");
    }
  }

  if (body.stream) {
    return streamBridgeCompletion(id, body.model || selection.id, bridge);
  }

  const { boundary, collected } = await collectBoundary(bridge);
  if (collected.statusError) {
    closeBridge(key, new Error(collected.statusError));
    throw new Error(collected.statusError);
  }
  const tools = boundary.kind === "park" ? boundary.tools : [];
  if (boundary.kind === "done") {
    closeBridge(key);
  }
  return jsonCompletion(id, body.model || selection.id, collected, tools);
}

async function nodeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel(new Error("OpenCode HTTP client disconnected")).catch(() => {});
  };
  res.once("close", abort);
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      res.write(Buffer.from(next.value));
    }
  } finally {
    res.off("close", abort);
  }
  res.end();
}

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (!trusted(req)) {
      await nodeResponse(res, Response.json({ error: { message: "Untrusted loopback request" } }, { status: 403 }));
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      await nodeResponse(res, Response.json({ ok: true, provider: PROVIDER_ID }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      await nodeResponse(res, await handleChat(req));
      return;
    }
    await nodeResponse(res, Response.json({ error: { message: "Not found" } }, { status: 404 }));
  } catch (error) {
    log.error("Cursor proxy request failed", { message: error instanceof Error ? error.message : String(error) });
    await nodeResponse(res, failureResponse(error));
  }
}

export async function startProxy(): Promise<string> {
  if (server && baseUrl) return baseUrl;
  server = createServer((req, res) => void handler(req, res));
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Cursor proxy did not bind to TCP");
  baseUrl = "http://127.0.0.1:" + address.port + "/v1";
  return baseUrl;
}

export async function acquireProxy(): Promise<string> {
  holders++;
  return startProxy();
}

export async function releaseProxy(): Promise<void> {
  holders = Math.max(0, holders - 1);
  if (holders) return;
  closeAllBridges();
  const current = server;
  server = undefined;
  baseUrl = undefined;
  if (current) await new Promise<void>((resolve) => current.close(() => resolve()));
}

export function getProxyBaseUrl(): string {
  if (!baseUrl) throw new Error("Cursor proxy is not running");
  return baseUrl;
}

export async function assertSdkLogin(): Promise<void> {
  const { Cursor } = await import("@cursor/sdk");
  const status = await Cursor.auth.status();
  if (status.status !== "logged-in") throw new AuthenticationError("Cursor SDK is not signed in.");
}
