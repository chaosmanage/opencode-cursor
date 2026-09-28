import { Cursor } from "@cursor/sdk";

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
  const status = await Cursor.auth.status();
  if (status.status === "logged-in") {
    return {
      url: "",
      instructions: status.email
        ? "Cursor SDK is already signed in as " + status.email + ". Click Complete."
        : "Cursor SDK is already signed in. Click Complete.",
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
  const login = Cursor.auth.login({
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
