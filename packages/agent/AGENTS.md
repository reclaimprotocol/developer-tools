# packages/agent

> **Contributing.** This package lives in
> [reclaimprotocol/developer-tools](https://github.com/reclaimprotocol/developer-tools),
> and pull requests are merged there. The generated files (`*.gen.ts`) come
> from Builder's OpenAPI document. Don't edit them by hand; describe the API
> change in your pull request instead. Paths like `packages/app/...` below
> refer to Reclaim's private Builder repository, which includes this repository
> as a git submodule, and aren't in this repository.

MCP server + agent tools for `@reclaimprotocol`. Depends on `@reclaimprotocol/client` for the typed HTTP client; adds browser automation, capture, synthesis, and proof tools on top.

## Roles

1. **MCP server** — registers all tools and serves them over stdio. Bin: `reclaim-mcp-server`.

The MCP server has these layers of tools, all wired up in `src/mcp/start.ts`:

| Layer                        | Source                    | Tools                                                                                            |
| ---------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| Auto-generated               | `mcp/api/tools.ts`        | One tool per `MCP`-tagged openapi operation (builder mode only)                                  |
| Authentication and credentials | `mcp/tools/authenticate/` | `authenticate`, `issueCredentials`, `importCredentials`, `resolveOwnerKey`                       |
| Verification orchestration   | `mcp/tools/verification/` | `getVerificationResult` (fetch + local eth decrypt; authenticates with `RECLAIM_ORG_SECRET`) |
| Browser + agent              | `mcp/tools/agent/`        | CDP capture, synthesis, replay, proof, publish (skip with `RECLAIM_AGENT_DISABLED=1`)            |

## Dependencies

- `@reclaimprotocol/client/api` — browser-safe `ReclaimClient`, API errors,
  `DEFAULT_BASE_URL`, and generated types. Use this subpath for Builder API
  transport; don't duplicate it.
- `@reclaimprotocol/client` — proof, signing, encryption, and higher-level SDK
  helpers. Import from the root only when those features are needed.
- `@reclaimprotocol/app` — backend API (source of truth for `openapi.yaml`).

## Source of truth

In Builder, `packages/app/openapi.yaml` is the single source of truth for all operations. Run:

```bash
npm run openapi:gen --workspace=packages/app
```

This regenerates `src/mcp/api/operations.gen.ts` (the MCP tool schemas, via
`packages/app/scripts/mcp-tools-gen.ts`). Import API types from
`@reclaimprotocol/client/api`; the package root re-exports those exact types.
Rebuild the client after a specification change. All generated API tools pick
up new operations automatically—no per-operation wrapper is needed.

## Layout

```
src/
  index.ts              Package exports — re-exports @reclaimprotocol/client + buildAgentTools
  logger.ts             Shared pino logger (agent-scoped)
  paths.ts              ~/.reclaim path helpers
  pkg.ts                Reads agent's package.json for NAME/VERSION
  mcp-bin.ts            `reclaim-mcp-server` bin entry
  mcp/
    start.ts            Bootstraps McpServer, wires up all tool groups, starts stdio transport
    server.ts           Low-level MCP SDK wrapper — registerToolList(), defineTool()
    instructions.ts     BUILDER_MODE_INSTRUCTIONS for the LLM context window
    api/
      tools.ts          registerTools() — auto-generated wrappers for MCP-tagged ops
      operations.gen.ts GENERATED — MCP tool schemas from openapi.yaml
      to-zod.ts         JSON-Schema → zod for the generated tool inputs
    tools/
      index.ts          Barrel for every tool group
      agent/            Browser/CDP tools — attach, capture, find, eval, analyze, propose, replay, proof, publish, session
      authenticate/     Auth + eth proof-owner key tools — authenticate, issue, import, resolve-owner-key, eth-key
      verification/     Higher-level orchestration — get_verification_result (fetch + local eth decrypt)
  old/                  Devtools mode (USE_OLD_DEVTOOLS) — isolated client, login, tools
  cdp/                  Chrome DevTools Protocol — launcher, client, capture, tabs,
                        eviction, and the containerised browser runtime
                        (container.ts)
                        Containers are reference counted by SLOT (cdp/claims.ts):
                        one profile and one live claimant each, so sessions share
                        sequentially and never write one profile twice. The last
                        claim to go stops the container; `mcp/start.ts` releases
                        on transport drop, and an owner-PID label lets a crashed
                        session's container be reaped on the next attach
  provider/             Provider constraint analysis, drafting, matching, normalization
  proof/                zkTLS attestation + replay
  config/               Agent config persistence (ConfigStore — ~/.reclaim/config.json)
  types/
    openapi.ts          Type aliases re-exported from @reclaimprotocol/client's openapi types

tests/                  Native node test runner. One file per surface.
```

## Writing code

Inherit repo-wide conventions from the root `AGENTS.md`. Specific to this package:

1. Tabs for indentation. `.ts` extension on every relative import. `#` for private class members.
2. Import Builder API transport from `@reclaimprotocol/client/api`. Import
   proof, signing, encryption, and workflow helpers from
   `@reclaimprotocol/client`. Never duplicate either implementation.
3. `assert(cond, boomError)` instead of `if(!cond) throw`.
4. Logging via `src/logger.ts`. No `console.log`.
5. Run lint and typecheck from the repository root before committing.

## MCP Tool Patterns

All hand-written tools use one pattern: a builder function returns a `RegisteredTool` produced by `defineTool` (JSON Schema is the single source of truth — the handler's args are parsed and type-narrowed via a zod schema derived from it). `start.ts` registers each group with `registerToolList(server, buildXTools(...))`, which converts the JSON Schema to zod and wraps the handler with consistent stringification + error remapping.

```ts
export function myTool(client: ReclaimClient): RegisteredTool {
	return defineTool<{ field: string }>(
		{
			name: 'my_tool',
			description: 'Does one specific task. Use it when ...',
			inputSchema: {
				type: 'object',
				properties: { field: { type: 'string' } },
			},
		},
		async({ field }) => ({ field }),
	)
}
```

Group these in the relevant `build.ts` (for example, `tools/authenticate/build.ts`, `tools/verification/build.ts`, `tools/agent/build.ts`), which collects the group's tools into a `buildXTools()` array.

## Adding a New MCP Tool

**Hand-written tool:**

1. Create `src/mcp/tools/<group>/my-tool.ts` (`authenticate`, `verification`, or `agent`)
2. Export a builder returning `defineTool(...)` following the existing pattern
3. Add it to that group's `build.ts` array
4. `npm run build --workspace=packages/agent`

**Auto-generated (any new `MCP`-tagged openapi op):**

1. Tag the operation with `tags: [MCP]` in `packages/app/openapi.yaml`
2. `npm run openapi:gen --workspace=packages/app`
3. The tool appears automatically — no code needed

## Environment variables

| Variable                 | Default                            | Purpose                                                       |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------- |
| `USE_OLD_DEVTOOLS`       | unset                              | Builder by default; set `true` for legacy devtools   |
| `RECLAIM_API_URL`        | `http://localhost:4001`            | Builder backend base URL (builder mode only)                  |
| `RECLAIM_API_TOKEN`      | —                                  | Builder bearer token; overrides the cached session token (builder mode) |
| `RECLAIM_ORG_SECRET`     | —                                  | Per-org API secret (`rorg_…`); how `get_verification_result` authenticates |
| `RECLAIM_PRIVATE_KEY`    | —                                  | Eth proof-owner private key (`0x`-hex) for `run_proof`; else read from project `.env` |
| `RECLAIM_PRIVATE_KEY_FILE` | —                                | Path to a file holding the eth proof-owner key (fallback after env + `.env`) |
| `RECLAIM_OLD_API_URL`    | `https://devapi.reclaimprotocol.org` | Devtools backend origin (devtools mode; client appends `/api`) |
| `RECLAIM_OLD_API_TOKEN`  | —                                  | Devtools-mode Firebase bearer identity (headless)                  |
| `RECLAIM_OLD_ETH_UID`    | —                                  | Devtools-mode `eth:<addr>` identity (headless)                     |
| `RECLAIM_OLD_LOGIN_URL`  | `https://dev.reclaimprotocol.org`  | Dashboard URL for the CDP browser-login flow                  |
| `RECLAIM_AGENT_DISABLED` | —                                  | Set to `1` to skip CDP/agent tools (API-only mode)            |
| `RECLAIM_TELEMETRY`      | on                                 | Set to `0` to turn off anonymous usage data (see README "Usage data") |
| `DO_NOT_TRACK`           | —                                  | Set to `1` or `true` to turn off usage data; same effect as `RECLAIM_TELEMETRY=0` |
| `RECLAIM_BROWSER_RUNTIME_IMAGE` | pinned digest | Browser-runtime image for `attach_browser`'s `container` mode. Point it at a local `build.sh` output to test an unreleased runtime |

### `USE_OLD_DEVTOOLS` (defaults off)

Builder mode is the default. Set `USE_OLD_DEVTOOLS=true` to opt into devtools
mode. In devtools mode: all auto-generated tools are disabled,
a small `ReclaimOldClient` (`src/old/`) serves `reclaim_authenticate`
(by default a local-Chrome, loopback-CDP login — never a container, Builder,
custom-CDP, or shared authoring browser; or pass a token / eth uid to skip the
browser), `create_provider_version_from_capture`
(register a new provider, or create an immutable new semantic version when
given a `providerId`),
and the `get_me_providers`. The CDP/capture/propose/replay/proof tools
are unchanged. All devtools-mode code is isolated under `src/old/`.

## Running + Inspecting

```bash
npm run build --workspace=packages/agent    # compile to lib/
npm run start:mcp --workspace=packages/agent # run MCP server
npm run inspect --workspace=packages/agent  # open MCP inspector UI
```

## Tests

```bash
npm test --workspace=packages/agent          # all tests
node --test tests/mcp-credentials.test.ts    # credential/auth tools only
node --test tests/verification-checks.test.ts # verification orchestration only
```

Tests use the native Node test runner against in-process fixtures and a stub CDP — no Chrome or external database needed (the Chrome E2E test at `tests/e2e-chrome.test.ts` is gated behind `RECLAIM_AGENT_E2E=1`).
