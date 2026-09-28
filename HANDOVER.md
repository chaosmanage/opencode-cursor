# Cursor SDK rewrite — handover

## Current state

Repository: `chaosmanage/opencode-cursor`  
Branch: `sdk-rewrite`  
Current pre-handover HEAD: `9fc41d6`

The SDK rewrite is implemented through the local-validation stage. The remaining blocker is authenticated live Cursor SDK validation on the VPS.

**Do not create a pull request until the user explicitly authorizes it.**

## Core architecture

```text
OpenCode 2
  -> local 127.0.0.1 OpenAI-compatible proxy
  -> official @cursor/sdk
  -> Cursor
```

Primary invariant:

> Cursor reasons; OpenCode controls execution.
Normal agent turns expose only the SDK `mcp` capability when OpenCode tools are present. Cursor-native shell/read/edit/task tools are not offered.

OpenCode tools are converted to SDK custom tools. Their callbacks park until OpenCode applies its own permissions, executes the tool, and returns the result.

Ambient Cursor setting sources are disabled by default with `local.settingSources: []`.

## Plan implementation status

### Phase 0 — Verify the official SDK surface — COMPLETE

Verified against `@cursor/sdk` 1.0.32:

- Node >= 22.13 requirement.
- `Cursor.auth.login/status/logout`.
- `Cursor.models.list()`.
- `Agent.create()` and `Agent.resume()`.
- `SDKAgent.send()`, `Run.stream()`, `Run.wait()`, `Run.steer()`, and `Run.cancel()`.
- `local.customTools`.
- `tools: ["mcp"]` as the custom-tool-only capability boundary.
- `local.settingSources: []`.
- image inputs, usage events, `Agent.getUsage()`, and SDK error classes.
The verified surface is documented in `docs/sdk-surface-notes.md`.

### Phase 1 — Project/runtime migration scaffold — COMPLETE

- Migrated runtime integration to `@cursor/sdk`.
- Updated Node engine to >= 22.13.
- Moved to OpenCode 2 plugin APIs.
- Removed Cursor private transport dependencies.
- Added narrow SDK facade in `src/sdk.ts` for test injection.
- Added CI/release flow using Node/npm instead of the old Bun-only path.

### Phase 2 — SDK-owned authentication — COMPLETE

- Uses official `Cursor.auth.login()`.
- Relays the official Cursor login URL through `onLoginUrl`.
- Uses SDK auth status instead of credential-file parsing.
- OpenCode stores only a non-secret `cursor-sdk` marker.
- Plugin never copies the returned API key into OpenCode auth storage.
- Login completion triggers model catalog refresh.
- Credential-shaped values are redacted from debug logs.

Live login on the VPS is intentionally deferred until the user performs the browser step.
### Phase 3 — Official model catalog/provider registration — COMPLETE

- Uses `Cursor.models.list()`.
- Maps SDK model variants/parameters into OpenCode variants.
- Caches the last successful SDK catalog.
- Refreshes the catalog after login and periodically.
- Keeps stale cache on transient discovery failure.
- Uses conservative fallback context/output limits instead of private metadata.
- Registers the Cursor provider through the OpenCode 2 provider API.

### Phase 4 — Local proxy/text inference — COMPLETE

- Loopback HTTP proxy on `127.0.0.1`.
- `/v1/chat/completions` OpenAI-compatible endpoint.
- Real SSE streaming while the SDK run is active.
- SSE heartbeats during silent reasoning periods.
- Non-stream completion support.
- Client disconnect cancels the active Cursor run.
- SDK failures map to proper HTTP/OpenAI-style errors.

### Phase 5 — Sessions/request classification — COMPLETE

- OpenCode session IDs map to persistent Cursor agent IDs.
- Uses `Agent.resume()` across completed turns.
- Resume failure falls back to transcript reconstruction rather than losing conversation context.
- OpenCode request kinds are used directly instead of prompt heuristics.
- Title/compaction/generate requests run in isolated tool-less agents.
- Utility requests do not mutate the primary conversational agent.

### Phase 6 — OpenCode-owned custom-tool bridge — COMPLETE

- OpenAI function definitions map to SDK custom tools.
- Only tools from the current OpenCode request are exposed.
- SDK custom-tool callbacks park on deferred promises.
- Tool calls return to OpenCode as OpenAI `tool_calls`.
- OpenCode tool results resume the same Cursor run.
- Parallel tool calls are grouped with a settle window.
- Duplicate/late lifecycle paths fail closed.
- Parked turns have TTL/reaper cleanup.
- Session interruption and shutdown reject unresolved callbacks.
- HTTP stream cancellation cancels the Cursor run.

### Phase 7 — Prompt/Code Mode/recovery/media — COMPLETE

- Extracts only the OpenCode `# Code Mode` section when needed.
- Does not forward the full OpenCode system prompt by default.
- Converts user text/images into SDK input.
- Converts OpenCode tool-result text/images into SDK custom-tool results.
- Reconstructs OpenCode transcript context if a persisted Cursor agent cannot resume.
- Avoids dependence on SDK system-prompt replacement.

### Phase 8 — Agent/Plan synchronization — COMPLETE

- OpenCode Plan agent maps to Cursor `plan`.
- Other primary agents map to Cursor `agent`.
- Mode is independent of model variant selection.
- No fake SDK `ask` mode.
- No Cursor-side `fullAuthority` bypass.

### Phase 9 — Images/media — COMPLETE FOR VERIFIED SDK SURFACE

- Direct user image input is supported.
- Tool-result inline images are supported.
- Image data URLs and remote image URLs are translated to SDK image inputs.
- PDF capability is intentionally not advertised because it was not verified through the SDK surface used here.

### Phase 10 — Usage/cost/rate limits — COMPLETE LOCALLY

- Maps input/output/cache/reasoning token usage.
- Prevents double counting across parked/resumed tool turns.
- Uses `Agent.getUsage()` baselines to emit per-run raw/charged `cursor_cost` deltas.
- Maps documented SDK rate-limit errors.
- Does not fabricate account-wide monthly quota percentage.
- Does not scrape Cursor billing/dashboard endpoints.

Real backend cost/usage values still require authenticated live validation.

### Phase 11 — Failures/logging/operational hardening — COMPLETE

- Maps auth, rate-limit, configuration, busy-agent, network, cancellation, and internal failures.
- Debug logging is opt-in.
- Credential-like fields, Authorization values, prompt/media-sensitive payloads are redacted.
- SSE heartbeat, turn-stall timeout, parked-turn TTL, graceful shutdown, and idempotent cleanup are implemented.

### Phase 12 — Compliance/security guardrails — COMPLETE

`scripts/verify-no-private-cursor-api.mjs` rejects reintroduction of:

- the old private Cursor backend hostname;
- private AgentService/RPC names;
- private model/name RPCs;
- generated Cursor protobuf transport;
- H2 bridge files;
- plugin-owned PKCE logic.

Loopback trust tests reject browser Origin requests and non-loopback Host headers.
### Phase 13 — Remove legacy private integration — COMPLETE

Removed:

- plugin-owned OAuth/PKCE/token refresh;
- direct/private Cursor RPC transport;
- H2 bridge workers;
- generated protobuf transport;
- old private model catalog normalizers;
- legacy protocol fixtures/tests;
- runtime bridge copy script.

The package now has one intended Cursor runtime path: `@cursor/sdk`.

### Phase 14 — Documentation — COMPLETE FOR CURRENT DEVELOPMENT STATE

Updated:

- `README.md`
- `CHANGELOG.md`
- `docs/sdk-surface-notes.md`
- `docs/sdk-rewrite-local-review.md`
- CI/release workflow

The docs explicitly distinguish documented SDK integration from legal/ToS guarantees.

### Phase 15 — Comprehensive local test campaign — MOSTLY COMPLETE

Completed:

- clean npm install;
- strict TypeScript build;
- 29 automated tests;
- compliance scan;
- `npm pack --dry-run`;
- package import under Node 22;
- fake-SDK end-to-end text request;
- fake-SDK custom tool park/resume;
- parallel tool groups;
- session resume;
- utility isolation;
- stream disconnect cancellation;
- auth URL relay with secret discard;
- model refresh and variant mapping;
- image conversion;
- usage and cost delta accounting;
- loopback trust;
- log redaction;
- isolated OpenCode v2.0.16 host boot with local plugin path;
- real `Cursor.auth.status()` probe.

Pending because the VPS is logged out of Cursor SDK:

- real account model discovery;
- real text inference;
- real agent resume;
- real agent/plan mode calls;
- real image input;
- real custom-tool invocation against Cursor backend;
- real cancellation;
- real token/cost results;
- real OpenCode end-to-end inference/model picker.

Use `scripts/live-sdk-smoke.mjs` after SDK login.

### Phase 16 — Stress/regression — COMPLETE FOR MOCKED/LOCAL LAYER

Covered:

- parallel custom tools;
- parked turn resume;
- completed-session resume;
- utility isolation;
- cancellation/disconnect;
- usage deduplication;
- bridge lifecycle;
- security/tool restrictions.

Broader real-backend soak testing remains part of authenticated validation.

### Phase 17 — Local implementation review — COMPLETE

Review report:

`docs/sdk-rewrite-local-review.md`

It records architecture, trust boundaries, environment, validation results, known limitations, and remaining live tests.

### Phase 18 — PR authorization gate — ACTIVE / STOP HERE

Do not:

- create a PR;
- create a draft PR;
- push an implementation branch to OpenChamber;
- publish the rewrite upstream.

Passing tests or successful live validation does not count as PR authorization.

### Phase 19 — PR preparation — NOT STARTED

Only start after explicit user authorization.

## Important milestone commits

- `78e7d45` — start Cursor SDK rewrite.
- `aa77fe1` — functional Cursor SDK provider core.
- `a6853ac` — live SSE streaming and bridge lifecycle hardening.
- `9e4963d` — repository cleanup and SDK architecture docs/CI.
- `73470e5` — transcript recovery when Cursor agent resume fails.
- `79b8e31` — injectable SDK facade and end-to-end fake-SDK tests.
- `1e3c523` — concurrency/cancellation regression coverage.
- `43fc081` — verified SDK surface notes and diagnostics.
- `32b60b3` — local review plus live SDK smoke harness.
- `26191f4` — per-run Cursor SDK cost deltas.
- `9fc41d6` — review/docs updated for cost telemetry.

## Current validation environment
- Node: 22.23.2
- OpenCode: v2.0.16
- Cursor SDK: 1.0.32
- Automated tests: 29 passing
- Compliance scan: passing
- npm package dry-run: passing
- Cursor SDK auth state at last check: logged-out

## Next operator steps

1. Complete official Cursor SDK login on the VPS.
2. Run:
   ```bash
   cd /workspace/projects/opencode-cursor
   node scripts/live-sdk-smoke.mjs
   ```
3. Verify real `Cursor.models.list()`.
4. Exercise real agent and plan turns.
5. Exercise a real OpenCode custom-tool round trip.
6. Verify image input, cancellation, session resume, usage, and cost.
7. Run full OpenCode end-to-end model-picker/inference validation.
8. Update `docs/sdk-rewrite-local-review.md` with live results.
9. Run `npm ci && npm run check && npm pack --dry-run`.
10. Stop and present results to the user.

Do not create a PR until explicitly authorized.
