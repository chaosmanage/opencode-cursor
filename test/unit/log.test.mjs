import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeForLog } from "../../dist/log.js";

test("debug log sanitizer redacts credentials recursively", () => {
  const sanitized = sanitizeForLog({
    authorization: "Bearer secret",
    nested: {
      cursor_api_key: "cursor_api_key=very-secret",
      note: "Authorization: token-value",
    },
  });
  const text = JSON.stringify(sanitized);
  assert.equal(text.includes("very-secret"), false);
  assert.equal(text.includes("token-value"), false);
  assert.equal(text.includes("Bearer secret"), false);
});
