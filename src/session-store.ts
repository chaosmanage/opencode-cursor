import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface SessionRecord {
  agentId: string;
  cwd: string;
  modelId: string;
  updatedAt: number;
}

let loaded = false;
const sessions = new Map<string, SessionRecord>();

function filePath(): string {
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(base, "opencode-cursor", "sessions.json");
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const parsed = JSON.parse(readFileSync(filePath(), "utf8")) as Record<string, SessionRecord>;
    for (const [key, value] of Object.entries(parsed)) {
      if (value?.agentId && value?.cwd) sessions.set(key, value);
    }
  } catch {
  }
}

function save(): void {
  try {
    const file = filePath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(Object.fromEntries(sessions), null, 2));
  } catch {
  }
}

export function getSession(key: string): SessionRecord | undefined {
  load();
  return sessions.get(key);
}

export function setSession(key: string, record: Omit<SessionRecord, "updatedAt">): void {
  load();
  sessions.set(key, { ...record, updatedAt: Date.now() });
  save();
}

export function forgetSession(key: string): void {
  load();
  sessions.delete(key);
  save();
}
