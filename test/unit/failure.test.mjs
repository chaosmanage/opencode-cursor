import test from "node:test";
import assert from "node:assert/strict";
import { RateLimitError, AuthenticationError } from "@cursor/sdk";
import { failureResponse } from "../../dist/failure.js";

test("SDK rate limits map to HTTP 429", async () => {
  const response = failureResponse(new RateLimitError("limited"));
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, "cursor_rate_limit");
});

test("SDK auth errors map to HTTP 401", () => {
  assert.equal(failureResponse(new AuthenticationError("sign in")).status, 401);
});
