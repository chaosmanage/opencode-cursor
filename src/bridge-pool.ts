import type { Run, SDKAgent, SDKMessage } from "@cursor/sdk";
import { PARKED_TURN_TTL_MS, PARK_SETTLE_MS, TURN_STALL_MS } from "./constants.js";
import { ToolParking } from "./tools.js";
import type { OpenAIUsage } from "./usage.js";

export interface ParkedBridge {
  id: string;
  sessionKey: string;
  agent: SDKAgent;
  run: Run;
  tools: ToolParking;
  iterator: AsyncIterator<SDKMessage>;
  inflight?: Promise<IteratorResult<SDKMessage>>;
  lastUsage?: OpenAIUsage;
  createdAt: number;
  lastActivity: number;
  timer?: ReturnType<typeof setTimeout>;
  closed: boolean;
}

const bridges = new Map<string, ParkedBridge>();

export function getBridge(sessionKey: string): ParkedBridge | undefined {
  const bridge = bridges.get(sessionKey);
  if (bridge) bridge.lastActivity = Date.now();
  return bridge;
}

export function putBridge(bridge: ParkedBridge): void {
  const previous = bridges.get(bridge.sessionKey);
  if (previous && previous !== bridge) closeBridge(previous.sessionKey, new Error("Superseded"));
  bridges.set(bridge.sessionKey, bridge);
  armReaper(bridge);
}

function armReaper(bridge: ParkedBridge): void {
  if (bridge.timer) clearTimeout(bridge.timer);
  bridge.timer = setTimeout(() => {
    closeBridge(bridge.sessionKey, new Error("Parked Cursor turn expired"));
  }, PARKED_TURN_TTL_MS);
  bridge.timer.unref?.();
}

export function touchBridge(bridge: ParkedBridge): void {
  bridge.lastActivity = Date.now();
  armReaper(bridge);
}

export function closeBridge(sessionKey: string, reason = new Error("Cursor turn closed")): void {
  const bridge = bridges.get(sessionKey);
  if (!bridge) return;
  bridges.delete(sessionKey);
  bridge.closed = true;
  if (bridge.timer) clearTimeout(bridge.timer);
  bridge.tools.rejectAll(reason);
  void bridge.run.cancel().catch(() => {});
  bridge.agent.close();
}

export function closeAllBridges(): void {
  for (const key of [...bridges.keys()]) closeBridge(key);
}

export function closeSessionBridges(sessionID: string): number {
  let closed = 0;
  const suffix = "::" + sessionID;
  for (const key of [...bridges.keys()]) {
    if (!key.endsWith(suffix)) continue;
    closeBridge(key, new Error("OpenCode session interrupted"));
    closed++;
  }
  return closed;
}

export type BridgeBoundary =
  | { kind: "park"; tools: Array<{ id: string; name: string; arguments: string }> }
  | { kind: "done" };

function delay(ms: number): Promise<"timer"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timer"), ms);
    timer.unref?.();
  });
}

async function nextEvent(bridge: ParkedBridge): Promise<IteratorResult<SDKMessage>> {
  if (!bridge.inflight) bridge.inflight = bridge.iterator.next();
  const result = await bridge.inflight;
  bridge.inflight = undefined;
  return result;
}

export async function consumeBridge(
  bridge: ParkedBridge,
  onEvent: (event: SDKMessage) => void | Promise<void>,
): Promise<BridgeBoundary> {
  while (!bridge.closed) {
    if (bridge.tools.pending.size) {
      const raced = await Promise.race([
        nextEvent(bridge).then((value) => ({ kind: "event" as const, value })),
        delay(PARK_SETTLE_MS).then(() => ({ kind: "settled" as const })),
      ]);
      if (raced.kind === "settled") {
        touchBridge(bridge);
        return {
          kind: "park",
          tools: [...bridge.tools.pending.values()].map(({ id, name, arguments: args }) => ({
            id, name, arguments: args,
          })),
        };
      }
      if (raced.value.done) return { kind: "done" };
      await onEvent(raced.value.value);
      continue;
    }

    const raced = await Promise.race([
      nextEvent(bridge).then((value) => ({ kind: "event" as const, value })),
      bridge.tools.waitForPending().then(() => ({ kind: "park" as const })),
      delay(TURN_STALL_MS).then(() => ({ kind: "stall" as const })),
    ]);
    if (raced.kind === "park") continue;
    if (raced.kind === "stall") throw new Error("Cursor SDK produced no output before the stall timeout.");
    if (raced.value.done) return { kind: "done" };
    bridge.lastActivity = Date.now();
    await onEvent(raced.value.value);
  }
  return { kind: "done" };
}
