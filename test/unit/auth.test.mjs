import test from "node:test";
import assert from "node:assert/strict";
import { sdkSignInMarker } from "../../dist/sdk-login.js";

test("OpenCode sign-in marker contains no usable Cursor credential", () => {
  const marker = sdkSignInMarker();
  assert.equal(marker.type, "oauth");
  assert.equal(marker.methodID, "cursor-sdk");
  assert.equal(marker.access, "cursor-sdk");
  assert.equal(marker.refresh, "cursor-sdk");
  assert.equal(marker.expires, 0);
  assert.equal(Object.values(marker).some((value) => typeof value === "string" && /^key_|^sk-|Bearer /i.test(value)), false);
});


import { authorizeWithCursorSdk } from "../../dist/sdk-login.js";
import { setCursorSdkOverridesForTests } from "../../dist/sdk.js";

test("auth flow relays the SDK login URL and discards the returned key", async (t) => {
  setCursorSdkOverridesForTests({
    authStatus: async () => ({ status: "logged-out" }),
    authLogin: async (options) => {
      options.onLoginUrl?.("https://cursor.test/login");
      return {
        apiKey: "super-secret-key",
        email: "dev@example.com",
        apiKeyExpiresAtMs: Date.now() + 1000,
      };
    },
  });
  t.after(() => setCursorSdkOverridesForTests());

  const auth = await authorizeWithCursorSdk();
  assert.equal(auth.url, "https://cursor.test/login");
  const marker = await auth.callback;
  assert.equal(marker.access, "cursor-sdk");
  assert.equal(JSON.stringify(marker).includes("super-secret-key"), false);
});


test("already-authenticated SDK returns a valid URL for OpenCode OAuth UI", async (t) => {
  setCursorSdkOverridesForTests({
    authStatus: async () => ({ status: "logged-in", email: "dev@example.com" }),
  });
  t.after(() => setCursorSdkOverridesForTests());

  const auth = await authorizeWithCursorSdk();
  assert.match(auth.url, /^https?:\/\//);
  assert.equal((await auth.callback).access, "cursor-sdk");
});
