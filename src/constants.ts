export const PROVIDER_ID = "cursor";
export const PROVIDER_NAME = "Cursor";
export const OPENAI_COMPATIBLE_PACKAGE = "@ai-sdk/openai-compatible";

export const SELECTION_HEADER = "x-opencode-cursor-selection";
export const DIRECTORY_HEADER = "x-opencode-cursor-directory";
export const SESSION_HEADER = "x-opencode-cursor-session";
export const AGENT_HEADER = "x-opencode-cursor-agent";
export const KIND_HEADER = "x-opencode-cursor-kind";

export const FALLBACK_CONTEXT_WINDOW = 200_000;
export const FALLBACK_MAX_TOKENS = 64_000;
export const MODEL_REFRESH_INTERVAL_MS = 10 * 60_000;
export const PARK_SETTLE_MS = 300;
export const PARKED_TURN_TTL_MS = 60 * 60_000;
export const TURN_STALL_MS = 10 * 60_000;
export const SSE_HEARTBEAT_MS = 5_000;
