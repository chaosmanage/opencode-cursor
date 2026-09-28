import test from "node:test";
import assert from "node:assert/strict";
import { getCursorDiagnostics } from "../../dist/diagnostics.js";
import { setCursorSdkOverridesForTests } from "../../dist/sdk.js";

test("diagnostics report logged-out SDK state without exposing credentials", async (t) => {
  setCursorSdkOverridesForTests({
    authStatus: async () => ({ status: "logged-out" }),
  });
  t.after(() => setCursorSdkOverridesForTests());
  const result = await getCursorDiagnostics();
  assert.equal(result.auth, "logged-out");
  assert.equal(typeof result.cachedModels, "number");
  assert.equal("email" in result, false);
});
