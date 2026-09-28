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
