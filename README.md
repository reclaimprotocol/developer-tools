# Reclaim developer tools

[![Add to Claude Code](https://img.shields.io/badge/Add%20to-Claude%20Code-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](#claude-code)

Installation and Claude Code marketplace for the **Reclaim MCP server** — the tools that helps you use Reclaim Protocol to let your app verify **data points** about its users (a follower count, an account balance, an order history). Gives your AI coding agent the tools to **find, build, test and fix the _data verification providers_** (the recipes that verify a data point) by inspecting and replaying captured requests, checking sessions, evaluate proofs, publishing updates, and much more.

The server itself is published to npm as [`@reclaimprotocol/agent`](https://www.npmjs.com/package/@reclaimprotocol/agent) (bin: `reclaim-mcp-server`); this repo carries the Claude Code plugin/marketplace and the install instructions for every client.

## Prerequisites

- **Node ≥ 20** — works best on a current **LTS** release (22 or 24).

The first time you run a proof, the server downloads the ZK circuit files it needs (~280 MB) — allow a moment for that first proof. The download is deferred to first proof on purpose (not an install step), so the MCP server itself starts immediately.

It runs as a **stdio MCP server**. Point any MCP-capable agent at this command:

```bash
npx -y --package=@reclaimprotocol/agent reclaim-mcp-server
```

## Claude Code

**install the plugin from the marketplace**:

```
/plugin marketplace add reclaimprotocol/developer-tools
/plugin install reclaim@reclaim
```

Prefer this over the manual `claude mcp add` below unless you have a specific reason not to.

**Advanced / fallback — add the MCP server directly** (skip if you used the plugin above):

```bash
# `-s user` installs this for your user
claude mcp add reclaim -s user -- npx -y --package=@reclaimprotocol/agent reclaim-mcp-server
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

If you are using Claude desktop, then **fully quit and reopen** it (a window close is not enough) so it re-reads the config and starts the server.

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
