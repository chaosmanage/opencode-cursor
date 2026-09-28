# Cursor SDK rewrite — local implementation review

## Status

The local implementation and fake-SDK verification are complete. Prior live
validation is recorded in `HANDOVER.md`; no new Cursor inference was used for
this review.

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
- Maps only SDK reasoning/thinking/effort controls to OpenCode variants; unrelated SDK parameters such as fast/context/router controls are deliberately excluded from OpenCode's Thinking selector.
- Caches the last successful SDK catalog.
- Refreshes after sign-in and periodically.
- Does not use private model RPCs or private metadata.
- Context limits use a positive SDK field if one appears, then an explicit [Cursor-documented](https://cursor.com/docs) per-model default, then `0` for unknown IDs. Cached zero values for known IDs are backfilled. Output metadata remains conservative.

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
- Cumulative usage is delta-accounted across streamed events and parked continuations. Completed `Run.usage` fills in missing final stream usage.
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
- OpenCode v2.0.18
- `@cursor/sdk` 1.0.32

Completed locally:

- strict TypeScript build;
- 44 automated tests, including fake-SDK usage boundaries, context cache migration, and malformed ambient Cursor config isolation;
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
- `git diff --check`;
- isolated OpenCode host boot with the local plugin path;
- real `Cursor.auth.status()` probe.

## Validation and remaining live work

Prior authenticated validation confirmed SDK login, real model listing, direct
SDK text inference and usage, OpenCode text inference, Build and Plan modes,
normal custom-tool execution, and OpenCode edit/bash permission enforcement.
These used Cursor inference and were not repeated in this review.

The OpenCode 2.0.18 `@opencode/ai` OpenAI-compatible adapter was separately
run against a loopback fake SSE server. Its final usage result contained 19
input, 7 output, 3 cached input, and 2 reasoning tokens, matching the fixture.
This confirms the adapter consumes the proxy's final usage chunk shape. A
standalone OpenCode CLI probe stalled during startup, so the full UI/session
accounting path is not locally verified.

Real cross-turn `Agent.resume()`, image input, backend cancellation,
post-fix tool-routing efficiency, and post-fix usage display remain optional
live tests requiring user authorization because they consume Cursor usage.

## Known limitations / remaining work

1. Full OpenCode session/UI accounting for the post-fix usage path is unverified.
2. Real backend validation of model variants remains pending.
3. No account-wide quota/remaining-plan telemetry through this SDK surface.
4. No native SDK Ask mode; PDF input is not advertised.
5. `npm audit` reports a high-severity `undici@5.29.0` advisory through the latest `@cursor/sdk@1.0.32` and `@connectrpc/connect-node@1.7.0`. The latter requires undici 5; npm reports no compatible fix. Forcing undici 6 would be an unsupported major-version override.

## PR gate

Do not create a draft or final PR until the user explicitly authorizes it.
