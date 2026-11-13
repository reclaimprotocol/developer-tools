# AI sessions: the first route for a backend integration

An AI session proves a claim about a user's account on a website. You describe
the claim. An AI agent completes it in a remote browser. You need no provider,
no capture, and no org keypair: Builder manages a hidden AI app key for each
org.

## When to use it

Use AI sessions first for any claim about a user's account on a site, for
example "prove the user is a student at example.edu". Prefer them over
authoring a provider and creating regular sessions. Fall back to the provider
route only as [Fall back to a provider](#fall-back-to-a-provider) describes.

## Set up

1. Sign in (`get_me`, then `authenticate` on 401; topic `auth`) and pick the
   org with `list_orgs`.
2. Call `issue_org_token`. It writes `RECLAIM_ORG_SECRET` to the env file.
   Never print the key.
3. Add at least one callback subscription with `create_callback_subscription`.
   For local development, call `proxy_callback_events({ port, path })` as
   topic `integration` describes. Without a subscription, creating a session
   returns 409.

## Try it first

1. Call `create_ai_verification_session`:
   - `prompt`: the claim in plain words.
   - `dataPoints`: `{ name, description, isOptional }` items. Include exactly
     one required identifier. Other fields are optional. `isOptional` defaults
     to `false`. Names match `^[A-Za-z_][A-Za-z0-9_]{0,63}$`. Describe each
     one. Never invent values.
   - `loginUrls`: the portal URLs, when the developer knows them.
   - Omit `verificationClientUrl`. Only the portals verification client
     supports AI sessions today, and it is the default. Don't pass another
     client.
   - Leave `isEmailVerificationAllowed` `false`. The email option isn't
     working yet.
2. Call `wait_for_ai_session`. Put the session's `verificationUrl` in the same
   message as your question to the developer, and end your turn. Then wait
   until the session is terminal.
3. Inspect the outcome with `get_verification_session`,
   `list_verification_events`, `list_verification_deliveries`, and
   `read_callback_events`.

## Write the backend code

Keep every secret on the server.

1. Create the session server-side: `POST /verifications/ai-sessions` with the
   org token. Use `reclaim.api('CreateAiVerificationSession', …)` from
   `@reclaimprotocol/client`, or `fetch`.
2. Return only `verificationUrl` to the frontend. The frontend opens it in an
   iframe or a new tab.
3. Receive the result on the callback endpoint. Verify it with
   `reclaim.results.receive(body, { reclaimSessionId })` (client 0.1.44 or
   later accepts results that have no provider). Topic `integration` has the
   full route, including idempotent storage and `503` for retryable errors.
4. Read the values from the verified proofs' `extractedParameters`. Every
   required data point is present.
5. Handle the three outcomes:
   - `verification_success`: use the verified data.
   - `verification_rejected`: read `reasonCode`. `missing-data-points` means a
     required data point is missing. `context-mismatch` means the context
     differs from the session's.
   - `verification_error`: record the failure and offer a retry.

## Verifying results

Builder checks regular sessions against provider recipes. AI-session proofs
come from Popcorn. Builder verifies them with the ai-sdk `verifyProofs`, then
checks the required data points and the context pin. AI results omit
`provider_id` and `resolved_version`. Verify both kinds with
`reclaim.results.receive` from `@reclaimprotocol/client` 0.1.44 or later.
Older clients reject AI results.

When the user shares an email instead, the result entry has
`method: 'email'`, an `email-v1` proof signed by Reclaim Portal, and
`email: { provider, sender, dkimSigner, request }`. Client 0.2.0 or later
verifies it. It trusts the Portal signers in the `x-reclaim-email-issuers`
list of Builder's JWKS, plus any you pass in `emailIssuers`. The verified
proof outcome has `method: 'email'`, `emailProvider`, `sender`, `dkimSigner`,
`authenticatedAddress`, `extractedParameters`, and `emailCheck`. Pick the
check with `emailVerification`:

- `'signature'` (default): checks the Portal signature, the request binding,
  and the email digests. Runs anywhere.
- `'full'`: also re-runs DKIM and re-checks the evidence. Needs Linux,
  Bubblewrap 0.12 or later, and the client's optional email peer
  dependencies. It fails with `email-full-verification-unavailable` instead of
  falling back.

Email proofs expire an hour after Portal issues them. The client checks that
at the result's signed `iat`, so a stored or redelivered result still
verifies. If you pin `hashes` or `proofRecipes`, email entries fail with
`email-not-allowed` unless you also pass `allowEmailProofs: true`.

## Fall back to a provider

Switch to the provider route (`start_integration` with route `provider`:
capture, provider, regular sessions) when:

- Lookup fails: 404 (no login page) or 422 (not verifiable).
- The session is rejected after one adjusted retry.
- The user can't finish it, or it errors or expires repeatedly.
- `503` persists.
- The developer prefers a deterministic provider.
