# Cursor SDK rewrite — handover

## Current state

Repository: `chaosmanage/opencode-cursor`  
Branch: `sdk-rewrite`  
Committed HEAD: `303092c` — `fix: restrict OpenCode variants to reasoning controls`

The follow-up patch was reviewed and completed. It touched:

- `src/models.ts`
- `src/prompt.ts`
- `src/proxy.ts`
- `src/tools.ts`
- `src/usage.ts`
- `test/integration/proxy.test.mjs`
- `test/unit/models.test.mjs`
- `test/unit/prompt.test.mjs`
- `test/unit/tools.test.mjs`
- `test/unit/usage.test.mjs`

The completed changes are documented below. Do not discard them.

**Hard PR gate:** do not create a PR, draft PR, push to the OpenChamber upstream repository, or publish anything unless the user explicitly says to create the PR. Pushing commits to the user's fork is allowed.

**Cost guardrail:** do not run live Cursor inference, live image inference, live session-resume inference, or live cancellation tests without explicit user approval. The user reported that repeated testing is draining Cursor usage. Prefer fake-SDK/local tests for everything possible.

No secrets are recorded in this file. The VPS has previously had an OpenCode server password and Cursor account details in shell/runtime state; do not print or persist them.

## Architecture

```text
OpenCode / OpenChamber
  -> local loopback OpenAI-compatible proxy
  -> official @cursor/sdk
  -> Cursor hosted agent
```

Primary invariant:

> Cursor reasons; OpenCode controls execution.

Normal agent turns expose only the SDK `mcp` capability when OpenCode tools are present. Cursor-native shell/read/edit/task tools are not offered.

OpenCode tool definitions are converted to SDK `local.customTools`. Their callbacks park while OpenCode applies its own tool permission rules, performs execution, and returns the tool result.

Ambient Cursor settings are disabled with `local.settingSources: []`.

Do not force Cursor's local sandbox. On the VPS, forcing SDK sandboxing failed because the environment did not support it. This is safe in this architecture because Cursor native execution tools are not exposed; OpenCode remains the execution and permission boundary.

## Environment

- VPS workspace: `/workspace/projects/opencode-cursor`
- Validation project: `/workspace/projects/opencode-cursor-validation`
- Node: 22.23.2
- npm: 10.9.8
- OpenCode: 2.0.18
- `@cursor/sdk`: 1.0.32
- plugin branch tracks the user fork `sdk-rewrite`

Validation plugin shim:

```js
export { default } from "file:///workspace/projects/opencode-cursor/dist/index.js";
```

Validation project has `"type": "module"`.

## Important commits

- `78e7d45` — start Cursor SDK rewrite
- `aa77fe1` — functional Cursor SDK provider core
- `a6853ac` — streaming and bridge lifecycle hardening
- `9e4963d` — repository cleanup / SDK architecture
- `73470e5` — transcript recovery when resume fails
- `79b8e31` — injectable SDK facade / fake-SDK proxy tests
- `1e3c523` — bridge concurrency and cancellation tests
- `43fc081` — SDK surface notes and diagnostics
- `32b60b3` — local review and live smoke harness
- `26191f4` — Cursor SDK cost deltas
- `9fc41d6` — cost telemetry docs
- `e6b52be` — initial handover
- `62e5860` — stop forcing unsupported Cursor local sandbox
- `96ac959` — prime model catalog before provider registration
- `f38b298` — already-authenticated Cursor SDK login handling
- `da0ce94` — interim documented context table; later superseded
- `b7230da` — defer context management / expose SDK parameters
- `303092c` — restrict OpenCode variants to reasoning controls

## Verified live behavior already completed

These have already consumed real Cursor/backend usage. Do not repeat them just for confidence.

### SDK / provider

- Cursor SDK authentication was confirmed live.
- `Cursor.models.list()` returned a real catalog (41 models at the time).
- Direct SDK smoke succeeded with `SDK_SMOKE_OK`.
- Direct SDK usage events returned real input/output/cache/reasoning token data.
- Real OpenCode -> plugin -> proxy -> official SDK -> Cursor inference succeeded:

```text
> build · composer-2.5
OPENCODE_CURSOR_OK
```

### Agent modes

The user manually verified:

- Build mode works.
- Plan mode works.

### Tool execution and permission boundary

Normal OpenCode tool execution works through the custom-tool bridge. A simple edit after restoring normal permissions successfully used OpenCode's Edit tool and modified the target file.

A dedicated permission-deny test was run on a fresh OpenCode server on port 4097 with both global and build-agent permissions explicitly denying `edit` and `bash`.

Cursor attempted several read/search/Code Mode paths but the file remained:

```text
ORIGINAL
```

So the OpenCode permission boundary held. Cursor did not bypass denied edit/bash permissions.

This is an important successful security test.

## Known tool-routing efficiency issue

Although tool execution is functionally correct, simple filesystem tasks currently use too many calls.

Observed normal edit trace after permissions were restored included roughly:

- an invalid Glob attempt
- Read
- Grep
- Edit
- Read
- Bash verification
- another Grep

During the denied test Cursor also tried `execute` and repeatedly searched the Code Mode tool catalog for a write path.

The likely cause is that `src/prompt.ts` injects OpenCode's `# Code Mode` section into Cursor's primary prompt. This can bias Cursor toward the `execute/search` orchestration path even when direct OpenCode read/edit/bash tools are already available.

The current uncommitted patch adds explicit routing guidance:

- prefer direct OpenCode read/edit/bash for ordinary filesystem/shell work;
- do not glob/grep merely to rediscover an exact path already provided;
- use `execute` for connected MCP orchestration or when no direct tool fits;
- verify a simple mutation at most once unless ambiguous.

It also adds an `execute` tool description hint that it is not the preferred path for ordinary filesystem/shell work.

This patch has local unit coverage, but the efficiency improvement itself has **not** been live-validated after the patch because live Cursor inference should now be avoided unless the user authorizes it.

## Usage reporting issue and uncommitted fix

The user reported that OpenCode currently does not show/report Cursor usage reliably.

Committed behavior before the current patch had two weaknesses:

1. streamed cumulative Cursor usage events could overwrite earlier per-boundary deltas instead of accumulating them;
2. if the stream ended without a final explicit usage event, the proxy could emit no usage even though `Run.usage` was available after completion.

The current uncommitted patch changes this by:

- adding `addUsage()` to accumulate per-boundary usage deltas;
- using `Run.usage` as a fallback at the completion boundary;
- preserving `bridge.lastUsage` so parked/resumed tool turns do not double-count;
- restoring the missing `costBaseline` field on the steer/reopen bridge path.

New fake-SDK integration coverage added in the working tree verifies:

- cumulative stream usage events collapse to one correct final OpenAI usage object;
- `Run.usage` supplies usage when the stream omits usage events;
- usage before and after a parked custom-tool boundary is split correctly without double counting.

Targeted fake-SDK usage tests passed. No new live Cursor inference was used for these tests.

One additional thing for the next agent to check locally: confirm OpenCode 2.0.18's OpenAI-compatible streaming adapter actually surfaces the final SSE `usage` event to its session accounting/UI. The proxy wire format already sends usage on the final chunk. This can be tested with a local fake endpoint; do not use Cursor inference.

## Context-window policy requested by the user

The user explicitly changed the context policy to:

```text
SDK-provided context limit, when the official SDK exposes one
    ->
known documented per-model fallback
    ->
0 for unknown/new models
```

Important details:

- `@cursor/sdk` 1.0.32's public `SDKModel = ModelListItem` type currently contains:
  - id
  - displayName
  - description
  - aliases
  - parameters
  - variants
- It does **not** currently expose a typed context-window field.
- The uncommitted mapper probes plausible future SDK fields such as `contextWindow`, `contextLength`, etc. If one is a positive number, it wins.
- Otherwise it uses the explicit documented fallback map.
- Unknown/new models remain `0`, which disables OpenCode-side overflow compaction rather than inventing a fake limit.
- Cached models with old `contextWindow: 0` are backfilled from the known fallback table on cache read, while any already-discovered positive value is preserved.

The context table was checked against the current official Cursor model index and individual model pages on 2026-09-28. The Sonnet 4.6 ID was corrected to the documented `claude-4-6-sonnet`. Do not infer missing values from provider marketing pages or unrelated APIs.

The old blanket 200k behavior must not return.

## Thinking / variants

The duplicate Thinking-menu problem was fixed in committed HEAD `303092c`.

Root cause was treating all Cursor SDK model parameters as OpenCode variants, while OpenCode renders variants as the Thinking selector.

Current committed behavior:

- only reasoning/thinking/effort-like parameters become OpenCode variants;
- unrelated parameters such as fast/context/optimize_for/router controls do not appear in Thinking;
- preset variants can still define the SDK default selection;
- reasoning variants preserve unrelated default SDK params;
- variants are deduplicated by reasoning selection.

Unit coverage exists for this behavior.

If the user reports another malformed Thinking menu, inspect the authenticated raw `Cursor.models.list()` parameter/variant shape first. Do not special-case model names unless unavoidable.

## Session handling

Normal primary sessions persist the Cursor `agentId`.

On a subsequent turn:

- `Agent.resume()` is attempted;
- normal resumed turns send only the latest user content;
- if resume fails, the plugin falls back to transcript reconstruction via `recoveryPrompt()`.

This is why Cursor, not OpenCode transcript replay, normally owns durable conversation state.

Fake-SDK session-resume tests pass.

A real live resume test is still useful eventually, but do not run it now without explicit user approval because it consumes Cursor inference usage.

## Media

Local/unit conversion coverage exists for:

- data URL images;
- image content returned by tools;
- SDK user image input conversion.

Real image inference has not been completed end-to-end through OpenCode. It is an optional final live test and requires user approval because it consumes Cursor usage.

PDF input is intentionally not advertised as a verified capability.

## Cancellation

Fake-SDK HTTP stream cancellation coverage passes and confirms disconnect -> active Cursor run cancellation.

A real backend cancellation test remains optional final live validation and should not be run without user approval.

## Ambient Cursor config isolation

The architecture sets:

```ts
local: {
  cwd,
  settingSources: [],
  customTools,
}
```

A fake-SDK integration test now sends a request from a project with a deliberately malformed `.cursor/mcp.json` and asserts the plugin passes `settingSources: []` to the SDK. This verifies the plugin's options and request path. It does not exercise the real SDK's settings loader.

Do not use a real Cursor request for this unless the local test cannot prove the behavior.

## Compliance

First-party runtime must use only official/documented integration surfaces.

The compliance scanner rejects reintroduction of:

- hardcoded private Cursor backend hostname;
- private `AgentService` / RPC names;
- private model RPC names;
- generated Cursor protobuf runtime transport;
- old H2 bridge;
- plugin-owned PKCE/auth implementation.

It is fine if the official SDK internally reports or uses its own backend URL; do not treat SDK internals/runtime metadata as first-party plugin hardcoding.

Do not scan `node_modules` as if SDK internals were plugin-owned implementation.

## Test status

Before the latest uncommitted follow-up patch:

- full build/test suite was green;
- 39 tests passed;
- compliance tests were green in prior milestones.

After the latest patch, targeted suites were run using only fake/local SDK behavior:

- build succeeded;
- the proxy integration suite including new usage tests passed;
- targeted models + proxy tests passed (18/18 in that run);
- no new Cursor backend inference was used.

The final `npm run check` passed all 44 local tests, the strict TypeScript build, and the first-party private-API compliance scan. `npm pack --dry-run` and `git diff --check` also passed.

An offline probe of OpenCode 2.0.18's published `@opencode/ai` OpenAI-compatible adapter consumed a local fake final SSE usage chunk and returned 19 input, 7 output, 3 cached-input, and 2 reasoning tokens as expected. A full standalone CLI probe stalled during startup, so UI/session accounting is still unverified without live Cursor inference.

`npm audit` reports a high-severity `undici@5.29.0` advisory through `@cursor/sdk@1.0.32` -> `@connectrpc/connect-node@1.7.0`. The latest official SDK still uses this dependency and npm reports no compatible fix. An undici 6 override would cross the declared undici 5 major-version range; this was left unchanged.

Do not run `scripts/live-sdk-smoke.mjs` automatically; it uses real Cursor inference.

## Completed follow-up patch

The reviewed patch includes these changes:

Expected themes in the diff:

### `src/prompt.ts`
Adds tool-routing guidance to reduce unnecessary Code Mode/search calls.

### `src/tools.ts`
Marks `execute` semantically as an MCP orchestration fallback rather than a general filesystem/shell path.

### `src/usage.ts`
Adds usage accumulation helper.

### `src/proxy.ts`
Uses cumulative usage deltas plus `Run.usage` fallback and fixes `costBaseline` propagation in the steer/reopen branch.

### `src/models.ts`
Adds the requested context-window priority:
SDK value -> verified documented table -> 0.

Also includes cache migration/backfill behavior.

### tests
Adds/updates tests for:

- routing guidance;
- execute fallback description;
- usage accumulation;
- usage fallback from `Run.usage`;
- parked-tool usage boundaries;
- context fallback;
- future SDK context override.

## Pre-PR local completion

- Reviewed and finished the uncommitted usage, tool-routing, and context-window patch.
- Verified each context fallback against official Cursor model documentation and corrected the Sonnet 4.6 ID.
- Added an isolated cache migration test and a fake-SDK malformed ambient-settings test.
- Verified the final SSE usage shape through OpenCode 2.0.18's published OpenAI-compatible adapter against a local fake endpoint. The full CLI/session UI path remains unverified.
- `npm run check`: strict build, 44 tests, and compliance scan pass.
- `npm pack --dry-run` and `git diff --check`: pass.
- `npm audit`: unresolved transitive undici 5 advisory through the latest official Cursor SDK; see test status above.

The changes should be committed and pushed to the user fork branch `sdk-rewrite`, then stopped at the PR gate. No upstream PR or publication is authorized.

## Live tests that remain optional / user-authorized only

These consume Cursor inference and must not be run automatically:

- real persistent `Agent.resume()` across OpenCode turns;
- real image input;
- real backend cancellation;
- post-fix tool-routing efficiency check;
- post-fix usage display check through a real Cursor request;
- one final end-to-end smoke test.

Build mode, Plan mode, real text inference, real tool execution, and permission enforcement have already been validated and should not be repeated merely for confidence.

## Useful validation project state

Validation path:

`/workspace/projects/opencode-cursor-validation`

The project config was restored after the permission test to:

```json
{
  "$schema": "https://opencode.ai/config.json"
}
```

A separate test server on port 4097 was used during permission validation. Do not assume it is still running.

The persistent OpenCode server on port 4096 may still exist and may have been started from a different cwd. If interacting with it later, check its cwd first rather than killing/restarting it blindly.

## Final hard stop

No PR exists.

Passing tests, successful live inference, or maintainer comments do not authorize a PR.

Only explicit user authorization such as “create the PR” permits PR creation or an upstream implementation push.
