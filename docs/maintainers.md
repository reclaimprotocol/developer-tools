# Maintainer guide: repository settings

This repository mirrors `packages/client` and `packages/agent` from a private monorepo. The workflows in `.github/workflows` only protect the mirror when an organization or repository admin applies the settings in this guide. Apply every section, because a missing setting leaves a gap that the workflows can't close.

## Mirror flow summary

- A GitHub App (the mirror App) force-pushes the `mirror/builder` branch and opens one rolling pull request.
- The `mirror-guard` check fails any other pull request that changes `packages/**`, `package.json`, `package-lock.json`, `.npmrc`, or `.nvmrc`.
- The sync commit carries one `Ports #N` line for each outside pull request that was ported upstream. `close-ported-prs.yml` closes those pull requests.
- Pushes to `main` that change a package version run `release.yml`, which publishes to npm and the MCP Registry.

## Close ported pull requests

GitHub closing keywords don't close pull requests, so `close-ported-prs.yml` does it. On every push to `main`, the workflow reads the commits in the push and considers only commits whose API author login is `<MIRROR_APP_SLUG>[bot]`. It matches lines of the form `Ports #N` in the commit message, which port-pr and the mirror add for each outside pull request. For each open pull request that it finds, the workflow:

1. Posts a comment that links the sync commit and credits the contributor (once, marked with `<!-- ported-upstream -->`).
2. Replaces the `needs-upstream-port` label with `ported-upstream`, which the workflow creates if it's missing.
3. Closes the pull request.

The workflow needs only `contents: read` and `pull-requests: write`, and it doesn't check out code. Keep the `Ports #N` lines at the start of a line in the sync commit message, including after a squash merge. Pull requests that are already closed or merged are skipped.

## Repository variables and secrets

1. Go to **Settings > Secrets and variables > Actions > Variables**.
2. Create the variable `MIRROR_APP_SLUG` with the slug of the mirror App, for example `reclaim-mirror`. `mirror-guard` compares the pull request author and every commit author and committer with `<slug>[bot]`, and it fails when the variable is empty.

## Pull request settings

1. Go to **Settings > General > Pull Requests**.
2. Turn on **Allow auto-merge**. The mirror pull request relies on it.
3. Turn on **Automatically delete head branches** only if the mirror job recreates `mirror/builder` on every run. Otherwise leave it off.

## Rulesets

Use rulesets (**Settings > Rules > Rulesets**) rather than classic branch protection, because rulesets support required workflows and have no implicit admin bypass.

### Ruleset for `main`

Target: the default branch. Enforcement: **Active**. Bypass list: **empty**.

- Require a pull request before merging, with at least one approval.
- Require review from Code Owners. This protects the paths in `.github/CODEOWNERS`.
- Require status checks to pass: `ci` and `mirror-guard`. Don't turn on **Require branches to be up to date before merging** (see the next section).
- Block force pushes and deletions.

#### Merge the mirror pull request

The App can't approve its own pull request, so a maintainer approves the rolling mirror pull request. After the approval and passing checks, auto-merge completes the merge.

Don't require branches to be up to date. If the mirror pull request falls behind `main`, **Update branch** adds a merge commit that the App didn't author, and `mirror-guard` rejects it. Instead, re-run the mirror workflow in builder (**Actions** > **Mirror public packages** > **Run workflow**). It force-pushes a fresh `mirror/builder` branch on top of `main` and updates the pull request.

`.github/CODEOWNERS` has no owner for `/.github/plugin/`, because the mirror's version sync edits `.github/plugin/marketplace.json`. Don't add owners for that path or for any other file that the mirror's version sync edits. The sync also edits `.claude-plugin/`, `.cursor-plugin/`, `.omp-plugin/`, `plugin.json`, and the plugin manifests under `reclaim/`. `mirror-guard` doesn't guard these paths, so the mirror pull request can change them.

Why: `mirror-guard` and `CODEOWNERS` only help if nobody can push around them. Don't add the mirror App to the bypass list. The App opens a pull request and enables auto-merge, so it needs no bypass.

### Organization ruleset: require workflows to pass before merging

`mirror-guard` runs from the `pull_request` event, so it uses the workflow file from the pull request's merge commit. A pull request can edit `mirror-guard.yml` (or delete it) and pass its own check. To close that gap, source the check from a protected place:

1. Create a small repository, for example `reclaimprotocol/required-workflows`, with its own `main` ruleset (pull request and code owner review required, no bypass). Copy `mirror-guard.yml` into it.
2. Go to the organization **Settings > Rules > Rulesets > New branch ruleset**.
3. Target this repository and the default branch. Enforcement: **Active**.
4. Add the rule **Require workflows to pass before merging**. Select the `required-workflows` repository, the path `.github/workflows/mirror-guard.yml`, and a pinned ref (a full commit SHA or a protected tag).
5. Update the pinned ref each time you change the workflow.

Keep the in-repository copy so contributors can read it, but treat the org-sourced copy as the enforced one. The check name must stay `mirror-guard`.

### Branch ruleset for `mirror/builder`

Target: the branch `mirror/builder`. Enforcement: **Active**.

- Restrict creations, updates, and deletions.
- Add the mirror App as the only bypass actor, with the bypass mode **Always**.
- Block force pushes for everyone else (the App bypasses this rule).

Why: `mirror-guard` trusts pull requests from this branch. If a collaborator can push to it, they can smuggle in changes. The per-commit author and committer check in `mirror-guard` is a second layer, not a replacement.

### Tag ruleset for `v*`

Target: tags matching `v*`. Enforcement: **Active**.

- Restrict creations, updates, and deletions to repository admins (bypass list: the Admin role).
- Block force pushes.

Why: `release.yml` creates `v<version>` tags. Restricting tags stops other people from creating release tags by hand. If the workflow's `GITHUB_TOKEN` can't create tags under this rule, add the workflow's actor to the bypass list or have the release job use the mirror App token.

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

## Mirror App installation

Create a GitHub App for the mirror and install it on this repository only.

| Permission | Access |
| --- | --- |
| Contents | Read and write |
| Pull requests | Read and write |
| Metadata | Read |
| Workflows | **None** |

Don't grant **Workflows**. Without it, the App can't push changes under `.github/workflows`, so a compromised monorepo token can't rewrite the guard. The mirror copies only `packages/**`, `package.json`, and `package-lock.json`, and runs the version sync, which edits the plugin manifests and marketplace files listed in `scripts/sync-version.ts`. None of these are under `.github/workflows`.

Store the App ID and private key in the builder repository as `MIRROR_APP_ID` and `MIRROR_APP_PRIVATE_KEY`.

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

1. Open a test pull request from a fork that edits a file under `packages/`. Confirm that `mirror-guard` fails and the labeler adds `needs-upstream-port`.
2. Open a test pull request that edits `.github/workflows/mirror-guard.yml`. Confirm that it needs a code owner review and that the org-sourced check still runs the pinned version.
3. Confirm that a collaborator can't push to `mirror/builder`.
4. Run the mirror workflow in builder and confirm the pull request auto-merges after `ci` and `mirror-guard` pass.
