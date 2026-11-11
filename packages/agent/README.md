# @reclaimprotocol/agent

Reclaim Protocol lets your app verify **data points** about its users — a follower count, an account balance, an order history. This package gives your AI coding agent the tools to find, build, test, and fix **data verification providers**: the recipes that verify a data point. With it, your agent inspects and replays captured requests, checks verification sessions, evaluates proofs, and publishes provider updates.

Under the hood it's Chrome-CDP + zkTLS provider-authoring tooling: it captures network traffic from a browser, synthesizes provider definitions from it (`contains` matchers + `jsonPath` / `xPath` / `regex` redactions), runs a local replay diagnostic, and produces a verified attestor proof via `@reclaimprotocol/attestor-core`.

This package **is** the Reclaim MCP server (bin: `reclaim-mcp-server`). It depends on `@reclaimprotocol/client` for the typed HTTP client and registers the provider-authoring tools below alongside the backend-facing tools (credentials, publishing) in a single MCP surface. A standalone entry (`src/index.ts`) re-exports the client SDK plus `buildAgentTools` for embedding.

## Contents

- [Install](#install)
- [Use it from an agent](#using-it-from-your-agent)
- [Provider-authoring tools](#provider-authoring-tools)
- [Backends](#backends)
- [Local development](#local-development-from-source)
- [Platform notes](#platform-notes)
- [Tests](#tests)
- [Disable browser tools](#disable-the-browser-tools)
- [Contributor setup](#for-contributors--wiring-a-local-build-into-claude-code--opencode)

## Install

**Prerequisites:**

- **Node 22.12 or later.** Any line from there works, including non-LTS ones such as 25, but a current LTS line (22 or 24) is recommended.
- **A local Chrome, Chromium, or Edge**, used for capture and for the dashboard login. Without one, the agent downloads Chrome for Testing once into `~/.reclaim/browsers`. On Linux the MCP server needs `DISPLAY` or `WAYLAND_DISPLAY` set, because the browser opens a visible window.
- **Docker** — only for `attach_browser`'s `container` mode, which runs the Reclaim browser runtime (the same image the hosted browser uses) and gives you a link you can send to whoever holds the account. It is the free way to get that link; the hosted remote browser is the other, and it is chargeable. Not needed if you are doing the work yourself. The image is amd64, so Apple Silicon runs it translated. OrbStack handles that itself; Docker Desktop needs Rosetta enabled. `RECLAIM_BROWSER_RUNTIME_IMAGE` overrides the pinned digest.
- **`cloudflared`** — only to share a `container` browser with someone remote. The MCP server does not run or install it: `share_browser_view` returns the command, and the developer chooses to run `cloudflared tunnel --url http://localhost:<port>` themselves (recommended) or approve the agent running it. Install it first.

The MCP server downloads the ZK proof files it needs (about 1.5 MB) in the background when it starts, so it starts immediately and the files are usually ready by the first `run_proof`. If that download fails, it falls back to the full circuit archive (about 350 MB). `check_attestor` reports where the download stands.

It runs as a **stdio MCP server**. Point any MCP-capable agent at this command:

```bash
npx -y --package=@reclaimprotocol/agent reclaim-mcp-server
```

> The `--package=` (short form `-p`) flag selects the `reclaim-mcp-server` binary from the package. We use the long `--package=` form throughout because the short `-p` collides with the `-p`/`--print` flag of some agent CLIs (notably `claude mcp add`), which silently swallows the command. Prefer a global install? Run `npm i -g @reclaimprotocol/agent` and use `reclaim-mcp-server` directly as the `command` (drop the `npx` wrapper and its `args`).

### Installing into your coding agent

Copy-paste setup for **Claude Code** (plugin marketplace), **Codex** (plugin marketplace), **Claude Desktop**, **Cursor**, **opencode**, **Windsurf**, **VS Code**, **Cline** and other MCP clients lives in the public **[reclaimprotocol/developer-tools](https://github.com/reclaimprotocol/developer-tools)** repo — that's where the Claude Code and Codex plugins are published.

The quickest path, in Claude Code:

```
/plugin marketplace add reclaimprotocol/developer-tools
/plugin install reclaim@reclaim
```

In Codex:

```bash
codex plugin marketplace add reclaimprotocol/developer-tools
codex plugin add reclaim@reclaim
```

For any other client, point it at the stdio command above (`npx -y --package=@reclaimprotocol/agent reclaim-mcp-server`) — see the developer-tools README for per-client config and the Claude Desktop / GUI-app notes.

### Optional environment

Defaults target the Builder backend, so **no env is needed for the common case**. To use legacy devtools explicitly, add an `env` block (or `environment` in opencode):

```json
"env": {
  "USE_OLD_DEVTOOLS": "true",
  "RECLAIM_OLD_API_URL": "https://devapi.reclaimprotocol.org"
}
```

See [Backends](#backends) for the full env-var list.

### Usage data

The MCP server sends anonymous usage data to Builder so that Reclaim can see which tools developers use and where they get stuck.

**What the server records**

- When a session starts: the mode (Builder or devtools), whether the browser tools are on, your operating system family, your Node.js version, and the name and version of your MCP client, such as Claude Code.
- For each tool call: the tool name, whether it succeeded, how long it took, and an error category such as `http_401`.
- When you sign in.
- For three tools only, the text you give them. `start_integration` records `goal` and `userRequest`. `propose_provider` records `userRequest`. `discover_resolve` records the domain and data points you search for. Don't put secrets or personal data in these fields.
- A random client ID that the server saves in `~/.reclaim/config.json`. It isn't derived from your machine or account. After you sign in, Builder links earlier events from this client ID to your account.

**What the server never records**

- Any other tool argument.
- Tool output, captured requests or responses, or file contents.
- Error messages, tokens, keys, or cookies.

**Where the data goes**

Builder stores the events in its database. Builder forwards only a short list of event names and counts to Google Analytics, and never the text you typed.

**Turn it off**

Set `RECLAIM_TELEMETRY=0`, or set `DO_NOT_TRACK=1`, in the `env` block of your MCP client configuration. With either set, the server doesn't create a client ID and makes no analytics requests.

```json
"env": {
  "RECLAIM_TELEMETRY": "0"
}
```

### Provider-authoring guide

The MCP server is all you need — it ships a `how_it_works` tool that serves the capture → prove → publish guide **one topic at a time** (`overview`, `auth`, `browser`, `capture`, `draft`, `params`, `prove`, `publish`, `discover`, `user-script`, `interception`, `hash-validation`, `report-bug`, `credentials`, `never-do`, `troubleshooting`). Call it with no arguments for the overview plus the topic index; every response repeats that index, so an agent that guessed wrong self-corrects without a second round-trip. Any MCP client can call it on demand; there's nothing extra to install.

If `@reclaimprotocol/client` or the MCP server itself misbehaves, the `report-bug` topic walks an agent through collecting redacted details and opening a fix PR (preferred) or an issue at [reclaimprotocol/developer-tools](https://github.com/reclaimprotocol/developer-tools). A maintainer reviews and merges the PR, and the fix ships in the next release.

## Using it from your agent

Tip: have your agent call the `how_it_works` tool first so it follows the full authoring flow.

Then ask in plain language. For example:

> "Use Reclaim to create a provider that proves my GitHub follower count."

Or more loosely:

> "I want to verify Github follow count"

The agent orchestrates the tools for you:

1. **`reclaim_authenticate`** — a local Chrome window opens the Reclaim dashboard; you sign in. The token is captured automatically and the tab closes. It never uses a Builder, container, custom-CDP, or shared browser. (Or it reuses a still-valid cached identity.)
2. **`attach_browser` + `navigate`** — opens a visible local browser with the persistent Reclaim profile (other modes only when you ask for them); **`wait_for_page`** waits while you log in.
3. **`start_capture` → `find_requests_containing` → `get_request`** — records network traffic and locates the request carrying your value.
4. **`propose_provider`** — drafts the provider (a `contains` match + `jsonPath`/`xPath`/`regex` redaction), keeping any secret headers server-side.
5. **`replay_request` → `run_proof`** — pre-flights the draft, then produces a verified zkTLS proof via the attestor.
6. **`create_provider_version_from_capture`** — publishes it as a new immutable semantic version. **`get_me_providers`** lists what you own; pass a returned `providerId` back to add a version. Patch is the default; request `major`, `minor`, `patch`, or an exact higher version.

Your only manual steps are signing in when the browser windows open and confirming the value you want to prove.

## How it works (guide tool)

The mode-aware authoring guide (`skill/SKILL.builder.md` / `skill/SKILL.old.md`, one per backend) is served on demand by the **`how_it_works`** MCP tool — call it from any MCP client (Claude Code, Cursor, opencode, Antigravity, …) to get the deep capture → prove → publish workflow, decision frameworks, and troubleshooting. It is served per topic rather than all at once, so pulling one answer costs a fraction of the guide. The server's always-on `instructions` cover the essentials; `how_it_works` is the in-depth version, with nothing to install.

## Provider-authoring tools

These capture/synthesis/proof tools are backend-independent and registered in both modes (see [Backends](#backends)):

| Tool                                        | Purpose                                                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `attach_browser`                            | Connect to a browser. With no arguments it launches a visible local browser (Chrome, then Chromium, then Edge, else a one-time Chrome for Testing download) with the persistent Reclaim profile, without asking. `attach` (your open Chrome), `container` (Docker), `builder` (hosted, chargeable), and `custom` (a CDP websocket) are used only when you ask for them |
| `list_tabs`                                 | List open Chrome tabs                                                                                          |
| `navigate`, `wait_for_page`, `eval_in_page` | Drive the tab; poll for login completion                                                                       |
| `start_capture`, `stop_capture`             | Network capture lifecycle                                                                                      |
| `list_requests`, `get_request`              | Inspect captured traffic                                                                                       |
| `find_requests_containing`                  | Deterministic search for a target value across captured responses                                              |
| `analyze_request_constraints`               | Flag concerns: signed request, CSRF dependency, bot challenge, short-lived token, GraphQL |
| `propose_provider`                          | Synthesize a provider — `contains` match + `jsonPath`/`xPath`/`regex` redaction                                |
| `replay_request`                            | Pre-flight replay via Node `fetch` (no attestor); also used for auth-bound check by omitting `secretParamsRef` |
| `run_proof`                                 | End-to-end zkTLS proof through the attestor SDK                                                                |
| `create_provider_version_from_capture`      | Publish a draft as a new immutable semantic version (patch by default)                                         |
| `authenticate_builder`                      | In old-devtools mode only, sign in to Builder for remote-browser allocation                                   |
| `list_builder_organizations`                | In old-devtools mode only, list organization ids for a quota-accounted Builder browser                         |
| `share_browser_view`                        | Share the `container` browser's own live view with someone elsewhere. Returns the local viewer port and the `cloudflared tunnel` command; the developer runs it or approves the agent running it; call it again with the printed `https://*.trycloudflare.com` URL as `publicUrl` to get the link to relay. Container mode only: a `builder` browser already returns a hosted `liveViewUrl`, and a plain local browser has no view to share |
| `dispose_browser`                           | Stop captures, disconnect CDP, and immediately release a Builder-hosted browser                               |
| `get_session`, `reset_session`              | Session state                                                                                                  |

## Backends

The MCP server targets one of two backends. An explicit `USE_OLD_DEVTOOLS` setting overrides the persisted choice; otherwise Builder is the default:

- **Old devtools (`USE_OLD_DEVTOOLS=true`).** In old mode all auto-generated HTTP-API tools are disabled and a small client (`src/old/`) serves:
  - `reclaim_authenticate` — by default opens the dashboard in local Chrome over loopback CDP, waits for sign-in, reads the Firebase token from page storage, and closes the tab. It never uses a remote or shared authoring browser. Pass a `token` / `ethAddress` to skip the browser.
  - `create_provider_version_from_capture` — registers a new provider, or adds a new immutable semantic version when given a `providerId`. It never edits an existing version.
  - `get_me_providers` — list the providers you own (the only provider-listing tool in this mode).
  - `session_analytics_logs` — the milestone events for a verification session, which show how far it got.
  - `session_logs` — the log entries the in-app SDK emitted during that session, each with its event type, log level, and logger name. Filter by event type, level, or substring, page with `limit` and `offset`, or set `saveTo` to write every matching entry to an NDJSON file. The backend searches only the last 3 days unless you pass `startTime` and `endTime`, and it deletes entries after 30 days.
- **Builder (default).** Registers the auto-generated HTTP-API tools, including `create_org`, `issue_org_token`, and `create_org_callback_subscription`, plus authentication/credential tools, `get_verification_result`, `read_callback_events` (read the org's pull-listener events), `proxy_callback_events` (forward them to a localhost callback route; the pull listener lives only while the MCP server runs), and `check_attestor`. `issue_credentials` creates a local proof-owner key; `issue_org_token` issues the organization's API secret; `create_example_app` writes the builder-example app into a workspace that has none; `issue_org_keypair` creates the organization's key pair for session binding and encrypted results, writing the private key to the app's env file.

Relevant env vars: `RECLAIM_OLD_API_URL` (default `https://devapi.reclaimprotocol.org`), `RECLAIM_OLD_API_TOKEN` / `RECLAIM_OLD_ETH_UID` (headless identity), `RECLAIM_OLD_LOGIN_URL` (default `https://dev.reclaimprotocol.org`); builder mode uses `RECLAIM_API_URL` / `RECLAIM_API_TOKEN`.

## Local development (from source)

For working on the package in this repository (consumers should use [Install](#install) instead). A workspace install only fetches dependencies:

```bash
npm install
```

The ZK circuit resources needed by `@reclaimprotocol/attestor-core` are **not** fetched at install time — `run_proof` downloads them on the first proof (see the [first-run note](#install)). To pre-fetch them instead of paying the cost on that first proof, run:

```bash
npm run download:zk-files --workspace=packages/agent
```

## Platform notes

- **Node 22.12 or later** is required to run the published package (declared in `engines`; `@puppeteer/browsers`, used to download Chrome for Testing, needs it). The package ships compiled `lib/*.js`, so no TypeScript type-stripping is needed at runtime.

  Any line from 22.12 works, including non-LTS ones such as 25. The one native addon that used to break this, `re2`, became an **optional** dependency in `@reclaimprotocol/attestor-core` 5.0.8 and degrades to the native `RegExp` when its binary is absent. The other native dependency, `koffi`, is N-API, so it ships ABI-independent prebuilts for every platform and was never version-sensitive. An LTS line (22 or 24) is still recommended, because `re2` is present there and gives faster, ReDoS-safe matching.

  Working on the package **from a checkout** additionally needs **Node 22.18 or later**: the test suite and the dev workflow run bare `.ts` files directly, and unflagged TypeScript type-stripping landed in 22.18.
- **Chrome 136+ silently disables `--remote-debugging-port`** when launched against the default user profile. `dedicated` mode (the default) sidesteps this by always passing `--user-data-dir=~/.reclaim/chrome-profile`.

## Tests

`npm test` runs the unit and integration suite. Chrome isn't needed.

The Chrome CDP end-to-end test at `tests/e2e-chrome.test.ts` is gated behind an env var. It launches headless Chrome with a dedicated temp profile, captures a navigation against a local fixture server, and asserts the synthesizer finds the right request. To run it:

```bash
# bash / macOS / Linux
RECLAIM_AGENT_E2E=1 npm test --workspace=packages/agent

# Windows PowerShell
$env:RECLAIM_AGENT_E2E=1; npm test --workspace=packages/agent
```

The test requires Chrome, Chromium, or Edge installed somewhere `findChromeBinary` can locate it, or `RECLAIM_AGENT_CHROME_PATH` pointing at the binary. It self-skips when no binary is found.

## Disable the browser tools

The MCP server registers the provider-authoring (Chrome and CDP) tools by default in both modes. To disable them — for example, in a hosted deployment with no local Chrome — set:

```bash
RECLAIM_AGENT_DISABLED=1
```

## For contributors — wiring a local build into Claude Code / opencode

> This section is for working **on this package from a checkout**. Consumers should use the published package via [Install](#install) instead.

First build so `lib/mcp-bin.js` exists, then point your agent at that file by absolute path (not `npx`):

```bash
npm install                              # once, from the repo root
npm run build --workspace=packages/agent # rebuild after changes (or `npm run dev` to watch)
```

### MCP server

**Claude Code** — register the local binary:

```bash
# from the repo root; -s user for a global install (omit for project scope → .mcp.json)
claude mcp add reclaim -- node "$(pwd)/packages/agent/lib/mcp-bin.js"
```

…or add it to `.mcp.json` yourself, using an **absolute path**:

```json
{
  "mcpServers": {
    "reclaim": {
      "command": "node",
      "args": ["/abs/path/to/developer-tools/packages/agent/lib/mcp-bin.js"]
    }
  }
}
```

**opencode** — add to `opencode.json` (project) or `~/.config/opencode/opencode.json` (global), again with an absolute path:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "reclaim": {
      "type": "local",
      "command": ["node", "/absolute/path/to/developer-tools/packages/agent/lib/mcp-bin.js"],
      "enabled": true
    }
  }
}
```

To override the default backend while developing, add an `env` block (Claude Code / `.mcp.json`) or `environment` (opencode) with `"USE_OLD_DEVTOOLS": "true"` for legacy devtools. See [Backends](#backends).

### Authoring guide

Everything the `how_it_works` tool serves lives in `skill/` as markdown — edit it and rebuild (`npm run build`) to change what the tool returns.

| file | what it is |
| --- | --- |
| `builder-mode.md`, `old-mode.md` | The server's **always-on** `instructions`, one per backend. Every client pays for these on every turn — keep them short and keep the depth in a topic. |
| `SKILL.builder.md`, `SKILL.old.md` | The authoring guide per backend, split into `<!-- topic: name -->` blocks. Each block is one `how_it_works` topic. |
| `SKILL.common.md` | Prose shared by both guides, in `<!-- section: name -->` blocks. A guide splices one in with `<!-- common: name -->`. |
| `user-script.md`, `interception.md`, `hash-validation.md` | Backend-independent topics, served as-is to both modes. |
| `zkfetch.md` | Builder-only `zkfetch` topic: proving a server-side fetch with zkFetch in Builder mode. |
| `js-sdk-integration.md` | Served by the old-devtools `get_js_sdk_integration_guide` tool, not by `how_it_works`. |

Two mechanics to know when editing:

- `%CTX%` expands to the mode's consumer-param namespace (`context.` on builder, `context_` on old-devtools). It is usually the *only* difference between the two modes, which is what lets a block stay in `SKILL.common.md` instead of being duplicated and drifting.
- Every topic needs a one-line entry in `TOPIC_SUMMARIES` (`src/mcp/instructions.ts`) — it's what the tool advertises in its index. Assembly asserts on a missing section or summary, so a typo fails at server start rather than silently serving an empty topic.

**Do not inline docs into a tool's input schema.** A schema description is sent to the model on every request; the injection guide that used to live in the publish tool's `jsUserScripts` field was about half the entire old-devtools tool surface on its own. Put the prose in a topic and leave a pointer.

### Writing conventions for `skill/` and tool descriptions

These follow the [Agent Skills best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) and the [Google developer documentation style guide](https://developers.google.com/style):

- **Assume the model is smart.** Only write what it can't infer. Every token in a topic competes with the task.
- **Keep each topic focused and one level deep.** A topic links to other topics by name; it never chains through a third file. Give any topic over 100 lines a `## Contents` list at the top, so a partial read still shows its full scope.
- **One term per concept.** "provider", not "verification" or "recipe". "developer", not "dev", "user", or "operator". "user script", not "injection".
- **Reserve capitals for hard rules.** NEVER, MUST, ONLY, and NOT earn all caps; use bold for ordinary emphasis.
- **Write in American English, in the second person, in the present tense.** Spell out "for example" and "that is" rather than "e.g." and "i.e.".
- **Every tool description says what the tool does and when to call it**, plus any constraint the model can't discover by calling it.
- **No time-sensitive statements.** Pin facts to a version or a named behavior, not to a date.
