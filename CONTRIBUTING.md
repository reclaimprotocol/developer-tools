# Contributing

Thanks for helping improve the Reclaim developer tools. This guide explains where each part of the repository is developed and how to contribute.

## What's in this repository

| Path | What it is |
| --- | --- |
| `packages/client` | `@reclaimprotocol/client`, the typed HTTP client and consumer SDK |
| `packages/agent` | `@reclaimprotocol/agent`, the Reclaim MCP server |
| Plugins, marketplace metadata, distribution files | Plugin and marketplace manifests for each agent client |
| `docs/`, `README.md`, `llms.txt` | Documentation |

Everything here is developed in this repository, and pull requests are reviewed and merged here. Reclaim's private Builder backend includes this repository as a git submodule, so Builder picks up merged changes when it updates the submodule.

The `*.gen.ts` files in both packages are generated from Builder's OpenAPI document. Don't edit them by hand. If a fix needs an API change, describe it in your pull request, and a maintainer makes the change in Builder.

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
