---
name: adding-reclaim-verification
description: Adds Reclaim Protocol verification to an app, builds or fixes Reclaim providers, and diagnoses failed verification sessions, using the tools of the Reclaim MCP server. Use when the developer wants to prove or verify a user's data point (followers, account balance, orders, account ownership), says "add Reclaim to my app", asks to build, fix, or publish a Reclaim provider, or asks why a Reclaim verification session failed.
---

# Adding Reclaim verification

The tools named here come from the Reclaim MCP server. They are available when the Reclaim plugin is installed and loaded.

## Terms

- A provider is a recipe that extracts a data point from a site.
- A verification is an end-user session that proves a data point with a provider.

Never call a provider a "verification."

## If the Reclaim tools are missing

Don't run the install commands yourself. Installing a plugin adds third-party code, and permission checks can block it. Give the developer these commands to run in a terminal. In Claude Code, they can type each one in the prompt with a `!` prefix:

```bash
claude plugin marketplace add reclaimprotocol/developer-tools
claude plugin install reclaim@reclaim
```

Then ask them to run `/reload-plugins` in the open session and to paste their request again. For other clients, point them to https://github.com/reclaimprotocol/developer-tools#readme.

## Route the request

- Add verification to an app: call `start_integration` with the developer's goal, then follow the plan it returns.
- Build, fix, or publish a provider: call `how_it_works` with no arguments for the topic index, then once per topic you need.
- Failed or stuck verification session: call `get_verification_session` for the status, `list_verification_events` for progress, and `list_verification_deliveries` for callback delivery. Report the cause and the fix.
- Unclear goal: ask one short question.

Ask each question once. Put every link the developer needs in the same message as the question.

## Permission blocks

Claude Code auto mode can block destructive Reclaim tools, such as those that delete org resources. If a tool call is blocked:

1. Don't retry it or work around it.
2. In one message, name the exact tool and say what approving it does.
3. Tell the developer they can approve it in `/permissions` (Recently denied tab), or add that tool to `permissions.allow` in `~/.claude/settings.json`. Plugin tool names look like `mcp__plugin_reclaim_reclaim__<tool>`. Recommend specific tools, not a wildcard.

## Secrets

- Never print, echo, or ask for an org key (`rorg_…`) or a private key.
- The credential tools write keys to the project's env file. When they replace a value, they back up the old one to `<envFile>.backup`.
- Use those tools, not shell commands that read secret files.
