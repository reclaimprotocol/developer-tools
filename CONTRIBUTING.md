# Contributing

Thanks for helping improve the Reclaim developer tools. This guide explains where each part of the repository is developed and how to contribute.

## What's in this repository

| Path | How it's developed |
| --- | --- |
| Plugins, marketplace metadata, distribution files | Directly in this repository |
| `docs/`, `README.md`, `llms.txt` | Directly in this repository |
| `packages/client` (`@reclaimprotocol/client`) | Mirrored from Reclaim's monorepo |
| `packages/agent` (`@reclaimprotocol/agent`) | Mirrored from Reclaim's monorepo |

Pull requests that change plugins, distribution files, or docs are reviewed and merged here as usual.

The two packages under `packages/` are the public source of what Reclaim publishes to npm. Reclaim develops them in a private monorepo and mirrors them here through an automated pull request. Because of that, this repository can't merge outside changes to `packages/` directly.

## Contribute a fix to a package

1. Fork this repository and clone your fork.
2. Install dependencies:

   ```bash
   npm ci
   ```

3. Add a failing test that reproduces the problem, then write the fix. Run the tests for the package you changed:

   ```bash
   npm test -w @reclaimprotocol/client
   npm test -w @reclaimprotocol/agent
   ```

4. Open a pull request against `main`. The template asks for the problem, the fix, the test, and the versions you used.

### What happens next

1. The `mirror-guard` check fails on your pull request, because it changes `packages/`. This is expected.
2. A bot adds the `needs-upstream-port` label and posts a comment that explains the process.
3. A maintainer ports your change to the monorepo and adds you as a co-author, so you get credit in the history.
4. When the change syncs back, a bot closes your pull request with a link to the sync commit, and you're credited as a co-author.

The other CI checks still run on your pull request, so keep the tests passing while you wait.

## Report a bug

Open an [issue](../../issues/new) and include:

- The versions of `@reclaimprotocol/client` or `@reclaimprotocol/agent` that you use.
- Your Node.js version and operating system.
- Steps to reproduce the problem, and what you expected to happen.

Never include organization keys, tokens, cookies, or captured data in an issue. Redact them before you paste logs or requests.

## Report a security vulnerability

Don't open a public issue for a security vulnerability. Report vulnerabilities privately through GitHub's Security tab of this repository, using private vulnerability reporting.

## Code style

- Use tabs for indentation.
- Write tests with the Node.js test runner (`node --test`), not Jest.
- Run `npm run lint` and `npm run check` before you open a pull request.
- Write documentation in sentence case, in second person and present tense, following the [Google developer documentation style guide](https://developers.google.com/style).

## Releases

Maintainers make releases. Don't change package versions in your pull request.
