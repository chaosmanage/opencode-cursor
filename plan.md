# OpenChamber Cursor SDK Rewrite — Implementation Plan

## Status
- Planning document only.
- Target integration: official `@cursor/sdk`.
- Primary objective: replace the current private/direct Cursor protocol integration with documented Cursor SDK surfaces.
- Secondary objective: align OpenCode-facing architecture and behavior with `@openchamber/opencode-claude`.
- Security objective: Cursor reasons; OpenCode remains the sole tool execution and permission authority.
- Migration objective: preserve the strongest reliability/security ideas from the private ACP prototype without carrying over ACP transport complexity.
- Publication rule: **no pull request may be created until the user explicitly authorizes PR creation.**

## Success criteria
The rewrite is considered implementation-complete only when all of the following are true:
1. No plugin-owned Cursor OAuth/PKCE, private RPC calls, generated private protobufs, or direct private Cursor API endpoints remain.
2. Authentication is performed only through official Cursor SDK auth surfaces and the SDK-owned credential store.
3. Model discovery uses the official SDK catalog and maps account-visible variants/parameters into OpenCode.
4. Normal chat, plan mode, streaming, thinking, images, tool calls, tool results, cancellation, and session resume work end-to-end.
5. Cursor native shell/edit/write authority is not exposed in the default integration.
6. OpenCode permissions remain authoritative for every executable tool action.
7. Usage/token/cost data exposed by the SDK is normalized into OpenCode/OpenAI-compatible responses where possible.
8. Local unit, integration, live SDK, OpenCode end-to-end, security, regression, and stress tests pass.
9. Known SDK limitations are documented instead of filled with private APIs or dashboard scraping.
10. The implementation is reviewed locally before any upstream PR work begins.

## Non-goals
- Do not reproduce Cursor's private backend protocol.
- Do not scrape Cursor's web dashboard for quota/plan percentages.
- Do not parse, copy, export, refresh, or persist Cursor SDK credentials ourselves.
- Do not recreate ACP JSON-RPC/NDJSON transport inside the SDK version.
- Do not keep a loopback MCP HTTP server if SDK custom tools can replace it.
- Do not promise a native SDK `ask` mode when the SDK only supports agent/plan.
- Do not preserve a separate Cursor `fullAuthority` mode; unrestricted execution belongs to OpenCode's permission system.
- Do not depend on undocumented model metadata, hidden endpoints, or reverse-engineered headers.
- Do not make version-number assumptions for the eventual release.
- Do not create or publish a PR, including a draft PR, before explicit authorization.

## Target architecture

```text
OpenCode / OpenChamber
        |
        | OpenAI-compatible provider requests
        v
local loopback Cursor proxy
        |
        | request classification, prompt conversion,
        | session mapping, tool parking/resume,
        | usage/error normalization
        v
@cursor/sdk
        |
        v
Cursor hosted agent/inference
```

### Architectural parity with opencode-claude
The Cursor implementation should deliberately mirror the Claude plugin at the OpenCode-facing layer:
- provider registration through the OpenCode 2 plugin API;
- local OpenAI-compatible proxy;
- per-request model/session/directory metadata;
- dynamic model catalog refresh and cache;
- request classification for normal vs utility/meta requests;
- session persistence and vendor-session mapping;
- parked turns for OpenCode tool execution;
- interruption cleanup and parked-turn reaping;
- grouped/parallel tool-call settling;
- attachment/media translation;
- usage normalization;
- rate-limit/error translation;
- durable debug logging;
- selective forwarding of OpenCode Code Mode context.

Cursor-specific differences should be isolated behind small modules:
- SDK authentication instead of Claude CLI authentication;
- `Cursor.models.list()` instead of Claude supported-model discovery;
- Cursor `agentId`/resume semantics instead of Claude session IDs;
- Cursor model variants/parameters instead of Claude effort-only variants;
- Cursor native `agent` / `plan` modes;
- SDK custom tools for the OpenCode tool bridge;
- Cursor SDK usage and error event shapes.

## Phase 0 — Establish the exact supported surface

### Objective
Freeze assumptions before implementation so no design depends on stale SDK docs or inferred behavior.

### Tasks
1. Check out the current `openchamber/opencode-cursor` source locally without publishing changes upstream.
2. Check out/read the current `openchamber/opencode-claude` implementation as the architectural reference.
3. Install the latest supported `@cursor/sdk` in an isolated probe project and record the exact resolved version.
4. Verify its Node engine requirement and confirm the OpenCode runtime can satisfy it.
5. Inspect exported TypeScript types for:
   - `Cursor` construction/configuration;
   - `auth.login/status/logout`;
   - `models.list()`;
   - `Agent.create()`, resume/open equivalents, and one-shot prompting;
   - run streaming iteration/events;
   - `local.customTools`;
   - built-in `tools` / `disallowedTools`;
   - `local.settingSources`;
   - images/attachments;
   - usage events and `Agent.getUsage()`;
   - rate-limit and provider error classes;
   - cancellation/abort behavior.
6. Verify experimentally that custom tools remain available when built-in tools are disabled.
7. Verify experimentally that omitting/emptying setting sources prevents ambient `.cursor` tool/MCP loading.
8. Verify the exact SDK login UX in the OpenCode host environment.

### Required decisions from Phase 0
- Exact SDK version range to pin.
- Minimum Node version for the package.
- Exact method used to disable all Cursor-native executable tools while retaining custom OpenCode tools.
- Exact custom-tool input schema and result format.
- Exact cancellation mechanism for a running/parked agent turn.
- Whether SDK auth can be initiated cleanly from OpenCode's integration UI or should be exposed as an SDK-owned sign-in action/instruction.
- Exact model/variant metadata that can be represented in OpenCode without invented values.
- Exact image formats accepted by the SDK.
- Whether PDF is directly supported; if not, do not advertise PDF capability.
- Which usage fields are authoritative per event, per run, and per agent.

### Deliverables
- `docs/sdk-surface-notes.md` or equivalent local research notes.
- Small executable SDK probes covering auth status, models, tool restrictions, streaming, session resume, usage, and cancellation.
- A capability matrix containing only behavior verified against the installed SDK version.

### Exit criteria
Do not start the main proxy implementation until the tool-restriction and custom-tool interaction are proven locally. If OpenCode cannot remain the exclusive execution authority with the SDK, stop and reassess the SDK approach rather than weakening this invariant.

## Phase 1 — Project/runtime migration scaffold

### Objective
Move the project onto the same general OpenCode 2/plugin shape as `opencode-claude` before replacing inference behavior.

### Tasks
1. Update the plugin runtime dependency to the OpenCode 2 package used by the current Claude plugin unless a newer compatible version is required.
2. Add `@cursor/sdk` as the only Cursor service integration dependency.
3. Remove runtime dependency assumptions tied to protobuf/Connect/private transport from the new code path.
4. Set package Node engine to the minimum required by the Cursor SDK.
5. Preserve the public package/provider identity so existing OpenCode configuration does not unnecessarily change.
6. Introduce a Claude-like source layout:
   - `constants.ts`
   - `index.ts`
   - `sdk.ts`
   - `sdk-login.ts`
   - `models.ts`
   - `model-selection.ts`
   - `session-store.ts`
   - `request-kind.ts`
   - `prompt.ts`
   - `tools.ts`
   - `bridge-pool.ts`
   - `usage.ts`
   - `rate-limit.ts`
   - `failure.ts`
   - `log.ts`
   - `proxy.ts`
7. Keep legacy code temporarily available only as a reference until equivalent SDK functionality passes tests.
8. Add a feature-local SDK abstraction so tests can inject a fake SDK without network access.
9. Add deterministic interfaces around model listing, auth state, agent creation/resume, streaming, custom tools, usage, and cancellation.
10. Ensure package build emits no private Cursor protocol runtime files.

### Exit criteria
- TypeScript builds.
- Plugin loads under OpenCode 2 with a placeholder/local provider.
- SDK wrapper can be mocked completely in tests.
- No legacy code has been deleted yet unless it is already provably unused.

## Phase 2 — SDK-owned authentication

### Objective
Replace plugin-owned OAuth/PKCE and token lifecycle with the official Cursor SDK authentication surface.

### Security rules
- Never read `~/.cursor/sdk/auth.json` directly.
- Never copy the SDK API key into OpenCode auth storage.
- Never create our own Cursor OAuth URL, PKCE verifier, refresh token, or token exchange.
- Never log SDK credentials or auth response internals.
- Treat the SDK's auth status as authoritative.

### Tasks
1. Implement a small `sdk-login.ts` wrapper around documented SDK auth methods only.
2. Add an OpenCode integration method that invokes the official SDK login flow or gives exact official login instructions when host UX cannot relay it safely.
3. After successful SDK auth, return only a non-secret OpenCode sign-in marker if OpenCode requires an integration credential record.
4. Make that marker unusable as a Cursor credential, analogous to the Claude plugin's CLI sign-in marker.
5. Implement auth-status detection through the SDK, not through credential-file inspection.
6. Expose logout only through the SDK's documented logout call.
7. Ensure auth failures are mapped to actionable OpenCode errors without leaking tokens.
8. Verify repeat sign-in, already-signed-in, expired/revoked key, logout, and re-login flows.
9. Verify plugin restart discovers SDK auth state without OpenCode owning the key.
10. Add redaction tests for likely Cursor key/token patterns and generic Authorization headers.

### Exit criteria
A user can authenticate, restart OpenCode, use Cursor, logout, and reauthenticate while plugin code never reads or persists the actual credential.

## Phase 3 — Official model catalog and OpenCode provider registration

### Objective
Replace private `AvailableModels` / `GetUsableModels` discovery and heuristic normalization with the SDK model catalog.

### Tasks
1. Implement `models.ts` on top of `Cursor.models.list()`.
2. Preserve the exact stable model identifiers returned by the SDK whenever possible.
3. Map display name, description, aliases, variants, and supported parameters from documented SDK fields.
4. Do not infer context windows, output limits, pricing, image support, or reasoning support from tooltips/private payloads unless the SDK explicitly exposes those fields.
5. Where OpenCode requires a limit the SDK does not provide, choose a conservative documented/fallback behavior and mark it clearly in code/docs.
6. Map SDK model variants/parameters into OpenCode variants only when the mapping is deterministic.
7. Keep agent mode separate from model variants; do not represent `plan` as a fake model.
8. Cache the last successful account-visible catalog on disk for fast startup.
9. Refresh the catalog periodically and after login.
10. Reload the OpenCode provider only when the normalized catalog actually changes.
11. On transient discovery failure, retain the last known good catalog rather than deleting models mid-session.
12. Provide a minimal bootstrap/fallback only if OpenCode requires at least one model before discovery; never fabricate a broad static catalog.

### Provider registration
Mirror the Claude plugin's OpenCode-facing pattern:
1. Register a provider with the existing Cursor provider ID/name.
2. Point it at the local loopback OpenAI-compatible proxy.
3. Use a non-secret local placeholder API key only if the OpenAI-compatible adapter requires one.
4. In the `model.request` hook:
   - ensure the proxy is running;
   - replace base URL with the live loopback URL;
   - attach selected Cursor model/variant metadata;
   - attach request kind;
   - attach project directory;
   - attach OpenCode session ID.
5. Advertise capabilities only after verification:
   - tools: yes once bridge works;
   - text input: yes;
   - image input: only after live validation;
   - PDF: only if directly supported and tested;
   - text output: yes.
6. Keep the local proxy on an ephemeral loopback port by default.
7. Allow an optional pinned port only for debugging/operational compatibility.

### Tests
- catalog normalization;
- aliases/duplicate handling;
- variant mapping;
- stale-cache fallback;
- refresh deduplication;
- transient SDK failure;
- login-triggered refresh;
- provider reload only on actual catalog change;
- selected model/variant reaches the proxy unchanged.

### Exit criteria
OpenCode's model picker is driven by the official SDK catalog and survives temporary discovery failures without private API fallbacks.

## Phase 4 — Minimal local proxy and text-only inference

### Objective
Get one normal OpenCode text request through the local proxy and official SDK before adding tools or attachments.

### Tasks
1. Implement loopback-only HTTP server with:
   - `GET /health`;
   - `GET /v1/models`;
   - `POST /v1/chat/completions`.
2. Bind to `127.0.0.1` only.
3. Reject requests with non-loopback Host values or browser `Origin` headers to reduce loopback abuse/DNS-rebinding risk.
4. Disable ordinary server idle timeout so long reasoning pauses do not reset OpenCode connections.
5. Add SSE heartbeats while a live SDK run is silent.
6. Parse the OpenAI-compatible request into a narrow internal request type.
7. Resolve requested model/variant from trusted provider headers/body.
8. Create an SDK agent with:
   - correct project cwd;
   - selected model/variant;
   - correct mode;
   - no ambient setting sources;
   - no Cursor-native executable tools.
9. Send the latest user turn and consume SDK streaming events.
10. Translate text deltas into OpenAI SSE chunks.
11. Translate thinking/reasoning only into fields OpenCode can safely consume; otherwise keep it internal/debug-only.
12. End with a valid OpenAI-compatible finish event and `[DONE]`.
13. Implement non-stream response support only if OpenCode or tests require it.
14. Add a per-turn stall watchdog and clean cancellation.
15. Ensure SDK errors produce real HTTP error responses rather than fake successful assistant text.

### Exit criteria
A text-only OpenCode request can select a Cursor model, stream a response, cancel cleanly, and report real errors using only the SDK.

## Phase 5 — Conversation/session mapping and request classification

### Objective
Preserve Cursor conversation continuity without replaying unnecessary history or mixing OpenCode sessions.

### Session tasks
1. Create a `session-store.ts` mapping from OpenCode session/conversation key to Cursor `agentId`.
2. On the first normal turn, create an agent and persist the returned agent ID in process-local/session storage.
3. On subsequent turns, resume/open that exact agent ID.
4. Detect foreign/stale/missing agent IDs and recover by starting a fresh agent without corrupting another session.
5. Never share an agent across different OpenCode session IDs.
6. Carry project directory separately from session identity.
7. If the selected model changes and Cursor requires agent recreation, document and implement deterministic behavior.
8. Clean abandoned mappings when sessions are interrupted, expired, or the proxy shuts down.
9. Avoid persisting secrets in the session store.
10. Add tests for concurrent sessions, same-session continuation, restart behavior, stale IDs, and model switches.

### Request classification tasks
Classify OpenCode requests before agent creation:
- normal conversational turn;
- title generation;
- compaction/summary;
- generic generate/utility request;
- structured-output helper if OpenCode emits one;
- tool-result continuation;
- plan-mode conversational turn.

### Utility/meta request policy
1. Utility requests must not accidentally resume the user's main workspace agent.
2. They must run as isolated, tool-less one-shot SDK calls.
3. Use a small/appropriate model only if Cursor exposes a documented model choice; otherwise use the requested model.
4. Provide a narrow utility instruction asking for only the requested output.
5. Do not load ambient project Cursor settings.
6. Do not expose OpenCode tools.
7. Do not mutate the normal session's Cursor agent ID.
8. Keep title/compaction failures non-fatal to the main conversation where OpenCode permits.
9. Add classifier regression tests using real OpenCode request shapes from the Claude/Cursor plugins.

### Exit criteria
Normal sessions resume correctly, unrelated OpenCode sessions remain isolated, and meta requests never become agentic workspace turns.

## Phase 6 — OpenCode-owned tool bridge via SDK custom tools

### Objective
Expose OpenCode's requested tools to Cursor for reasoning while ensuring every actual tool execution remains inside OpenCode's permission/execution path.

### Core invariant
The SDK integration must never translate an OpenCode tool into direct local shell/filesystem execution by Cursor. Cursor may choose and parameterize a tool, but OpenCode must receive the tool call, apply its own permissions, execute it, and return the result.

### Tool-definition tasks
1. Read the `tools` array from each OpenAI-compatible request.
2. Convert each OpenAI function definition into an SDK custom tool using the exact verified SDK schema.
3. Preserve:
   - stable tool name;
   - description;
   - JSON argument schema;
   - required/optional properties.
4. Validate names against Cursor SDK restrictions and create a reversible name map if sanitization is required.
5. Do not expose any tool not present in the current OpenCode request.
6. Disable Cursor-native built-in executable tools in the agent configuration.
7. Keep ambient setting sources disabled so project/user Cursor MCP servers do not appear implicitly.
8. Do not add arbitrary `.cursor/mcp.json` servers to the SDK agent.
9. Add a test asserting that a prompt cannot invoke shell/edit/write unless OpenCode explicitly supplied a corresponding tool.

### Parking/resume design
When Cursor invokes an SDK custom tool:
1. Allocate a stable OpenAI tool-call ID.
2. Record tool name and serialized arguments.
3. Create a deferred Promise owned by a `ParkedToolCall`.
4. Signal the proxy stream that a tool call is pending.
5. Keep the SDK custom-tool callback awaiting that Promise; do not execute the tool locally.
6. Allow all tool calls belonging to the same assistant step to arrive.
7. After the settle window, emit them to OpenCode as OpenAI `tool_calls`.
8. Close/finish the current HTTP response in the exact form OpenCode expects for a tool step.
9. Keep the underlying SDK run logically parked on the deferred tool callbacks.
10. Store that live run in a `ParkedBridge` keyed by OpenCode conversation/session identity.
11. On the next OpenCode request, collect `role: tool` messages by `tool_call_id`.
12. Match each result to the pending deferred callback.
13. Convert the OpenCode tool result into the exact SDK custom-tool result shape.
14. Resolve the deferred Promise(s).
15. Continue consuming the same SDK run and stream the next assistant output.
16. Delete the bridge when the run finishes or fails.

The implementation should reuse the conceptual parked-turn machinery from `opencode-claude`, adapted to Cursor SDK handles/events.

### Parallel tool calls
1. Do not immediately return on the first custom-tool invocation.
2. Maintain a short settle/debounce window, initially modeled on Claude's 300 ms behavior.
3. Group tool calls announced as part of the same assistant step.
4. Return the full safe parallel group to OpenCode in one assistant response when possible.
5. Ensure results may arrive in any order.
6. Resume only the matching deferred callbacks.
7. Prevent duplicate execution if OpenCode retries a continuation request.
8. Deduplicate repeated tool-call IDs and repeated result IDs.
9. Add tests for:
   - one tool;
   - two parallel tools;
   - many parallel tools;
   - delayed sibling tool call;
   - out-of-order results;
   - duplicate result;
   - missing result;
   - one failed tool among successful siblings.

### Bridge lifecycle
Each parked bridge should track:
- bridge ID;
- OpenCode conversation/session key;
- Cursor agent/run handle;
- pending tool map;
- reported usage state;
- optional forwarded steering-message IDs;
- creation/last-activity timestamps;
- cancellation/closed state;
- continuation stream handle if the SDK requires one.

### Cancellation, reaping, and recovery
1. Watch OpenCode session interruption/failure events and immediately close matching parked bridges.
2. Reject unresolved custom-tool Promises on shutdown, supersede, or timeout.
3. Add a configurable parked-turn TTL; default conservatively and document it.
4. Add a turn-stall watchdog for SDK streams that stop producing events indefinitely.
5. If a continuation arrives after a parked turn was reaped, rebuild safely from the OpenCode transcript rather than silently dropping the result.
6. Make bridge deletion idempotent.
7. Ensure proxy shutdown clears all bridges.
8. Add memory-pressure protections and a maximum active-bridge limit if load testing shows a need.
9. Log bridge lifecycle events in debug mode without logging secrets/tool result bodies by default.

### Exit criteria
Tool calls round-trip through OpenCode permissions/execution, including parallel groups and cancellation, with no direct Cursor-native execution path.

## Phase 7 — Prompt translation, Code Mode, steering, and tool-result media

### Objective
Match the mature prompt/session behavior of `opencode-claude` while preserving Cursor SDK semantics.

### Tasks
1. Build an explicit OpenAI-message → Cursor SDK prompt translator.
2. Include every relevant user message, not only the last string, when reconstructing a turn.
3. Preserve assistant/tool-result sequencing needed for continuation recovery.
4. Extract OpenCode's `# Code Mode` section and forward only that catalog/instruction slice where needed.
5. Do not forward the entire OpenCode system prompt by default.
6. Avoid relying on Cursor SDK system-prompt replacement if it is account-gated or unavailable.
7. Add runtime instructions in user/context content only when required and clearly scoped.
8. Support mid-turn/queued steering messages if OpenCode can send them while a turn is parked.
9. Deduplicate steering messages so retries do not inject them twice.
10. Convert tool-result text plus image/file media into the SDK-supported tool-result/input representation.
11. Handle OpenCode's synthetic promoted-media messages so media associated with tool results is not lost.
12. Preserve structured tool-result errors distinctly from successful text results.
13. Add prompt regression fixtures copied from real OpenCode request shapes.

### Exit criteria
Normal history, Code Mode catalog, steering, and tool-result media survive conversion without giving Cursor hidden authority or duplicating context.

## Phase 8 — OpenCode agent mode ↔ Cursor mode synchronization

### Objective
Map OpenCode behavior to Cursor's documented `agent` and `plan` modes without inventing unsupported SDK modes.

### Tasks
1. Capture OpenCode session/context agent state through the plugin hooks.
2. For normal/build/default agent work, use Cursor `mode: "agent"`.
3. For OpenCode Plan agent work, use Cursor `mode: "plan"`.
4. Keep mode separate from model/variant selection.
5. Detect mode changes within a session and determine whether the SDK allows mode mutation or requires agent recreation.
6. Preserve session continuity where safe; otherwise recreate deterministically and document the boundary.
7. Do not expose ACP `ask` as a fake SDK mode.
8. Implement title/compaction/generate as isolated tool-less utility calls rather than Ask mode.
9. Remove or deprecate ACP-style `fullAuthority` behavior from the SDK architecture.
10. If users want unrestricted tools, rely on OpenCode's permission configuration rather than giving Cursor a second authority system.

### Tests
- build/default → agent;
- plan → plan;
- plan→agent transition;
- agent→plan transition;
- utility request ignores conversational mode;
- model variant and mode do not overwrite each other.

## Phase 9 — Images, attachments, and multimodal parity

### Objective
Reach practical input/media parity with the Claude plugin wherever Cursor's SDK actually supports it.

### Tasks
1. Verify accepted SDK image input types and transport forms using live probes.
2. Map OpenCode image parts into those exact SDK input types.
3. Preserve MIME type and filename metadata when the SDK accepts them.
4. Reject unsupported media with an explicit provider error instead of silently dropping it.
5. Verify image handling for:
   - direct user attachments;
   - images returned by OpenCode tools;
   - multiple images in one turn;
   - image plus text;
   - image after a parked tool continuation.
6. Verify size limits and surface useful SDK errors.
7. Add PDF support only if the SDK documents and successfully handles it in the installed version.
8. If PDF is unsupported, do not advertise `pdf` in OpenCode provider capabilities and document the difference from `opencode-claude`.
9. Prevent attachment bytes/base64 from entering normal debug logs.
10. Add fixture-based tests with tiny deterministic media samples.

### Exit criteria
Every advertised media capability is live-tested; unsupported types fail visibly instead of being advertised optimistically.

## Phase 10 — Usage, cost, rate limits, and quota semantics

### Objective
Use all documented SDK telemetry without misrepresenting plugin-local usage as account-wide plan usage.

### Usage tasks
1. Normalize SDK usage events into OpenAI-compatible usage fields where possible:
   - input tokens;
   - output tokens;
   - cache read tokens;
   - cache write tokens;
   - reasoning tokens when representable.
2. Track cumulative run usage and emit only deltas when OpenCode resumes a parked turn, preventing double counting.
3. Deduplicate replayed/resent SDK usage messages using stable message/run identifiers where available.
4. At run completion, reconcile streaming totals with authoritative final run usage.
5. Use `Agent.getUsage()` when appropriate to obtain documented raw/charged cost information.
6. Keep token usage and billing cost as separate concepts.
7. Never infer monthly remaining percentage from local SDK runs.
8. Never label local accumulated usage as total Cursor account usage.

### Rate-limit tasks
1. Classify documented Cursor SDK rate-limit errors.
2. Preserve any documented reset/retry metadata exposed by the SDK.
3. Return appropriate HTTP status codes to OpenCode instead of embedding provider errors in assistant text.
4. Keep a process-local rate-limit snapshot only from documented SDK error/event data.
5. Add health/status output for:
   - currently limited or not;
   - known retry/reset timestamp if SDK supplies it;
   - latest local-agent usage/cost summary.
6. Explicitly state that authoritative monthly plan percentage/reset information is unavailable unless Cursor later adds an official SDK/API surface.
7. Do not scrape Cursor dashboard pages or call undocumented billing endpoints.

### Tests
- usage on normal response;
- usage across tool parking/resume;
- duplicate/replayed usage event;
- cache token fields;
- reasoning token fields;
- raw cost vs charged cost;
- rate-limit error mapping;
- missing reset metadata;
- no fabricated monthly quota values.

### Exit criteria
OpenCode receives accurate per-turn/session usage and documented cost/rate-limit information without making unsupported account-quota claims.

## Phase 11 — Failure mapping, logging, and operational hardening

### Objective
Make failures observable, actionable, and safe without leaking credentials or silently degrading into private fallbacks.

### Failure mapping
1. Create `failure.ts` to classify:
   - authentication required/expired;
   - model unavailable;
   - invalid model/variant;
   - rate limited;
   - usage cap reached;
   - bad request;
   - unsupported media;
   - custom-tool/schema failure;
   - SDK transport/service failure;
   - cancellation;
   - internal plugin failure.
2. Map each class to:
   - correct HTTP status;
   - OpenAI-compatible error type/code;
   - concise user-facing hint;
   - debug-safe internal diagnostic.
3. Never convert a provider refusal/error into a successful assistant response.
4. Never silently retry through the legacy private protocol.
5. Retry only clearly transient/idempotent operations and cap retry attempts.

### Logging
1. Port the Claude plugin's durable debug-log pattern.
2. Keep debug logging opt-in through plugin options/environment.
3. Include:
   - request kind;
   - OpenCode session ID hash/short form;
   - selected model/variant;
   - Cursor agent ID hash/short form;
   - mode;
   - bridge lifecycle;
   - event types;
   - usage summaries;
   - timing/stall information;
   - classified errors.
4. Redact:
   - Authorization headers;
   - API keys/tokens;
   - SDK auth records;
   - prompt bodies by default;
   - tool result bodies by default;
   - image/base64 payloads;
   - sensitive environment values.
5. Add redaction unit tests and log snapshots.

### Reliability controls
- SSE heartbeat;
- turn stall timeout;
- parked-turn TTL;
- bounded bridge count if needed;
- graceful shutdown;
- per-session supersede behavior;
- idempotent cleanup;
- catalog refresh timeout;
- auth/model probes never block plugin startup indefinitely.

### Exit criteria
Known failure classes behave deterministically and no sensitive data appears in normal/debug logs.

## Phase 12 — Compliance/security guardrails inherited from ACP

### Objective
Convert the ACP prototype's strongest security ideas into permanent automated constraints.

### Static compliance guard
Add a script/test such as `scripts/verify-no-private-cursor-api.mjs` scanning first-party source and built output (not `node_modules`) for prohibited implementation patterns.

At minimum flag unexpected occurrences of:
- `api2.cursor.sh`;
- `agent.v1.AgentService`;
- private RPC method paths;
- generated Cursor protobuf imports/files;
- `@connectrpc/*` added for Cursor transport;
- `@bufbuild/protobuf` added for Cursor transport;
- plugin-owned PKCE/OAuth token exchange endpoints;
- direct Cursor credential-file parsing;
- legacy H2 bridge filenames/imports;
- old private `AvailableModels`, `GetUsableModels`, `NameAgent` routes.

Allow narrow comments/test fixtures only through explicit reviewed exceptions if ever necessary.

### Runtime security tests
1. Built-in Cursor shell/edit/write tools are absent by default.
2. Ambient Cursor MCP/settings are not loaded by default.
3. Only tools provided by the current OpenCode request are visible.
4. A tool cannot execute before OpenCode returns a tool result.
5. Tool-call arguments cannot bypass OpenCode permission handling.
6. Loopback proxy rejects browser Origin requests.
7. Loopback proxy rejects non-loopback Host values.
8. Credentials never enter provider headers sent by OpenCode to localhost.
9. SDK-owned auth marker stored by OpenCode contains no usable Cursor secret.
10. Logs redact credentials and media payloads.
11. Session A cannot resume/use Session B's Cursor agent.
12. Utility/title/compaction calls cannot access normal conversational tools.

### Exit criteria
Security/compliance tests fail closed and become mandatory in the normal test command/CI.

## Phase 13 — Remove the legacy private integration

### Objective
Delete the old transport/auth stack only after equivalent SDK paths are covered by tests.

### Candidate removals
Once no longer referenced and replacement behavior is passing:
- `src/cursor-rpc.ts`;
- `src/h2-bridge.mjs`;
- `src/h2-bridge-persistent.mjs`;
- generated `src/proto/agent_pb.ts`;
- private RPC fixtures/helpers;
- plugin-owned OAuth/PKCE/token refresh code;
- credential manager code that stores usable Cursor credentials in OpenCode;
- private AvailableModels/GetUsableModels normalizers;
- private NameAgent handling;
- direct API bridge pooling tied to the old protocol;
- old private pricing/model heuristics no longer supported by SDK metadata.

### Migration discipline
1. Delete one legacy subsystem at a time.
2. Run focused tests after each deletion.
3. Keep behavior-level tests, rewrite implementation-level tests.
4. Do not retain dead compatibility shims that can accidentally reactivate private transport.
5. Remove no-longer-needed dependencies from `package.json` and lockfiles.
6. Verify the published package file list cannot include the generated proto/H2 bridge accidentally.
7. Update description/keywords that currently advertise direct API/native OAuth behavior.
8. Search the entire first-party tree and dist output for stale private endpoint/protocol references.

### Exit criteria
The package has exactly one Cursor integration path: `@cursor/sdk`.

## Phase 14 — Documentation and user-facing behavior

### README topics
1. What the plugin does and supported OpenCode versions.
2. Requirement for a Cursor account/plan and SDK-supported Node runtime.
3. Authentication:
   - official Cursor SDK flow;
   - SDK-owned credential store;
   - OpenCode stores no usable Cursor key.
4. Architecture diagram.
5. Tool trust model: Cursor reasons, OpenCode executes.
6. Agent vs Plan mode mapping.
7. Model discovery and variants.
8. Images/attachments actually supported.
9. Usage/cost reporting:
   - per-run/session data available;
   - monthly account quota percentage not available through documented SDK APIs.
10. Troubleshooting auth, model discovery, rate limits, stalled sessions, and debug logging.
11. Security/compliance statement limited to factual architecture: only documented SDK surfaces are intentionally used.
12. Explicitly avoid claiming legal certification or guaranteeing ToS compliance.

### CHANGELOG
Document behavior changes such as:
- authentication ownership changes;
- removal of private/direct RPC;
- SDK model catalog;
- tool execution boundary;
- mode differences;
- usage/cost telemetry;
- removed ACP/private-only features.

## Phase 15 — Comprehensive local test campaign

### Gate A: build/type/static
Run locally:
- clean install from lockfile;
- TypeScript build;
- typecheck with no emit if separate;
- package dry-run;
- import test under supported Node;
- import/test under Bun if the package still promises Bun compatibility;
- compliance static scan;
- dependency audit for accidentally retained private transport libraries.

### Gate B: unit tests
Cover:
- model normalization/cache/variants;
- auth marker and redaction;
- request classification;
- model/mode selection;
- prompt conversion;
- Code Mode extraction;
- custom tool schema conversion;
- tool result conversion;
- usage normalization/dedup;
- failure classification;
- rate-limit parsing;
- loopback request trust checks;
- session-store isolation;
- bridge lifecycle;
- media translation.

### Gate C: mocked integration tests
Use a fake SDK implementation to simulate:
- text stream;
- thinking + text;
- tool call;
- parallel tools;
- tool errors;
- tool-result images;
- parked-turn resume;
- cancellation;
- stalled run;
- SDK auth error;
- model unavailable;
- rate limit;
- usage events;
- replayed events;
- agent resume failure;
- server shutdown during a parked turn.

### Gate D: live Cursor SDK probes
Using the user's real SDK login, test locally:
1. `auth.status()`.
2. `models.list()`.
3. Simple text one-shot.
4. Persistent agent two-turn conversation.
5. Resume by agent ID.
6. Agent mode.
7. Plan mode.
8. Verified model variant/parameter.
9. Thinking stream.
10. Image input.
11. Custom tool invocation.
12. Custom tool Promise that remains pending briefly then resolves.
13. Multiple custom tools/parallel behavior.
14. Tool error return.
15. Cancellation while streaming.
16. Cancellation while custom tool is parked.
17. Usage events.
18. `Agent.getUsage()`.
19. Rate-limit/error structure if safely reproducible; otherwise test with captured documented fixtures.
20. Verify no unexpected native shell/edit/write execution occurs under the intended tool restriction configuration.

Do not deliberately exhaust plan quota just to test usage-cap errors.

### Gate E: OpenCode end-to-end
Run a local OpenCode instance using the local plugin path/package and verify:
- provider appears;
- model picker populates;
- login UX works;
- normal chat streams;
- model switching;
- plan mode;
- actual OpenCode file/read/edit/bash tools through OpenCode's permission system;
- deny permission path;
- allow permission path;
- parallel tool calls;
- tool error;
- user interruption;
- session resume;
- title generation;
- compaction;
- image attachment;
- tool-returned image if supported;
- multiple project directories;
- two simultaneous OpenCode sessions;
- plugin reload/shutdown.

## Phase 16 — Stress, regression, and soak testing

### Concurrency/stress scenarios
1. Many concurrent OpenCode sessions using the same process.
2. Several parked tool turns at once.
3. Long-thinking turn with SSE heartbeats.
4. Slow tool result near parked-turn TTL.
5. Repeated interrupt/restart cycles.
6. Rapid model switching.
7. Repeated provider reload/model refresh.
8. Multiple project roots in one OpenCode server.
9. Tool burst with parallel calls.
10. Large but valid prompt history.
11. Repeated image requests.
12. SDK transient failures/retries.
13. Proxy holder acquire/release across multiple plugin instances.

### Regression targets from opencode-claude
Port/adapt tests for:
- parallel tool grouping/debounce;
- parked-turn reaping;
- queued turns;
- steering;
- tool description fidelity;
- tool-result media;
- prompt/rate-limit behavior;
- session interruption cleanup;
- replayed usage deduplication.

### Acceptance bar
- no leaked SDK runs/agents after cancellations;
- no unresolved tool Promises after shutdown;
- no cross-session bridge reuse;
- no unbounded bridge/catalog/session maps;
- no duplicate OpenCode tool execution from retries;
- no silent model disappearance during refresh;
- no private-protocol fallback under any error condition.

## Phase 17 — Local implementation review checkpoint

### Objective
Treat the local implementation as a release candidate before any upstream action.

Prepare a local review report containing:
1. Final architecture and trust boundaries.
2. Exact `@cursor/sdk` version tested.
3. Files added, modified, and deleted.
4. Legacy private components removed.
5. Authentication flow and credential ownership.
6. Tool-execution flow.
7. Session/resume behavior.
8. Mode mapping.
9. Model/variant mapping.
10. Media support matrix.
11. Usage/cost support matrix.
12. Known unsupported features/SDK limitations.
13. Build/test command results.
14. Live SDK test results.
15. OpenCode end-to-end results.
16. Stress/regression results.
17. Compliance scan results.
18. Remaining risks and open questions.
19. Any differences from `opencode-claude` and why they are Cursor-specific.
20. Any behavior changed from the current OpenChamber Cursor plugin.

### Hard local-completion rule
Passing tests means only that the implementation is locally ready for review. It does **not** authorize publishing, opening a PR, or pushing changes to OpenChamber.

## Phase 18 — PR AUTHORIZATION GATE — STOP HERE

**This is a mandatory stop point.**

Until the user explicitly says something equivalent to **"create the PR"**, do not:
- open a pull request;
- open a draft pull request;
- push an implementation branch to the OpenChamber repository;
- publish the rewrite as an upstream contribution;
- create upstream commits on the user's behalf;
- post a PR description suggesting the implementation is ready for merge.

At this gate, present the Phase 17 local review report to the user and wait.

A successful local build, passing tests, or a favorable maintainer comment on the RFC does not count as PR authorization.

## Phase 19 — PR preparation (only after explicit authorization)

### Entry condition
The user has explicitly authorized PR creation after reviewing the completed local implementation/results.

### Tasks
1. Re-read upstream `main` and issue #6 for new maintainer guidance.
2. Rebase/update the local work against the current upstream state.
3. Resolve conflicts without reintroducing private transport code.
4. Re-run the full critical test suite after rebasing.
5. Organize commits into reviewable units, for example:
   - SDK/OpenCode 2 scaffold;
   - SDK auth + model catalog;
   - proxy + text streaming/session resume;
   - custom-tool bridge;
   - prompt/media/mode semantics;
   - usage/errors/hardening;
   - private-stack removal;
   - docs/tests.
6. Prepare a concise PR body linking issue #6.
7. Clearly call out architectural/security changes and known limitations.
8. Include exact local test evidence.
9. Avoid claiming guaranteed/legal ToS compliance; state that the implementation intentionally uses documented Cursor SDK surfaces and removes the private/direct protocol path.
10. Create the PR only after a final explicit authorization if the user requested review of the prepared PR text first.

## Proposed source ownership map

| Module | Responsibility |
|---|---|
| `constants.ts` | provider IDs, headers, timings, defaults |
| `index.ts` | OpenCode plugin registration, provider/auth hooks, lifecycle |
| `sdk.ts` | narrow typed wrapper around `@cursor/sdk` |
| `sdk-login.ts` | official SDK auth flow/status/logout only |
| `models.ts` | SDK model discovery, normalization, cache |
| `model-selection.ts` | encode/decode OpenCode model + Cursor variant |
| `session-store.ts` | OpenCode session ↔ Cursor agent ID mapping |
| `request-kind.ts` | normal/title/compact/generate/tool continuation classification |
| `prompt.ts` | message/media/tool-result conversion, Code Mode extraction |
| `tools.ts` | OpenAI tool → SDK custom tool definitions/results |
| `bridge-pool.ts` | parked runs and deferred OpenCode tool results |
| `usage.ts` | SDK token/cost normalization and dedup |
| `rate-limit.ts` | documented rate-limit state/error metadata |
| `failure.ts` | SDK/provider error classification |
| `log.ts` | redacted durable debug logging |
| `proxy.ts` | loopback OpenAI-compatible HTTP/SSE server |

## ACP ideas intentionally retained
- documented/supported Cursor integration only;
- compliance guard tests;
- fail-closed execution defaults;
- OpenCode as sole tool authority;
- model refresh and resilient cache;
- status/diagnostics;
- Plan synchronization;
- isolated safe utility calls;
- aggressive secret redaction;
- no ambient Cursor MCP/settings by default;
- graceful cancellation/cleanup mindset.

## ACP machinery intentionally dropped
- `agent acp` subprocess management;
- NDJSON/JSON-RPC transport;
- ACP initialize/auth/session protocol state machine;
- loopback MCP HTTP bearer server;
- ACP filesystem/terminal rejection handlers;
- `agent --list-models` parsing;
- process-group kill logic specific to CLI child management;
- ACP-specific Ask mode and Full Authority commands.
