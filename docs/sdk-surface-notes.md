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

The public SDK model type does not currently expose a typed numeric context window. The mapper first accepts a positive context value if a future SDK supplies one, then uses an explicit table of model IDs and default windows verified against [Cursor model documentation](https://cursor.com/docs/models-and-pricing). An unknown model uses OpenCode's `0` sentinel. Output metadata remains conservative.

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

`Cursor.models.list()` does not currently expose a typed numeric context window.
The plugin's priority is SDK numeric value, documented per-model default,
then `0` for unknown IDs. The fallback table is deliberately explicit; it does
not infer limits from model families or provider marketing. The model cache
backfills older zero entries for known IDs while preserving positive values.
OpenCode's `0` sentinel disables its own overflow compaction for unknown models.
The durable Cursor agent still owns conversation state across normal turns.

The table was checked against the current [Cursor model index](https://cursor.com/docs)
and individual Cursor model pages on 2026-09-28. The documented Sonnet 4.6 ID
is `claude-4-6-sonnet`.

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
