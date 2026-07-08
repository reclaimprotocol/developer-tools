# Reclaim developer tools

Installation and Claude Code marketplace for the **Reclaim MCP server** — Chrome-CDP + zkTLS provider-authoring tools. The server captures network traffic from a browser, synthesizes Reclaim provider definitions (`contains` matchers + `jsonPath` / `xPath` / `regex` redactions), runs a local replay diagnostic, and produces a verified attestor proof.

The server itself is published to npm as [`@reclaimprotocol/agent`](https://www.npmjs.com/package/@reclaimprotocol/agent) (bin: `reclaim-mcp-server`); this repo carries the Claude Code plugin/marketplace and the install instructions for every client.

## Prerequisites

- **Node ≥ 20** — works best on a current **LTS** release (22 or 24). Any Node ≥ 20 works, including non-LTS lines like 25; LTS is only *recommended*.
- A local **Chrome / Chromium / Edge** (used for capture and the dashboard login).

The first time you run a proof, the server downloads the ZK circuit files it needs (~280 MB) — allow a moment for that first proof. The download is deferred to first proof on purpose (not an install step), so the MCP server itself starts immediately.

It runs as a **stdio MCP server**. Point any MCP-capable agent at this command:

```bash
npx -y --package=@reclaimprotocol/agent reclaim-mcp-server
```

> The `--package=` (short form `-p`) flag selects the `reclaim-mcp-server` binary from the package. We use the long `--package=` form throughout because the short `-p` collides with the `-p`/`--print` flag of some agent CLIs (notably `claude mcp add`), which silently swallows the command. Prefer a global install? Run `npm i -g @reclaimprotocol/agent` and use `reclaim-mcp-server` directly as the `command` (drop the `npx` wrapper and its `args`).

## Claude Code

**Recommended — install the plugin from the marketplace** (no `claude mcp add`, no `-p` collision; the server's `how_it_works` tool serves the authoring guide on demand):

```
/plugin marketplace add reclaimprotocol/developer-tools
/plugin install reclaim@reclaim
```

Prefer this over the manual `claude mcp add` below unless you have a specific reason not to.

**Advanced / fallback — add the MCP server directly** (skip if you used the plugin above):

```bash
# project scope → writes .mcp.json; add `-s user` for a global install
claude mcp add reclaim -- npx -y --package=@reclaimprotocol/agent reclaim-mcp-server
```

…or add it to `.mcp.json` yourself:

```json
{
  "mcpServers": {
    "reclaim": {
      "command": "npx",
      "args": ["-y", "--package=@reclaimprotocol/agent", "reclaim-mcp-server"]
    }
  }
}
```

## Claude Desktop (macOS / Windows app)

Claude Desktop is the standalone consumer app — **separate from Claude Code**, and it does **not** support the plugin marketplace (`/plugin …` is Claude Code only). Configure the MCP server manually via its config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Edit it (via **Settings → Developer → Edit Config**, or open the file directly) and add:

```json
{
  "mcpServers": {
    "reclaim": {
      "command": "npx",
      "args": ["-y", "--package=@reclaimprotocol/agent", "reclaim-mcp-server"]
    }
  }
}
```

Then **fully quit and reopen** Claude Desktop (a window close is not enough) so it re-reads the config and starts the server.

> **Node must be on the app's PATH.** Claude Desktop launches the server as a subprocess using the environment it inherits at startup — it does **not** bundle Node. If the server shows as failed, either install Node ≥ 20 and relaunch, or set `"command"` to an **absolute path** to `npx`/`node` (find it with `which npx`), since GUI-launched apps sometimes get a minimal PATH. Chrome capture works the same as anywhere else.

## Cursor

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "reclaim": {
      "command": "npx",
      "args": ["-y", "--package=@reclaimprotocol/agent", "reclaim-mcp-server"]
    }
  }
}
```

## opencode

Add to `opencode.json` (project) or `~/.config/opencode/opencode.json` (global):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "reclaim": {
      "type": "local",
      "command": ["npx", "-y", "--package=@reclaimprotocol/agent", "reclaim-mcp-server"],
      "enabled": true
    }
  }
}
```

## Codex

```bash
# writes ~/.codex/config.toml
codex mcp add reclaim -- npx -y --package=@reclaimprotocol/agent reclaim-mcp-server
```

…or add it to `~/.codex/config.toml` yourself (Codex uses TOML, not JSON):

```toml
[mcp_servers.reclaim]
command = "npx"
args = ["-y", "--package=@reclaimprotocol/agent", "reclaim-mcp-server"]
```

## Antigravity, Windsurf, VS Code, Cline & other MCP clients

These all use the standard `mcpServers` shape — add a server through the app's MCP settings (or its `mcp`/`mcpServers` config file) with:

```json
{
  "mcpServers": {
    "reclaim": {
      "command": "npx",
      "args": ["-y", "--package=@reclaimprotocol/agent", "reclaim-mcp-server"]
    }
  }
}
```

## Optional environment

Defaults target the production old-devtools backend, so **no env is needed for the common case**. To override, add an `env` block (or `environment` in opencode) to the config above:

```json
"env": {
  "USE_OLD_DEVTOOLS": "true",
  "RECLAIM_OLD_API_URL": "https://devapi.reclaimprotocol.org"
}
```

For builder mode (`USE_OLD_DEVTOOLS=false`) and the full env-var list, see the [`@reclaimprotocol/agent`](https://www.npmjs.com/package/@reclaimprotocol/agent) package docs.

## Using it from your agent

The MCP server is all you need — it ships a `how_it_works` tool that returns the full capture → prove → publish guide (login detection, choosing auth-bound endpoints, OPRF decisions, troubleshooting). Have your agent call `how_it_works` first, then just ask in plain language, e.g.:

> "Use Reclaim to create a provider that proves my GitHub follower count."

The agent orchestrates authentication, Chrome capture, provider synthesis, replay, the zkTLS proof, and publishing for you. Your only manual steps are signing in when the browser windows open and confirming the value you want to prove.

## Maintaining

The plugin runs the published [`@reclaimprotocol/agent`](https://www.npmjs.com/package/@reclaimprotocol/agent) via `npx`, so the version shown in the marketplace/plugin manifests should track that package. To sync it (requires Node on your PATH):

```bash
node scripts/sync-version.ts          # copy the latest @reclaimprotocol/agent version from npm
node scripts/sync-version.ts 0.2.0    # or set an explicit version
```

It rewrites the `version` fields in `.claude-plugin/marketplace.json` (marketplace metadata + the plugin entry) and `reclaim/.claude-plugin/plugin.json`, preserving formatting.
