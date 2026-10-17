# Reclaim developer tools

[![Add to Claude Code](https://img.shields.io/badge/Add%20to-Claude%20Code-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](#claude-code)
[![Add to Codex](https://img.shields.io/badge/Add%20to-Codex-000000?style=for-the-badge&logo=openai&logoColor=white)](#codex)
[![Add to GitHub Copilot](https://img.shields.io/badge/Add%20to-GitHub%20Copilot-000000?style=for-the-badge&logo=githubcopilot&logoColor=white)](#github-copilot--vs-code)
[![Add to Cursor](https://img.shields.io/badge/Add%20to-Cursor-000000?style=for-the-badge&logo=cursor&logoColor=white)](#cursor)
[![Add to OMP](https://img.shields.io/badge/Add%20to-OMP-5B5BD6?style=for-the-badge)](#omp)

Install the **Reclaim MCP server** into your AI coding agent.

Reclaim Protocol lets your app verify **data points** about its users — a follower count, an account balance, an order history. The MCP server gives your agent the tools to find, build, test, and fix the **data verification providers** that do the verifying: it inspects and replays captured requests, checks verification sessions, evaluates proofs, and publishes provider updates.

The server is published to npm as [`@reclaimprotocol/agent`](https://www.npmjs.com/package/@reclaimprotocol/agent) (bin: `reclaim-mcp-server`). This repository carries plugins and marketplaces for clients that support them, plus direct install instructions for every other client.

## Contents

- [Prerequisites](#prerequisites)
- [Claude Code](#claude-code)
- [Claude Desktop](#claude-desktop)
- [GitHub Copilot / VS Code](#github-copilot--vs-code)
- [Cursor](#cursor)
- [OMP](#omp)
- [OpenCode](#opencode)
- [Codex](#codex)
- [Antigravity](#antigravity)
- [Windsurf, Cline, and other MCP clients](#windsurf-cline-and-other-mcp-clients)
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

## GitHub Copilot / VS Code

GitHub Copilot recognizes the Claude-compatible marketplace already included in this repository. Install it from Copilot CLI:

```bash
copilot plugin marketplace add reclaimprotocol/developer-tools
copilot plugin install reclaim@reclaim
```

To pick up a newer version later, run:

```bash
copilot plugin marketplace update reclaim
copilot plugin update reclaim
```

In VS Code, add this repository to the `chat.plugins.marketplaces` setting:

```json
"chat.plugins.marketplaces": ["reclaimprotocol/developer-tools"]
```

Then run **Chat: Open Customizations**, open **Plugins**, and install `reclaim` from the `reclaim` marketplace. VS Code's agent-plugin marketplace is currently experimental.

## Cursor

This repository is a Cursor marketplace. Add it from the Cursor CLI:

```bash
agent plugin marketplace add https://github.com/reclaimprotocol/developer-tools.git
```

Then open Cursor's **Customize** page (or `/plugin` in Cursor Agent), find `reclaim` in the `reclaim` marketplace, and install it at user or project scope. Cursor does not currently expose a non-interactive plugin-install command.

To refresh the catalog manually, run `agent plugin marketplace update reclaim`. Cursor Teams and Enterprise admins can instead import this repository as a team marketplace and enable **Auto Refresh** so pushes are re-indexed automatically.

**Advanced fallback — add the MCP server directly.** Skip this if you installed the plugin. Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

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

## OMP

Install the plugin from the native OMP marketplace:

```bash
omp plugin marketplace add reclaimprotocol/developer-tools
omp plugin install reclaim@reclaim
```

Enable automatic catalog and plugin upgrades:

```bash
omp config set marketplace.autoUpdate auto
```

To update immediately instead, run:

```bash
omp plugin marketplace update reclaim
omp plugin upgrade reclaim@reclaim
```

OMP can also read the Claude marketplace in this repository as a compatibility fallback, but the native `.omp-plugin/marketplace.json` is preferred.

## OpenCode

OpenCode does not currently have a Git marketplace format for MCP plugins. Its distributable plugins are npm modules, and its documented plugin API does not provide a stable way for a package to register an MCP server. Use the native MCP configuration instead.

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

The package reference is intentionally unpinned. OpenCode starts the command through `npx`, which resolves the current `@reclaimprotocol/agent` release without requiring a marketplace manifest update.

## Codex

Install the plugin from the marketplace:

```bash
codex plugin marketplace add reclaimprotocol/developer-tools
codex plugin add reclaim@reclaim
```

To pick up a newer plugin version later, run `codex plugin marketplace upgrade reclaim`.

**Advanced fallback — add the MCP server directly.** Skip this if you installed the plugin:

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

## Antigravity

Install the GitHub-hosted Antigravity plugin:

```bash
agy plugin install https://github.com/reclaimprotocol/developer-tools
```

Antigravity currently supports only its curated official marketplace, not third-party marketplace catalogs. This repository includes the root `plugin.json` and `mcp_config.json` needed for direct GitHub installation and is ready to submit through [Antigravity's marketplace interest form](https://forms.gle/2EX5RFYPoJe1UgxR9). Until it is accepted into the official catalog, update a direct install by reinstalling it from the GitHub URL.

## Windsurf, Cline, and other MCP clients

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

The defaults target Builder, so **the common case needs no environment at all**. To opt into legacy devtools, add an `env` block — `environment` in opencode — to the config above:

```json
"env": {
  "USE_OLD_DEVTOOLS": "true"
}
```

To switch back to Builder, remove the override or set `USE_OLD_DEVTOOLS=false`. For the full list of variables, see the [`@reclaimprotocol/agent`](https://www.npmjs.com/package/@reclaimprotocol/agent) package docs.

## Using it from your agent

The MCP server is all you need. It ships a `how_it_works` tool that serves the capture → prove → publish guide **one topic at a time** — login detection, choosing an authentication-bound endpoint, the OPRF privacy decision, publishing, troubleshooting. Call it with no arguments for the overview and the topic index, then again for the topic you need.

Have your agent call `how_it_works` first, then ask in plain language. For example:

> "Use Reclaim to create a provider that proves my GitHub follower count."

The agent orchestrates authentication, browser capture, provider synthesis, replay, the zkTLS proof, and publishing. Your only manual steps are signing in when the browser window opens and confirming the value you want to prove.

## Maintaining this repository

```
.claude-plugin/marketplace.json     Claude and GitHub Copilot marketplace metadata
.agents/plugins/marketplace.json    Codex marketplace + the plugin entry
.cursor-plugin/marketplace.json     Cursor marketplace metadata + the plugin entry
.omp-plugin/marketplace.json        OMP marketplace metadata + the plugin entry
plugin.json                         Antigravity plugin manifest
mcp_config.json                     Antigravity MCP configuration
reclaim/.claude-plugin/plugin.json  Claude and GitHub Copilot plugin manifest
reclaim/.codex-plugin/plugin.json   Codex plugin manifest
reclaim/.cursor-plugin/plugin.json  Cursor plugin manifest
reclaim/.mcp.json                   The shared stdio command used by marketplace plugins
scripts/sync-version.ts             Version sync (below)
```

Every plugin runs the published [`@reclaimprotocol/agent`](https://www.npmjs.com/package/@reclaimprotocol/agent) through `npx`, so the version in the manifests tracks that package rather than anything in this repository. To sync it (Node 22.18 or later):

```bash
npm run sync-version            # use the latest @reclaimprotocol/agent on npm
npm run sync-version -- 0.2.0   # or set an explicit version
```

It rewrites every `version` field in the Claude, Cursor, and OMP marketplace catalogs, the Antigravity manifest, and each versioned client plugin manifest while preserving file formatting. The Codex marketplace has no version field.

Run this **after** bumping the version in the [builder](https://github.com/reclaimprotocol/builder) monorepo and publishing the package — the npm lookup only finds a version that already exists.

Validate the manifests before committing:

```bash
claude plugin validate .          # Claude marketplace manifest
claude plugin validate ./reclaim  # Claude plugin manifest
agy plugin validate .             # Antigravity plugin
omp plugin marketplace add "$PWD" # add the checkout, then use the dry-run below
omp plugin install --dry-run reclaim@reclaim
omp plugin marketplace remove reclaim
```

Codex has no validate command. Install from your checkout in a throwaway Codex home instead:

```bash
export CODEX_HOME="$(mktemp -d)"
codex plugin marketplace add "$PWD"
codex plugin add reclaim@reclaim
codex mcp list                    # lists the reclaim server
```
