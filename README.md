# Reclaim developer tools

[![Add to Claude Code](https://img.shields.io/badge/Add%20to-Claude%20Code-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](#claude-code)

Install the **Reclaim MCP server** into your AI coding agent.

Reclaim Protocol lets your app verify **data points** about its users — a follower count, an account balance, an order history. The MCP server gives your agent the tools to find, build, test, and fix the **data verification providers** that do the verifying: it inspects and replays captured requests, checks verification sessions, evaluates proofs, and publishes provider updates.

The server is published to npm as [`@reclaimprotocol/agent`](https://www.npmjs.com/package/@reclaimprotocol/agent) (bin: `reclaim-mcp-server`). This repository carries the Claude Code plugin and marketplace, plus install instructions for every other client.

## Contents

- [Prerequisites](#prerequisites)
- [Claude Code](#claude-code)
- [Claude Desktop](#claude-desktop)
- [Cursor](#cursor)
- [opencode](#opencode)
- [Codex](#codex)
- [Antigravity, Windsurf, VS Code, Cline, and other MCP clients](#antigravity-windsurf-vs-code-cline-and-other-mcp-clients)
- [Optional environment](#optional-environment)
- [Using it from your agent](#using-it-from-your-agent)
- [Maintaining this repository](#maintaining-this-repository)

## Prerequisites

- **Node 20 or later.** Any line works, but a current LTS line (22, 24, or 26) is recommended.
- **A local Chrome, Chromium, or Edge.** The server drives a real browser to capture traffic and to sign you in.

The first time you run a proof, the server downloads the ZK circuit files it needs, about 280 MB. Allow a moment for that first proof. The download is deferred to the first proof rather than run at install time, so the server itself starts immediately.

Every client below runs the same **stdio MCP server**:

```bash
npx -y --package=@reclaimprotocol/agent reclaim-mcp-server
```

> The long `--package=` form is deliberate. The short `-p` collides with the `-p`/`--print` flag of some agent CLIs, notably `claude mcp add`, which silently swallows the command.

## Claude Code

Install the plugin from the marketplace:

```bash
claude plugin marketplace add reclaimprotocol/developer-tools
claude plugin install reclaim@reclaim
```

Prefer this over the manual `claude mcp add` below unless you have a specific reason not to.

**Advanced fallback — add the MCP server directly.** Skip this if you installed the plugin:

```bash
# -s user installs it for your user, across projects
claude mcp add reclaim -s user -- npx -y --package=@reclaimprotocol/agent reclaim-mcp-server
```

Or add it to `.mcp.json` yourself:

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

Run `/mcp` inside Claude Code to confirm the server connected.

## Claude Desktop

Add the same `mcpServers` entry through the app's MCP settings, then **fully quit and reopen** Claude Desktop. Closing the window is not enough — it re-reads the config only on a full restart.

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

Or add it to `~/.codex/config.toml` yourself. Codex uses TOML, not JSON:

```toml
[mcp_servers.reclaim]
command = "npx"
args = ["-y", "--package=@reclaimprotocol/agent", "reclaim-mcp-server"]
```

## Antigravity, Windsurf, VS Code, Cline, and other MCP clients

These all use the standard `mcpServers` shape. Add a server through the app's MCP settings, or its `mcp`/`mcpServers` config file, with:

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

The defaults target the production backend, so **the common case needs no environment at all**. To override something, add an `env` block — `environment` in opencode — to the config above:

```json
"env": {
  "RECLAIM_OLD_API_URL": "https://devapi.reclaimprotocol.org"
}
```

To switch backends, set `USE_OLD_DEVTOOLS=false` for builder mode. For the full list of variables, see the [`@reclaimprotocol/agent`](https://www.npmjs.com/package/@reclaimprotocol/agent) package docs.

## Using it from your agent

The MCP server is all you need. It ships a `how_it_works` tool that serves the capture → prove → publish guide **one topic at a time** — login detection, choosing an authentication-bound endpoint, the OPRF privacy decision, publishing, troubleshooting. Call it with no arguments for the overview and the topic index, then again for the topic you need.

Have your agent call `how_it_works` first, then ask in plain language. For example:

> "Use Reclaim to create a provider that proves my GitHub follower count."

The agent orchestrates authentication, browser capture, provider synthesis, replay, the zkTLS proof, and publishing. Your only manual steps are signing in when the browser window opens and confirming the value you want to prove.

## Maintaining this repository

```
.claude-plugin/marketplace.json   Marketplace metadata + the plugin entry
reclaim/.claude-plugin/plugin.json  The plugin manifest
reclaim/.mcp.json                 The stdio command the plugin runs
scripts/sync-version.ts           Version sync (below)
```

The plugin runs the published [`@reclaimprotocol/agent`](https://www.npmjs.com/package/@reclaimprotocol/agent) through `npx`, so the version in the manifests tracks that package rather than anything in this repository. To sync it:

```bash
node scripts/sync-version.ts          # use the latest @reclaimprotocol/agent on npm
node scripts/sync-version.ts 0.2.0    # or set an explicit version
```

It rewrites every `version` field in `.claude-plugin/marketplace.json` (both the marketplace metadata and the plugin entry) and in `reclaim/.claude-plugin/plugin.json`, preserving each file's formatting.

Run this **after** bumping the version in the [builder](https://github.com/reclaimprotocol/builder) monorepo and publishing the package — the npm lookup only finds a version that already exists.

Validate the manifests before committing:

```bash
claude plugin validate .          # marketplace manifest
claude plugin validate ./reclaim  # plugin manifest
```
