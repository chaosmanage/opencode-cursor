import type { TokenUsage, UsageCost } from "@cursor/sdk";

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

export function toOpenAIUsage(usage: TokenUsage | undefined): OpenAIUsage | undefined {
  if (!usage) return undefined;
  const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const details: NonNullable<OpenAIUsage["prompt_tokens_details"]> = {};
  if (usage.cacheReadTokens) details.cached_tokens = usage.cacheReadTokens;
  if (usage.cacheWriteTokens) details.cache_write_tokens = usage.cacheWriteTokens;
  return {
    prompt_tokens: prompt,
    completion_tokens: usage.outputTokens,
    total_tokens: prompt + usage.outputTokens,
    ...(Object.keys(details).length ? { prompt_tokens_details: details } : {}),
    ...(usage.reasoningTokens
      ? { completion_tokens_details: { reasoning_tokens: usage.reasoningTokens } }
      : {}),
  };
}

function value(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function usageGrowth(current: OpenAIUsage, previous?: OpenAIUsage): OpenAIUsage | undefined {
  if (!previous) return current;
  const prompt = Math.max(0, current.prompt_tokens - previous.prompt_tokens);
  const completion = Math.max(0, current.completion_tokens - previous.completion_tokens);
  const cached = Math.max(
    0,
    value(current.prompt_tokens_details?.cached_tokens) -
      value(previous.prompt_tokens_details?.cached_tokens),
  );
  const cacheWrite = Math.max(
    0,
    value(current.prompt_tokens_details?.cache_write_tokens) -
      value(previous.prompt_tokens_details?.cache_write_tokens),
  );
  const reasoning = Math.max(
    0,
    value(current.completion_tokens_details?.reasoning_tokens) -
      value(previous.completion_tokens_details?.reasoning_tokens),
  );
  if (!(prompt || completion || cached || cacheWrite || reasoning)) return undefined;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    ...(cached || cacheWrite
      ? { prompt_tokens_details: {
          ...(cached ? { cached_tokens: cached } : {}),
          ...(cacheWrite ? { cache_write_tokens: cacheWrite } : {}),
        } }
      : {}),
    ...(reasoning ? { completion_tokens_details: { reasoning_tokens: reasoning } } : {}),
  };
}

export function addUsage(
  current: OpenAIUsage | undefined,
  next: OpenAIUsage | undefined,
): OpenAIUsage | undefined {
  if (!current) return next;
  if (!next) return current;
  const cached =
    value(current.prompt_tokens_details?.cached_tokens) +
    value(next.prompt_tokens_details?.cached_tokens);
  const cacheWrite =
    value(current.prompt_tokens_details?.cache_write_tokens) +
    value(next.prompt_tokens_details?.cache_write_tokens);
  const reasoning =
    value(current.completion_tokens_details?.reasoning_tokens) +
    value(next.completion_tokens_details?.reasoning_tokens);
  const prompt = current.prompt_tokens + next.prompt_tokens;
  const completion = current.completion_tokens + next.completion_tokens;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    ...(cached || cacheWrite
      ? {
          prompt_tokens_details: {
            ...(cached ? { cached_tokens: cached } : {}),
            ...(cacheWrite ? { cache_write_tokens: cacheWrite } : {}),
          },
        }
      : {}),
    ...(reasoning
      ? { completion_tokens_details: { reasoning_tokens: reasoning } }
      : {}),
  };
}


export interface CursorCostDelta {
  raw_cost_cents: number;
  charged_cents: number;
}

export function costGrowth(
  current: UsageCost | undefined,
  baseline: UsageCost | undefined,
): CursorCostDelta | undefined {
  if (!current) return undefined;
  const raw = Math.max(0, current.rawCostCents - (baseline?.rawCostCents ?? 0));
  const charged = Math.max(0, current.chargedCents - (baseline?.chargedCents ?? 0));
  if (raw === 0 && charged === 0) return undefined;
  return { raw_cost_cents: raw, charged_cents: charged };
}
