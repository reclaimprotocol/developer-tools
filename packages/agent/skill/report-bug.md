# Report or fix a bug in the SDK or MCP server

Use this topic when `@reclaimprotocol/client` or this MCP server
(`@reclaimprotocol/agent`) is at fault. The public source is
<https://github.com/reclaimprotocol/developer-tools> (`packages/client`,
`packages/agent`). It's mirrored from Reclaim's private monorepo.

## When to use it

- A thrown error or stack trace inside `@reclaimprotocol/client`.
- Types that disagree with what the API returns.
- An MCP tool that crashes or returns malformed output.
- A skill topic that's wrong or contradicts the tools.

Don't use it for:

- The developer's own app code.
- A provider recipe that fails: use the authoring topics (`prove`, `publish`).
- Account or billing issues: send the developer to support@reclaimprotocol.org.

## Confirm and collect

Rule out your own mistake first: re-read the tool's schema and the relevant
topic, and retry once. Then collect:

- Package versions: `npm ls @reclaimprotocol/client @reclaimprotocol/agent`.
- The running MCP server version: the `serverInfo.version` from the
  `initialize` handshake (your MCP client usually shows it), or the
  `@reclaimprotocol/agent` version pinned in the MCP client configuration.
- `node --version` and the OS.
- The exact error message and stack trace.
- A minimal reproduction: the smallest call or snippet that fails.

Redact before you write anything down. Never include org keys (`rorg_…`),
private keys, OAuth tokens, cookies, captured request or response bodies, or
end-user data. Replace each with a placeholder such as `<redacted>`.

## Search first

```bash
gh issue list -R reclaimprotocol/developer-tools --search "<keywords>" --state all
gh pr list -R reclaimprotocol/developer-tools --search "<keywords>" --state all
```

If a matching issue exists, tell the developer, link it, and go to
[Workaround](#workaround). Don't open a duplicate.

## Prefer a fix PR

This action is public and outward-facing. Ask first, naming it exactly, for
example: "Approve forking `reclaimprotocol/developer-tools` and opening a
public pull request that fixes this bug?" End your turn with that question.
Don't continue without a yes.

After approval:

1. `gh repo fork reclaimprotocol/developer-tools --clone`, then
   `cd developer-tools` and `git switch -c fix/<short-slug>`.
2. `npm ci`.
3. Change only `packages/client` or `packages/agent`.
4. Add or update a test that fails before the fix and passes after it.
5. Run `npm test -w @reclaimprotocol/<pkg>`,
   `npm run check -w @reclaimprotocol/<pkg>`, and
   `npm run build -w @reclaimprotocol/<pkg>`.
6. Commit with a clear message, then `git push -u origin HEAD`.
7. `gh pr create -R reclaimprotocol/developer-tools --head <your-github-login>:fix/<short-slug> --title "<title>" --body-file <file>`.
   The description lists: the problem, the reproduction, the fix, the test,
   and the versions.

Tell the developer what to expect: a maintainer ports it upstream; when the
change syncs back, a bot closes your PR with a link and you're credited as
co-author. It isn't "merged" in the usual sense. That's expected.

## If a fix isn't feasible

Open an issue with the same fields (problem, reproduction, versions, redacted
error):

```bash
gh issue create -R reclaimprotocol/developer-tools --title "<title>" --body-file <file>
```

This also needs the developer's approval. If `gh` isn't authenticated, don't
ask the developer to paste secrets anywhere. Give them a prefilled,
URL-encoded link instead, with a short body:

`https://github.com/reclaimprotocol/developer-tools/issues/new?title=<title>&body=<body>`

## Workaround

Help the developer keep going while the bug is open:

- Pin the last version that worked:
  `npm install @reclaimprotocol/client@<version>`.
- For the MCP server, pin `@reclaimprotocol/agent@<version>` in the MCP client
  configuration.
- Avoid the failing call, or use a different tool or topic for the same step.
