import { cursorSdk } from "./sdk.js";

const METHOD_ID = "cursor-sdk";

export function sdkSignInMarker() {
  return {
    type: "oauth" as const,
    methodID: METHOD_ID,
    access: "cursor-sdk",
    refresh: "cursor-sdk",
    expires: 0,
  } as any;
}

export async function authorizeWithCursorSdk() {
  const status = await cursorSdk().authStatus();
  if (status.status === "logged-in") {
    return {
      // OpenCode requires an http(s) URL for OAuth-style integrations even
      // when the SDK is already authenticated. Use a harmless Cursor URL
      // while resolving the callback immediately with our non-secret marker.
      url: "https://cursor.com/",
      instructions: status.email
        ? "Cursor SDK is already signed in as " + status.email + ". OpenCode can complete immediately."
        : "Cursor SDK is already signed in. OpenCode can complete immediately.",
      mode: "auto" as const,
      callback: Promise.resolve(sdkSignInMarker()),
    };
  }

  let resolveUrl!: (url: string) => void;
  let rejectUrl!: (error: unknown) => void;
  const urlPromise = new Promise<string>((resolve, reject) => {
    resolveUrl = resolve;
    rejectUrl = reject;
  });
  const login = cursorSdk().authLogin({
    openBrowser: false,
    apiKeyName: "OpenChamber OpenCode Cursor",
    onLoginUrl: resolveUrl,
  });
  login.catch(rejectUrl);
  const url = await Promise.race([
    urlPromise,
    new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error("Cursor SDK did not provide a login URL.")), 10_000),
    ),
  ]);
  return {
    url,
    instructions:
      "Sign in on Cursor's official page, then return here. The Cursor SDK stores the credential; OpenCode receives only a non-secret sign-in marker.",
    mode: "auto" as const,
    callback: login.then(() => sdkSignInMarker()),
  };
}

export const SDK_AUTH_METHOD = {
  id: METHOD_ID,
  type: "oauth" as const,
  label: "Sign in with Cursor SDK",
};
