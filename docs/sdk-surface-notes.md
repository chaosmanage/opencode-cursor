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

The SDK does not expose all OpenCode provider metadata fields such as authoritative context/output limits, so the plugin uses conservative fallback limits rather than private metadata.

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
