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

An AI session proves only values that a page shows to the signed-in user. If
the developer names a request, a JSON path, or an internal ID, or the value
appears only in an API response, skip AI sessions and use the provider route
(`start_integration` with `route: "provider"`).

## Set up

1. Sign in (`get_me`, then `authenticate` on 401; topic `auth`) and pick the
   org with `list_orgs`.
2. Call `issue_org_token`. It writes `RECLAIM_ORG_SECRET` to the env file.
   Never print the key.
3. Add at least one callback subscription with `create_callback_subscription`.
   Subscribe to all five session-ending events: `verification_success`,
   `verification_rejected`, `verification_error`, `verification_cancelled`,
   and `session_expired`. A user who closes the session ends it as
   `verification_cancelled`. A subscription applies to every later event,
   including sessions that are already open.
   For local development, call `proxy_callback_events({ port, path })` as
   topic `integration` describes. Without a subscription, creating a session
   returns 409.
4. Before you create a session, call `list_callback_subscriptions` and check
   each webhook's `consecutiveFailures`. At 5 or more, the webhook no longer
   counts as active and creating a session returns 409. Show the developer the
   `lastError`. Suggest `proxy_callback_events` for local development, or a new
   URL. After the fix, call `test_callback_subscription`. Offer
   `delete_callback_subscription` once for a webhook that keeps failing.

## Try it first

1. Call `create_ai_verification_session`:
   - `prompt`: the claim in plain words. Describe the value and the menu path
     a person follows to see it, for example "the plan name under Account >
     Billing". Don't repeat the data point descriptions. Don't use GraphQL
     operation names or JSON paths.
   - `dataPoints`: `{ name, description, isOptional }` items. Include exactly
     one required identifier. Other fields are optional. `isOptional` defaults
     to `false`. Names match `^[A-Za-z_][A-Za-z0-9_]{0,63}$`. Describe each
     one. Never invent values.
   - `loginUrls`: the sign-in page or the account home page, when the
     developer knows it. Don't guess a deep link.
   - Omit `verificationClientUrl`. Only the portals verification client
     supports AI sessions today, and it is the default. Don't pass another
     client.
   - Leave `isEmailVerificationAllowed` `false`. The email option isn't
     working yet.
2. Call `wait_for_ai_session` until `next` is `share_url`. Write the
   `verificationUrl` in a message to the developer and ask them to open it and
   sign in. The developer only sees text you write, not tool results. If your
   client shows that message while your tools still run, call
   `wait_for_ai_session({ sessionId, untilTerminal: true })` right after it.
   Otherwise, end your turn with the URL, and call the wait when the developer
   replies. Either way, don't ask the developer to tell you when they are
   done.
3. Inspect the result with `get_verification_session`,
   `list_verification_events`, `list_verification_deliveries`, and
   `read_callback_events`. `aiSdkSessionId` is the ID the claimant sees in the
   Portal.

## Diagnose a failed session

1. Read `session.outcome`, `session.outcomeNote`, and `session.problem` from
   `wait_for_ai_session`. A `problem.reasonUnknown` of `true` means the
   session reports no reason. Then read the timeline with
   `list_verification_events`. The outcome says where the session stopped:
   `not_started`, `start_failed`, `sign_in_not_completed`, `data_not_found`,
   `proof_failed`, `missing_data_points`, `context_mismatch`, `invalid_proof`,
   or `closed_by_user`.
2. Follow `outcomeNote.retry`:
   - `change_request`: change the prompt, `dataPoints`, or `loginUrls`, then
     create one new session.
   - `retry_same`: create one new session with the same request.
   - `none`: retrying doesn't help. Fix the cause.
3. If the same outcome happens twice, stop and switch to the provider route.
   Don't create sessions that only reword the prompt.
4. If `session.callbackHint` is present, a webhook is failing. Follow it.

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
5. Handle the five terminal events:
   - `verification_success`: use the verified data.
   - `verification_rejected`: read `reasonCode`. `missing-data-points` means a
     required data point is missing. `context-mismatch` means the context
     differs from the session's.
   - `verification_error`: record the failure and offer a retry.
   - `verification_cancelled`: the user closed the session. Offer a retry.
   - `session_expired`: the user didn't finish in time. Offer a retry.

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
- The session fails with the same outcome twice.
- The user can't finish it, or it errors or expires repeatedly.
- The developer needs a value that appears only in an API response, or an
  internal ID.
- `503` persists.
- The developer prefers a deterministic provider.
