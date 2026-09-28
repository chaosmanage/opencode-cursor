import {
  Agent,
  Cursor,
  type AgentOptions,
  type SDKAgent,
  type SDKModel,
  type SdkAuthStatus,
  type SdkLoginOptions,
  type SdkLoginResult,
  type SdkLogoutOptions,
} from "@cursor/sdk";

export interface CursorSdkFacade {
  createAgent(options: AgentOptions): Promise<SDKAgent>;
  resumeAgent(agentId: string, options?: Partial<AgentOptions>): Promise<SDKAgent>;
  listModels(): Promise<SDKModel[]>;
  authStatus(): Promise<SdkAuthStatus>;
  authLogin(options?: SdkLoginOptions): Promise<SdkLoginResult>;
  authLogout(options?: SdkLogoutOptions): Promise<void>;
}

const official: CursorSdkFacade = {
  createAgent: (options) => Agent.create(options),
  resumeAgent: (agentId, options) => Agent.resume(agentId, options),
  listModels: () => Cursor.models.list(),
  authStatus: () => Cursor.auth.status(),
  authLogin: (options) => Cursor.auth.login(options),
  authLogout: (options) => Cursor.auth.logout(options),
};

let testOverrides: Partial<CursorSdkFacade> | undefined;

export function cursorSdk(): CursorSdkFacade {
  return testOverrides ? { ...official, ...testOverrides } : official;
}

/** Test-only injection point; production code never replaces the official facade. */
export function setCursorSdkOverridesForTests(
  overrides?: Partial<CursorSdkFacade>,
): void {
  testOverrides = overrides;
}
