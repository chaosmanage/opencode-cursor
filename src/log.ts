import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const REDACTIONS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi,
  /\b(cursor[_-]?(?:api[_-]?)?key)\s*[:=]\s*\S+/gi,
  /\b(authorization)\s*[:=]\s*\S+/gi,
];

function sanitize(value: unknown): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const re of REDACTIONS) out = out.replace(re, "[REDACTED]");
    return out.length > 4000 ? out.slice(0, 4000) + "…" : out;
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/api.?key|authorization|token|secret|credential/i.test(key)) out[key] = "[REDACTED]";
      else out[key] = sanitize(item);
    }
    return out;
  }
  return value;
}

function debugEnabled(): boolean {
  return process.env.OPENCODE_CURSOR_DEBUG === "1";
}

function logPath(): string {
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(base, "opencode-cursor", "debug.log");
}

async function durable(level: string, message: string, data?: unknown): Promise<void> {
  if (!debugEnabled()) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(data === undefined ? {} : { data: sanitize(data) }),
  }) + "\n";
  try {
    const file = logPath();
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, line, "utf8");
  } catch {
  }
}

export const log = {
  info(message: string, data?: unknown) { void durable("info", message, data); },
  warn(message: string, data?: unknown) { void durable("warn", message, data); },
  error(message: string, data?: unknown) { void durable("error", message, data); },
};

export { sanitize as sanitizeForLog };
