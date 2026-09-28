# Cursor SDK surface notes

Verified against `@cursor/sdk` 1.0.32 on Node 22.23.2.

## Authentication

Used documented APIs:

- `Cursor.auth.login()`
- `Cursor.auth.status()`
- `Cursor.auth.logout()`

The login API can expose the official browser URL through `onLoginUrl`. The SDK's default credential store remains authoritative. The plugin does not read that store directly and never persists the returned API key into OpenCode.

## Models

`Cursor.models.list()` returns canonical model IDs, display names, parameter definitions, and variants. Model selections are passed back as `{ id, params? }`.

The SDK does not expose an authoritative numeric context window in model discovery. OpenCode v2 requires a context integer, so Cursor models use OpenCode's `0` sentinel to disable OpenCode-side overflow compaction; the persistent Cursor agent owns context management. Output metadata remains conservative.

## Local agents

Used documented APIs:

- `Agent.create()`
- `Agent.resume()`
- `SDKAgent.send()`
- `Run.stream()`
- `Run.wait()`
- `Run.steer()`
- `Run.cancel()`
- `SDKAgent.getUsage()`

Conversation modes are `agent` and `plan`.

## Tool restriction

`AgentOptions.tools` is the key execution boundary:

- `[]` means no built-in tools.
- `["mcp"]` grants the MCP family, including SDK `local.customTools`.
- Shell/read/edit/task are not offered by this integration.

`local.settingSources: []` prevents ambient Cursor project/user/team/plugin settings from being loaded by default.

SDK custom tools execute in the host process, so each callback is deliberately parked until OpenCode returns the corresponding tool result.

## Media

`SDKUserMessage` supports text plus `SDKImage[]` using either URL or base64 data plus MIME type.

SDK custom-tool results can return text and inline image content.

This rewrite does not advertise PDF capability because the verified SDK input type used here is image-specific.

## Usage and errors

Run usage exposes input/output/cache/reasoning token counts. `SDKAgent.getUsage()` additionally exposes raw and charged cost, but cost is agent/turn-accounting data and is not treated as account-wide subscription quota.

Documented error classes used by the plugin include:

- `AuthenticationError`
- `RateLimitError`
- `ConfigurationError`
- `AgentBusyError`
- `NetworkError`

No documented API used by this rewrite reports whole-account monthly percentage remaining or dashboard allowance state.

## Deliberately unused

- private Cursor backend endpoints
- generated private protobufs
- private RPC model/name endpoints
- plugin-owned PKCE/OAuth
- direct SDK credential-file parsing
- dashboard scraping
- ambient Cursor MCP/settings by default
- native Cursor shell/edit/write/task execution


## Context-window ownership

`Cursor.models.list()` does not currently expose an authoritative numeric
context window. The plugin therefore does not hardcode per-model context sizes
and does not assign a guessed fallback to newly added models.

OpenCode v2 requires `limit.context` to be an integer. Cursor models are
registered with `context: 0`, OpenCode's sentinel for disabling its own
context-overflow compaction. Normal OpenCode sessions resume a durable Cursor
agent, so Cursor owns the conversation state and compacts it against the actual
selected model's context window.

## Dynamic reasoning/thinking levels

OpenCode renders model `variants` in its Thinking selector. Cursor SDK model
parameters are broader than thinking controls: the catalog can expose unrelated
parameters such as `fast`, `context`, and Cursor Router's `optimize_for`.
Those must not be mapped to OpenCode variants.

The plugin therefore exposes only SDK parameters that semantically represent
reasoning/thinking effort (for example `reasoning`, `reasoning_effort`,
`effort`, or `thinking_level`). Their allowed values are discovered from
`Cursor.models.list()` and become OpenCode Thinking choices dynamically.

SDK preset variants still define the SDK default selection. A preset is shown
in OpenCode's Thinking menu only when it actually selects a reasoning/thinking
parameter. Fast/context/router presets remain valid SDK selections internally
but do not pollute the Thinking menu.

This keeps the picker forward-compatible without hardcoding model names or
reasoning levels.
