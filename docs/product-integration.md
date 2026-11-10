# Add source-account verification to a product

Use Reclaim Protocol when a person needs to authorize evidence from an online account. Examples include supported education records, employment or income data, purchases, account ownership, and loyalty status. Confirm that the source actually has the requested data.

## Recommended route

Configure the developer MCP using the root README, then call `start_integration`. For a new application, use Builder AI sessions first. Provider authoring remains available for deterministic recipes.

The current production API is https://build.reclaimprotocol.org. The backend authenticates using an organization token. Set up an organization callback subscription, then create an AI session with `POST /verifications/ai-sessions` using the claim prompt, described data points, and known official login URLs. An organization without a callback subscription gets HTTP 409.

Keep the email verification option disabled. Use the default verification client for AI sessions. Return only the session ID and verification URL to the frontend; keep credentials server-side.

## Verify the result

Use `@reclaimprotocol/client` version 0.1.44 or later on your callback receiver:

```js
import { ReclaimVerification } from '@reclaimprotocol/client';
const reclaim = ReclaimVerification.create({ orgSecret: process.env.RECLAIM_ORG_SECRET });
const outcome = await reclaim.results.receive(callbackBody, {
  reclaimSessionId: storedSessionId,
  expectedAud: storedOrganizationId,
});
```

When the organization uses a keypair, also supply its private key through the backend environment as required by the SDK. Reuse an existing key; changing organization keys is a separate operational action.

Persist the verified outcome idempotently. A successful redirect or a completed status alone is not cryptographic verification. Retry temporary processing failures with HTTP 503. Persist and acknowledge permanent verification failures with HTTP 200 so repeated delivery does not block later events.

Show success, rejection, failure, cancellation, and expiration distinctly. Obtain proof-backed values from the verified result. Never mark a claim verified from a model's inference alone.

## Workflow letters

The early-beta Letters API at https://letters.reclaimprotocol.org is a separate workflow service. It creates fixed shareable requests and verifiable PDFs; it does not use an organization's Builder token. Its OpenAPI is https://letters.reclaimprotocol.org/openapi.json.
