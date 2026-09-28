# Cursor SDK rewrite — local implementation review

## Status

Local implementation is complete enough for authenticated live validation.

**PR authorization gate remains closed. No pull request may be created without explicit user authorization.**

Current branch: `sdk-rewrite`.

## Implemented architecture

```text
OpenCode 2
  -> local loopback OpenAI-compatible proxy
  -> @cursor/sdk
  -> Cursor
```

Security invariant:

> Cursor reasons; OpenCode controls execution.

Normal Cursor agents receive only the SDK `mcp` capability when OpenCode tools are present. Cursor's native shell/read/edit/task tools are not offered. OpenCode tools are mapped to SDK custom tools whose callbacks park until OpenCode executes the tool and returns the result.

## Authentication

- Uses `Cursor.auth.login/status/logout`.
- Login URL comes from the official SDK.
- SDK credential storage remains authoritative.
- OpenCode receives only a non-secret `cursor-sdk` sign-in marker.
- No plugin-owned PKCE, refresh-token flow, or credential-file parsing remains.

## Models

- Uses `Cursor.models.list()`.
- Maps documented SDK variants to OpenCode variants.
- Caches the last successful SDK catalog.
- Refreshes after sign-in and periodically.
- Does not use private model RPCs or private metadata.
- Context/output limits remain conservative fallbacks because the verified SDK catalog does not expose authoritative values for those OpenCode fields.

## Sessions and requests

- OpenCode session IDs map to persistent Cursor agent IDs.
- `Agent.resume()` is used across completed OpenCode turns.
- If resume fails, the replacement agent receives a transcript reconstruction prompt.
- OpenCode Plan maps to Cursor `plan`; other primary agents use `agent`.
- Title/compaction/generate requests use isolated tool-less agents.

## Tool bridge

Covered behaviors include one tool, parallel tools, parked callback resume, text and image tool results, session cancellation, HTTP client disconnect cancellation, parked-turn TTL, stall watchdog, no ambient Cursor settings, and no native Cursor executable tools.

## Streaming and media

- OpenAI-compatible SSE responses.
- Heartbeats during quiet SDK periods.
- Text and thinking events are forwarded.
- User image inputs map to SDK images.
- Tool-result images map into SDK custom-tool results.
- PDF capability is intentionally not advertised.

## Usage and errors

- Input/output/cache/reasoning token usage maps to OpenAI-compatible usage.
- Documented raw/charged cost is emitted as per-run `cursor_cost` deltas using an `Agent.getUsage()` baseline.
- Cumulative usage is delta-accounted across parked continuations.
- Auth, rate-limit, configuration, busy-agent, and network failures have explicit mappings.
- Account-wide monthly quota is not fabricated or scraped.

## Compliance/security guard

Automated checks reject first-party runtime references to the removed private backend, private AgentService/RPC names, generated Cursor protobufs, H2 bridge files, and plugin-owned PKCE implementation.

Loopback requests reject browser Origin headers and non-loopback Host headers. Debug logging recursively redacts credential-like fields.

## Repository cleanup

Removed from the rewrite:

- private OAuth/token persistence;
- private Cursor RPC/protobuf stack;
- H2 bridge workers;
- reverse-engineered backend fixtures/tests;
- runtime-copy script for bridge workers;
- Bun-only release dependency.

CI/release now use Node/npm.

## Validation completed

Environment:

- Node 22.23.2
- OpenCode v2.0.16
- `@cursor/sdk` 1.0.32

Completed locally:

- strict TypeScript build;
- 28 automated tests;
- fake-SDK end-to-end text turn;
- tool parking/resume;
- parallel tools;
- session resume;
- utility isolation;
- stream disconnect cancellation;
- auth URL relay through the injected SDK facade;
- model refresh/variant mapping;
- image conversion;
- usage delta accounting;
- loopback trust checks;
- credential redaction;
- private-protocol compliance scan;
- package dry-run;
- isolated OpenCode host boot with the local plugin path;
- real `Cursor.auth.status()` probe.

## Authenticated live validation still pending

The remote test machine currently reports `Cursor.auth.status() -> logged-out`.

These remain pending until an interactive Cursor SDK login is completed:

- real account model listing;
- real text inference;
- real persistent agent resume;
- real agent/plan mode;
- real image input;
- real custom-tool invocation against Cursor;
- real cancellation;
- real usage/cost response against the Cursor backend;
- real OpenCode end-to-end inference.

`scripts/live-sdk-smoke.mjs` is the first live validation harness. It exits without inference when logged out.

## Known limitations / remaining work

1. Authenticated live SDK validation.
2. Full OpenCode model-picker validation after a real catalog is available.
3. Real backend validation of model variants.
4. No account-wide quota/remaining-plan telemetry through this SDK surface.
5. No native SDK Ask mode.
6. PDF input is not advertised.
7. Rewrite release/version number remains undecided.

## PR gate

After authenticated validation, rerun `npm ci`, `npm run check`, `npm pack --dry-run`, and `node scripts/live-sdk-smoke.mjs`.

Then update this report with the live results and stop. Do not create a draft or final PR until the user explicitly authorizes it.
