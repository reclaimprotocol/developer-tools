# Maintainer guide: repository settings

This repository is the home of `@reclaimprotocol/client` and `@reclaimprotocol/agent`. Reclaim's private Builder repository includes it as a git submodule at `packages/developer-tools`. The release workflow only publishes safely when an organization or repository admin applies the settings in this guide.

## How changes flow

- Pull requests to this repository, from Reclaim staff and outside contributors alike, are reviewed and merged here.
- Builder pins a commit of this repository. To use a change in Builder, open a Builder pull request that moves the submodule to a commit on `main`.
- The `*.gen.ts` files come from Builder's `packages/app/openapi.yaml`. An API change starts in Builder: run `npm run gen` there, open a pull request here with the regenerated files, and after it merges, point Builder's submodule at the merge commit.
- Pushes to `main` that change a package version run `release.yml`, which publishes to npm and the MCP Registry.

## Rulesets

Use rulesets (**Settings > Rules > Rulesets**) rather than classic branch protection, because rulesets have no implicit admin bypass.

### Ruleset for `main`

Target: the default branch. Enforcement: **Active**. Bypass list: **empty**.

- Require a pull request before merging, with at least one approval.
- Require review from Code Owners. Replace the placeholder team in `.github/CODEOWNERS` first.
- Require the status check `ci` to pass.
- Block force pushes and deletions.

Why: Builder deploys whatever commit its submodule points at, and npm releases come from `main`. Reviewed pull requests are the only way in.

### Tag ruleset for `v*`

Target: tags matching `v*`. Enforcement: **Active**.

- Restrict creations, updates, and deletions to repository admins (bypass list: the Admin role).
- Block force pushes.

Why: `release.yml` creates `v<version>` tags. Restricting tags stops other people from creating release tags by hand. If the workflow's `GITHUB_TOKEN` can't create tags under this rule, add the workflow's actor to the bypass list.

## Actions settings

1. Go to **Settings > Actions > General**.
2. Under **Fork pull request workflows from outside collaborators**, select **Require approval for all outside collaborators**.
3. Under **Workflow permissions**, select **Read repository contents and packages permissions**. Don't allow Actions to create or approve pull requests.
4. Under **Actions permissions**, allow actions only from GitHub and the specific actions the workflows pin by SHA.

## Environments

Go to **Settings > Environments** and create:

| Environment | Used by | Deployment branches | Reviewers |
| --- | --- | --- | --- |
| `npm` | `release.yml` publish jobs | Selected branches: `main` only | Optional |
| `mcp-registry` | MCP Registry publish job | Selected branches: `main` only | Optional |

Why: npm trusted publishing and the registry's GitHub OIDC login trust the environment name. Limiting the environments to `main` keeps a pull request branch from publishing. Add required reviewers if you want a manual gate on each release.

## npm trusted publishers

For each package (`@reclaimprotocol/client` and `@reclaimprotocol/agent`):

1. Go to the package's **Settings > Trusted Publisher** on npmjs.com.
2. Select **GitHub Actions**, then enter the organization `reclaimprotocol`, repository `developer-tools`, workflow filename `release.yml`, and environment `npm`.
3. Under **Publishing access**, select **Require two-factor authentication and disallow tokens**, and revoke any old automation tokens.

Why: the publish job authenticates with OIDC, so there's no long-lived npm token to steal. The workflow filename and environment pin the identity to the one job that should publish.

## Security reporting

1. Go to **Settings > Code security**.
2. Turn on **Private vulnerability reporting**.
3. Turn on **Dependabot alerts** and **Secret scanning with push protection**.

## Verify the setup

1. Open a test pull request from a fork. Confirm that `ci` needs approval to run and that merging needs a code owner review.
2. Confirm that you can't push to `main` or create a `v*` tag directly.
3. After the first release, confirm that npm shows provenance for both packages.
