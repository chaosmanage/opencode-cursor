import type { Model, Plugin, Provider } from "@opencode/plugin";
import {
  AGENT_HEADER,
  DIRECTORY_HEADER,
  KIND_HEADER,
  MODEL_REFRESH_INTERVAL_MS,
  OPENAI_COMPATIBLE_PACKAGE,
  PROVIDER_ID,
  PROVIDER_NAME,
  SELECTION_HEADER,
  SESSION_HEADER,
} from "./constants.js";
import { authorizeWithCursorSdk, SDK_AUTH_METHOD } from "./sdk-login.js";
import { encodeSelection } from "./model-selection.js";
import {
  getCursorModels,
  refreshCursorModels,
  resolveCursorSelection,
  type CursorModel,
} from "./models.js";
import { acquireProxy, getProxyBaseUrl, releaseProxy, startProxy } from "./proxy.js";
import { closeSessionBridges } from "./bridge-pool.js";
import { log } from "./log.js";

type ProviderInfo = Provider.Info;
type ModelInfo = Model.Info;
type IntegrationEditor = Parameters<Parameters<Plugin.Context["integration"]["transform"]>[0]>[0];
type AuthRegistration = Parameters<IntegrationEditor["method"]["update"]>[0];

function currentBaseUrl(): string {
  try {
    return getProxyBaseUrl();
  } catch {
    return "http://127.0.0.1:0/v1";
  }
}

export function buildProviderInfo(baseURL: string): ProviderInfo {
  return {
    id: PROVIDER_ID,
    name: PROVIDER_NAME,
    activation: "enabled",
    package: OPENAI_COMPATIBLE_PACKAGE,
    settings: {
      baseURL,
      provider: PROVIDER_ID,
      apiKey: "cursor-sdk-proxy",
    },
  } as unknown as ProviderInfo;
}

export function buildProviderModel(model: CursorModel): ModelInfo {
  return {
    id: model.id,
    modelID: model.id,
    providerID: PROVIDER_ID,
    name: model.name,
    capabilities: {
      tools: true,
      input: ["text", "image"],
      output: ["text"],
    },
    variants: Object.keys(model.variants).map((id) => ({ id })),
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: model.contextWindow, output: model.maxTokens },
  } as unknown as ModelInfo;
}

let lastRefresh = 0;

async function primeCatalog(): Promise<void> {
  try {
    await refreshCursorModels();
    lastRefresh = Date.now();
  } catch (error) {
    log.warn("Could not prime Cursor SDK model catalog", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function refreshCatalog(reload: () => Promise<void>): Promise<void> {
  const now = Date.now();
  if (now - lastRefresh < MODEL_REFRESH_INTERVAL_MS) return;
  try {
    const changed = await refreshCursorModels();
    lastRefresh = Date.now();
    if (changed) await reload();
  } catch (error) {
    log.warn("Could not refresh Cursor SDK model catalog", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function authRegistration(reload: () => Promise<void>): AuthRegistration {
  return {
    integrationID: PROVIDER_ID,
    method: SDK_AUTH_METHOD,
    async authorize() {
      const auth = await authorizeWithCursorSdk();
      return {
        ...auth,
        callback: auth.callback.then(async (credential) => {
          lastRefresh = 0;
          await refreshCatalog(reload);
          return credential;
        }),
      };
    },
  } as AuthRegistration;
}

function watchSessionInterrupts(ctx: Plugin.Context): () => void {
  const controller = new AbortController();
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        const item = event as { type?: string; data?: { sessionID?: string } };
        if (
          (item.type === "session.execution.interrupted" ||
            item.type === "session.execution.failed") &&
          item.data?.sessionID
        ) {
          closeSessionBridges(item.data.sessionID);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        log.warn("Cursor session event stream ended", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  })();
  return () => controller.abort();
}

export const CursorSdkPlugin: Plugin.Plugin = {
  id: "openchamber.cursor-sdk",
  async setup(ctx) {
    if ((ctx.options as { debug?: unknown } | undefined)?.debug === true) {
      process.env.OPENCODE_CURSOR_DEBUG ??= "1";
    }
    const directory = ctx.location.directory;
    await acquireProxy();
    await primeCatalog();

    await ctx.provider.transform((providers) => {
      providers.add({
        info: buildProviderInfo(currentBaseUrl()),
        models: getCursorModels().map(buildProviderModel),
      });
    });

    await ctx.session.hook(
      "model.request",
      async (request) => {
        await startProxy();
        request.baseURL = getProxyBaseUrl();
        const selection = resolveCursorSelection(request.model.id, request.model.variant);
        request.headers[SELECTION_HEADER] = encodeSelection({
          publicId: request.model.id,
          ...(request.model.variant ? { variantId: request.model.variant } : {}),
          model: selection,
        });
        request.headers[DIRECTORY_HEADER] = directory;
        request.headers[SESSION_HEADER] = request.sessionID;
        request.headers[AGENT_HEADER] = request.agent;
        request.headers[KIND_HEADER] = request.kind;
      },
      { providerID: PROVIDER_ID },
    );

    await ctx.integration.transform((integrations) => {
      integrations.method.update(authRegistration(() => ctx.provider.reload()));
      integrations.update(PROVIDER_ID, (integration) => {
        integration.name = PROVIDER_NAME;
      });
    });

    void refreshCatalog(() => ctx.provider.reload());
    const stopWatching = watchSessionInterrupts(ctx);

    return async () => {
      stopWatching();
      await releaseProxy();
    };
  },
};

export default CursorSdkPlugin;
export { authorizeWithCursorSdk } from "./sdk-login.js";
export { getCursorModels, refreshCursorModels } from "./models.js";
export { startProxy, getProxyBaseUrl } from "./proxy.js";
export { setCursorSdkOverridesForTests } from "./sdk.js";
export { getCursorDiagnostics } from "./diagnostics.js";
