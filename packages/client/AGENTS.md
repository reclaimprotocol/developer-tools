# packages/client

> **Contributing.** This package lives in
> [reclaimprotocol/developer-tools](https://github.com/reclaimprotocol/developer-tools),
> and pull requests are merged there. The generated files (`*.gen.ts`) come
> from Builder's OpenAPI document. Don't edit them by hand; describe the API
> change in your pull request instead. Paths like `packages/app/...` below
> refer to Reclaim's private Builder repository, which includes this repository
> as a git submodule, and aren't in this repository.

Typed SDK client for `@reclaimprotocol/app`. Single responsibility: provide a type-safe `ReclaimClient` that maps every openapi operation to a fetch call. Used directly by `@reclaimprotocol/agent` and by any external consumer that wants programmatic API access without the full agent.

## Role

**SDK only** — no MCP server, no CLI, no agent tools. Those live in `@reclaimprotocol/agent`.

Use `@reclaimprotocol/client/api` for generated Builder API calls in browsers,
Verification Clients, and API-only code. This subpath must stay free of proof,
signing, attestor, Node-only imports, and browser-forbidden headers. Use the
package root for proof verification, signing, encryption, and the higher-level
consumer workflow.

The package root MUST re-export the exact API client, option type, generated
types, and problem-error contract from `/api`. Don't add compatibility
wrappers, duplicate transport classes, duplicate schema types, `as unknown`,
or `as any`.

```ts
import { ReclaimClient } from '@reclaimprotocol/client/api'

const client = new ReclaimClient({
	baseUrl: 'http://localhost:4001',
	token: process.env.RECLAIM_API_TOKEN,
})

const orgs = await client.call('ListOrgs', { params: {}, query: {}, body: {} })
```

## Source of truth

In Builder, `packages/app/openapi.yaml` is the single source of truth. Run:

```bash
npm run openapi:gen --workspace=packages/app
```

Both generators live in `packages/app` and write across package boundaries —
this package has no codegen script of its own. `openapi:typegen` emits
`src/types/openapi.gen.ts`; `openapi:mcpgen` emits `src/routes.gen.ts` here and
`operations.gen.ts` in `packages/agent`. New endpoints are picked up
automatically by `ReclaimClient.call()` — no per-op code needed.

## Layout

```
src/
  api.ts            Browser-safe API-only public entry point
  index.ts          Full SDK exports — API, proof, signing, and workflows
  client.ts         One shared OpenAPI transport
  errors.ts         Browser-safe, Boom-compatible RFC 9457 errors
  consts.ts         DEFAULT_BASE_URL, USER_AGENT, PROBLEM_CONTENT_TYPE
  types/
    openapi.gen.ts  GENERATED — openapi-typescript from app/openapi.yaml
    openapi.ts      Typed helpers — IOperationId, IOperationArgs<T>, IOperationResponse<T>
    index.ts        Re-exports from openapi.ts + openapi.gen.ts
  routes.gen.ts     GENERATED — { operationId → { method, path } } used by ReclaimClient.call()

tests/
  client.test.ts    SDK-level tests. Mock fetch via ReclaimClient constructor's `fetch` option.
```

## Writing code

Inherit repo-wide conventions from the root `AGENTS.md`. Specific to this package:

1. Tabs for indentation. `.ts` extension on every relative import.
2. No MCP, no CLI, no browser automation — those belong in `@reclaimprotocol/agent`.
3. Validation stays in the OpenAPI specification. Validate only untrusted
   response boundaries that TypeScript can't check, such as problem JSON.
4. Keep one generated type source. Don't copy or rename schema types between
   entry points.
5. Don't use `as unknown` or `as any`. Fix the boundary type or add a focused
   runtime guard.
6. Use `assert(cond, boomError)` in trusted-runtime code. Browser-safe modules
   must not import `node:assert` or the Boom runtime.
7. Run focused tests, lint, typecheck, a browser bundle check, and the package
   build after changing the public API boundary.

## Adding a new endpoint

When `packages/app` ships a new operation:

1. Update `packages/app/openapi.yaml`.
2. Run `npm run openapi:gen --workspace=packages/app`.
3. `ReclaimClient.call('NewOperationId', ...)` works immediately — no other changes needed.
4. To expose it as an MCP tool as well, add `tags: [MCP]` in the yaml — the same
   command regenerates the agent's `operations.gen.ts`.

## Tests

```bash
npm test --workspace=packages/client
node --test tests/client.test.ts
```

Mock fetch via the `ReclaimClient` constructor's `fetch` option — do not stub globals.
