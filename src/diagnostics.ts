import { cursorSdk } from "./sdk.js";
import { getCursorModels, refreshCursorModels } from "./models.js";

export interface CursorDiagnostics {
  auth: "logged-in" | "logged-out";
  email?: string;
  credentialExpiresAtMs?: number;
  cachedModels: number;
  refreshedModels?: number;
  refreshError?: string;
}

export async function getCursorDiagnostics(
  options: { refreshModels?: boolean } = {},
): Promise<CursorDiagnostics> {
  const status = await cursorSdk().authStatus();
  const result: CursorDiagnostics = {
    auth: status.status,
    cachedModels: getCursorModels().length,
  };

  if (status.status === "logged-in") {
    if (status.email) result.email = status.email;
    if (status.apiKeyExpiresAtMs) {
      result.credentialExpiresAtMs = status.apiKeyExpiresAtMs;
    }
    if (options.refreshModels) {
      try {
        await refreshCursorModels();
        result.refreshedModels = getCursorModels().length;
      } catch (error) {
        result.refreshError =
          error instanceof Error ? error.message : String(error);
      }
    }
  }

  return result;
}
