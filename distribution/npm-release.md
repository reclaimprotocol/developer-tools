# npm release

This repository publishes `@reclaimprotocol/client` and `@reclaimprotocol/agent`. The source lives in the private Builder repository and is mirrored here, so you set versions in Builder and release from here.

## Release flow

1. In Builder, run `npm run version:bump`. This sets the same version in both packages and pins the agent's `@reclaimprotocol/client` dependency to it.
2. After the change merges in Builder, the mirror workflow opens or updates the `mirror/builder` pull request in this repository. Merge it (auto-merge is enabled).
3. The merge to `main` runs `.github/workflows/release.yml`, which:
   1. Runs `scripts/release-plan.mjs`. The script fails if the two versions differ or the agent doesn't depend on the exact client version. It checks npm and plans only the versions that are missing, and checks whether the `v<version>` tag exists, so reruns are safe.
   2. The `build` job runs `npm ci`, `npm run build`, and `npm test`, packs both packages, and uploads the tarballs as an artifact. It has read-only permissions and no OIDC identity.
   3. The `publish` job runs in the `npm` environment, on `main` only. It downloads the tarballs and publishes `@reclaimprotocol/client`, then `@reclaimprotocol/agent`, with `--provenance --access public`. It runs no repository or dependency code.
   4. The `tag` job creates the `v<version>` tag at the workflow commit and a GitHub release with generated notes. If the tag already exists, the job fails unless it points at the same commit.
   5. The `registry` job calls `publish-mcp-registry.yml` with the release version to publish the MCP Registry entry.

The `tag` and `registry` jobs run when the plan reports `release=true` (after `publish` succeeds) or when `tag_needed=true`, meaning the tag is missing even though npm already has both versions. They never run after a failed `publish`.

In `publish-mcp-registry.yml`, a `check` job with no OIDC identity fetches the exact release version from npm (retrying for about a minute while the registry catches up), fails if the version or its `mcpName` is missing, writes the version into `server.json`, verifies the published package, and uploads the prepared `server.json` as an artifact. Manual and `push` runs have no version input and use the latest version on npm instead. The `publish` job runs in the `mcp-registry` environment, on `main` only. It downloads the prepared `server.json`, validates it, logs in, and publishes, using only the pinned `mcp-publisher`.

`publish-mcp-registry.yml` also keeps its own `push` trigger for `server.json` edits that aren't part of a release. A release doesn't change `server.json`, so the two triggers don't publish twice. You can also run it manually with `workflow_dispatch`.

The agent package must keep this field:

```json
"mcpName": "io.github.reclaimprotocol/builder"
```

## One-time npm setup

Publishing uses npm trusted publishing (OIDC), so the repository stores no npm token. For each package, `@reclaimprotocol/client` and `@reclaimprotocol/agent`, open the package's **Settings** on npmjs.com and add a trusted publisher with:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `reclaimprotocol` |
| Repository | `developer-tools` |
| Workflow filename | `release.yml` |
| Environment name | `npm` |

Also create these GitHub environments in this repository:

| Environment | Deployment branches | Used by |
| --- | --- | --- |
| `npm` | `main` only | The `publish` job in `release.yml` |
| `mcp-registry` | `main` only | The `publish` job in `publish-mcp-registry.yml` |

Bind the npm trusted publisher to both the `release.yml` workflow and the `npm` environment. Every publishing job also checks `github.ref == 'refs/heads/main'`, so a run started from another branch doesn't publish.

Trusted publishing requires npm 11.5.1 or later. The workflow uses the npm bundled with Node 24 and fails if it's older.

## Rerun a release

If a run fails part way, rerun the workflow (**Actions** > **Release** > **Run workflow**, or **Re-run failed jobs**). The plan step skips versions that are already on npm, so:

- If only one package published, the rerun publishes the other, then tags and registers.
- If npm has both versions but the run failed before the `tag` or `registry` job, the plan reports `tag_needed=true` and the rerun creates the tag and release and publishes the registry entry without publishing to npm.
- If the `registry` job alone failed after the tag exists, run `publish-mcp-registry.yml` manually (**Actions** > **Publish Builder MCP registry metadata** > **Run workflow**). It registers the latest version on npm.
