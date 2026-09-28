import test from "node:test";
import assert from "node:assert/strict";
import { toOpenAIUsage, usageGrowth } from "../../dist/usage.js";

test("Cursor usage maps cache and reasoning fields", () => {
  assert.deepEqual(toOpenAIUsage({
    inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2, totalTokens: 20, reasoningTokens: 4,
  }), {
    prompt_tokens: 15,
    completion_tokens: 5,
    total_tokens: 20,
    prompt_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 },
    completion_tokens_details: { reasoning_tokens: 4 },
  });
});

test("usage growth avoids double counting cumulative resumed turns", () => {
  const previous = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
  const current = { prompt_tokens: 18, completion_tokens: 9, total_tokens: 27 };
  assert.deepEqual(usageGrowth(current, previous), {
    prompt_tokens: 8, completion_tokens: 4, total_tokens: 12,
  });
});
