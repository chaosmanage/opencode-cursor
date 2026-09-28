# opencode-cursor

Cursor models in OpenCode through Cursor's official TypeScript SDK.

> Current branch status: SDK rewrite under development. This branch is not an upstream release.

## Architecture

```text
OpenCode
  -> local OpenAI-compatible proxy
  -> @cursor/sdk
  -> Cursor
```

The rewrite intentionally removes the direct/private Cursor protocol stack. Authentication, model discovery, agent sessions, streaming, and usage data come from documented `@cursor/sdk` APIs.

### Execution boundary

**Cursor reasons; OpenCode controls execution.**

For normal agent turns the plugin offers Cursor only the SDK `mcp` capability and supplies the tools from the current OpenCode request as SDK custom tools. Cursor's native shell/read/edit/task tools are not offered. The custom-tool callback parks while OpenCode applies its own permission rules and executes the tool; the result resumes the same Cursor run.

Ambient Cursor setting sources are disabled by default, so project/user Cursor MCP configuration is not implicitly loaded into the provider.

## Authentication

Run OpenCode's Cursor sign-in flow. The plugin calls `Cursor.auth.login()` and relays the official Cursor login URL.

The Cursor SDK owns the credential lifecycle and default credential store. The plugin does not implement PKCE/OAuth itself, does not parse or copy the SDK credential, and stores only a non-secret OpenCode integration marker.

If the SDK uses its default store, its login is stored by the SDK under `~/.cursor/sdk/auth.json`.

## Models

Models are discovered with `Cursor.models.list()` after SDK sign-in. SDK variants are mapped to OpenCode model variants and the last successful catalog is cached for startup.

The SDK does not currently expose every field OpenCode's provider schema expects, so context/output limits use conservative plugin defaults rather than private model metadata.

## Modes

- OpenCode Plan agent -> Cursor `plan`
- other primary agents -> Cursor `agent`
- title, compaction, and generate requests -> isolated tool-less SDK agents

There is no invented SDK `ask` mode.

## Media

Image input is mapped to SDK image inputs for direct user messages and tool results. Unsupported non-image documents are not advertised as provider capabilities.

## Usage and limits

Per-turn token usage is mapped from documented Cursor SDK usage events. Cumulative usage is delta-accounted across parked tool continuations to avoid double counting.

This plugin does **not** scrape Cursor's dashboard and does not claim to know account-wide monthly quota percentage or billing-cycle remaining allowance.

## Requirements

- OpenCode 2.x plugin host
- Node.js >= 22.13
- Cursor account that can use the Agent SDK
- `@cursor/sdk` 1.0.32 for this development branch

## Development

```bash
npm ci
npm run check
npm pack --dry-run
```

Enable redacted debug logging with:

```bash
OPENCODE_CURSOR_DEBUG=1
```

## Security / integration constraints

Automated checks reject first-party runtime references to the removed private integration, including the old private backend hostname, generated Cursor protobuf transport, private model/name RPCs, H2 bridge files, and plugin-owned PKCE logic.

The loopback proxy binds to `127.0.0.1`, rejects browser `Origin` requests and non-loopback host headers, and cancels an active Cursor run when the OpenCode HTTP client disconnects.

## Known development limitations

- Live authenticated SDK/OpenCode end-to-end testing still requires a Cursor SDK login on the test machine.
- Account-wide subscription quota/remaining-plan telemetry is not available through the documented SDK surface used here.
- PDF input is not advertised.
- This rewrite has not been submitted upstream; see the repository RFC discussion before any PR is created.

## License

MIT
