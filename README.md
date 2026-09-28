# opencode-cursor

Cursor models in OpenCode through Cursor's official TypeScript SDK.

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

## Install

Requirements: OpenCode 2, Node.js 22.13 or newer, and a Cursor account with Agent SDK access. Run installation and sign-in as the same operating-system user that runs the OpenCode server.

After OpenChamber publishes a release containing this SDK integration, install the plugin with:

```bash
opencode plugin add @openchamber/opencode-cursor
opencode service restart
opencode plugin list
```

The currently published `@openchamber/opencode-cursor@2.5.1` package contains the previous integration. To test this SDK rewrite before its release, build the PR checkout on the OpenCode server machine:

```bash
npm ci
npm run build
```

In the project where you use OpenCode, add the built entrypoint to `opencode.json` (replace the path with the PR checkout's absolute path):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-cursor/dist/index.js"]
}
```

Use OpenCode 2's plural `plugins` key ([plugin configuration](https://opencode.ai/v2/docs/plugins)). Start or restart OpenCode in that project after changing the config, then check `opencode plugin list`. When switching to the published package, remove the local path from `plugins` so the plugin loads only once.

## Sign in with the Cursor SDK

From the OpenCode project with this plugin loaded, run:

```bash
opencode auth login cursor --method cursor-sdk
```

Open the Cursor URL shown by OpenCode, complete sign-in in your browser, and return to the terminal. The plugin calls `Cursor.auth.login({ openBrowser: false, onLoginUrl })`; the official SDK stores its credential and OpenCode stores only a non-secret integration marker. If the SDK is already signed in, this command completes without a new browser login. Check the available Cursor models with `opencode models`.

If OpenCode cannot present the browser URL, you can sign in directly with the SDK. Run the following from the source checkout, where `npm ci` installed `@cursor/sdk`. If you installed only the published plugin, first create a small SDK command directory:

```bash
mkdir -p ~/.local/share/opencode-cursor-sdk-auth
npm install --prefix ~/.local/share/opencode-cursor-sdk-auth @cursor/sdk@1.0.32
cd ~/.local/share/opencode-cursor-sdk-auth
```

Then run:

```bash
node --input-type=module -e 'import { Cursor } from "@cursor/sdk"; await Cursor.auth.login({ openBrowser: false, onLoginUrl: (url) => console.log(url) }); console.log("Cursor SDK signed in")'
cd /absolute/path/to/your-opencode-project
opencode auth login cursor --method cursor-sdk
```

The first command prints the official URL and waits for browser sign-in; the second records OpenCode's integration marker. The SDK's default credential store is `~/.cursor/sdk/auth.json`. Keep that file private; the plugin does not read or copy it.

To check SDK sign-in status without printing a credential, run this from the source checkout or SDK command directory:

```bash
node --input-type=module -e 'import { Cursor } from "@cursor/sdk"; console.log((await Cursor.auth.status()).status)'
```

### Sign out

Remove the OpenCode marker, then forget the SDK's local credential. Run the Node command from the source checkout or SDK command directory above:

```bash
cd /absolute/path/to/your-opencode-project
opencode auth logout cursor
cd /absolute/path/to/source-checkout-or-sdk-command-directory
node --input-type=module -e 'import { Cursor } from "@cursor/sdk"; await Cursor.auth.logout(); console.log((await Cursor.auth.status()).status)'
```

`Cursor.auth.logout()` removes the locally stored SDK login. It does **not** revoke the minted API key on Cursor's server; revoke that key in the Cursor dashboard's API keys page if you need it invalidated before expiry. Restart any running OpenCode server after signing out so existing sessions do not keep using an active agent. To switch accounts, sign out using both steps, then sign in again.

## Models

Models are discovered with `Cursor.models.list()` after SDK sign-in. SDK variants are mapped to OpenCode model variants and the last successful catalog is cached for startup.

The SDK does not currently expose every field OpenCode's provider schema expects. Context limits use a positive SDK value when available, then an explicit Cursor-documented per-model default, then `0` for unknown models. Output metadata remains conservative.

## Modes

- OpenCode Plan agent -> Cursor `plan`
- other primary agents -> Cursor `agent`
- title, compaction, and generate requests -> isolated tool-less SDK agents

There is no invented SDK `ask` mode.

## Media

Image input is mapped to SDK image inputs for direct user messages and tool results. Unsupported non-image documents are not advertised as provider capabilities.

## Usage and limits

Per-turn token usage is mapped from documented Cursor SDK usage events. Cumulative usage is delta-accounted across parked tool continuations to avoid double counting. Documented raw/charged cost is exposed separately as per-run `cursor_cost` deltas using `Agent.getUsage()` baselines.

This plugin does **not** scrape Cursor's dashboard and does not claim to know account-wide monthly quota percentage or billing-cycle remaining allowance.

## Requirements

- OpenCode 2.x plugin host
- Node.js >= 22.13
- Cursor account that can use the Agent SDK
- `@cursor/sdk` 1.0.32 is the SDK version used by this integration

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

## Known limitations

- Real image inference, persistent SDK resume, and post-fix usage display have not yet been verified end to end.
- Account-wide subscription quota/remaining-plan telemetry is not available through the documented SDK surface used here.
- PDF input is not advertised.

## License

MIT
