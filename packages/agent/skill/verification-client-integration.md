# Integrate a Builder verification client

For a claim about a user's account on a site, start with topic `ai-sessions`.
This guide covers the provider route and the shared callback details.

## Set up an application with the coding agent

For "add Reclaim to my app", call `start_integration` first and follow its
plan. Don't ask whether to try, integrate, or create an app. Ask one short
question only when intent is unclear. The steps below are the detail behind
that plan.

Prove the provider before you write app code: sign in to Builder, attach the
browser, capture, and run the proof first. Those steps need the developer, and
they show whether a proof is possible on the site. Write the app code after the
proof works, or while you wait on the developer. When you need the developer
to answer or act, end your turn with the question and every link they need;
don't ask through a background or asynchronous question tool.

When the workspace has no app yet, call `create_example_app` to write
[builder-example](https://github.com/reclaimprotocol/builder-example) into the
workspace root, as the `start_integration` plan describes, instead of writing a
new backend and frontend or cloning the repository. Otherwise, inspect the app's frontend, backend, package manager,
configuration, and callback conventions. Complete the integration in its codebase and run its
relevant checks. The MCP tools configure Builder resources; your file tools
edit the app.

If `package.json` depends on `@reclaimprotocol/js-sdk`, ask first: "This
project uses `@reclaimprotocol/js-sdk`. Keep it (I switch this MCP server to
legacy devtools mode), or migrate to the Builder HTTP API?"

- **Keep:** `set_devtools_mode({ mode: "old" })`, then tell them to restart or
  reconnect the MCP server. An explicit `USE_OLD_DEVTOOLS` env var overrides
  it. After the restart, read `get_js_sdk_integration_guide`.
- **Migrate:** stay in Builder mode, remove `@reclaimprotocol/js-sdk`, and
  replace its `ReclaimProofRequest` and `verifyProof` calls with the session
  flow below.

1. `get_devtools_mode` confirms Builder mode. `get_me` or `authenticate` signs
   in the developer. Find the organization with `list_orgs`; call `create_org`
   only when they want a new one.
2. Receive callbacks. Local development: call
   `proxy_callback_events({ port, path })` to forward the org's events to the
   app's callback route on localhost; no public URL. The local listener works
   only while this MCP server runs. It keeps events in order per session and
   retries a session the app rejects with backoff, so other sessions keep
   flowing. When its status lists `blocked` sessions, read that session's
   callback route response and logs, and fix the app. Deployed app (required
   for production): register a
   public callback URL with `create_org_callback_subscription`, including
   all five session-ending events. If the
   app needs encrypted results or session binding, call `issue_org_keypair`
   (`encryptResults: true` for encrypted results). It writes the private key to
   the backend's env file and registers only the public key. It returns 409
   when the org already has a different key. Check `get_org_keypair` first;
   when the org has a key pair, the app must pass `orgEthPrivateKey` to
   `results.receive`, with or without encryption: it decrypts results and
   verifies TEE-bound proofs. Ask the developer to choose: reuse the key (they
   put its private key in the backend's server env file as
   `RECLAIM_ORG_ETH_PRIVATE_KEY` themselves, never in chat), rotate it with
   `issue_org_keypair` and `replace: true` (apps holding the old key stop
   working with new results; the old key is saved to `<envFile>.backup`, so
   tell the developer that path), or turn encryption off with
   `update_org_keypair({ orgId, canEncryptResult: false })`, which keeps the
   key. Name the exact action when you ask.
3. Org key: reuse the `RECLAIM_ORG_SECRET` the app already has. Otherwise an
   organization owner calls `issue_org_token`. It writes the key to the
   project's env file (default `.env`, variable `RECLAIM_ORG_SECRET`) and
   returns only the last four characters and the file path. Make sure that file
   is gitignored. Never print the key, put it in the conversation, or ask the
   developer to paste it. Keep it out of frontend bundles, logs, and source
   control.
4. Prefer plain HTTP from the backend (see [Code to write](#code-to-write)).
   Create sessions with `POST /verifications/sessions`
   (`Authorization: Bearer $RECLAIM_ORG_SECRET`), save each returned session ID
   alongside the app's own user or order, and return only `verificationUrl` to
   the frontend. The frontend opens that URL and asks its backend for the final
   status (`GET /verifications/sessions/{sessionId}`); a browser redirect alone
   is not proof of success. Use `@reclaimprotocol/client`
   (`ReclaimVerification.create({ orgSecret })`, `sessions.create`) only when
   the developer asks for it.
5. Add a backend callback route. Persist each delivery idempotently and load
   the expected session ID and org ID from app storage. To verify the result on
   your callback route, install `@reclaimprotocol/client` in the backend and call
   `reclaim.results.receive(body, { reclaimSessionId, expectedAud,
   orgEthPrivateKey })`. Use the verified proof data to update app state.
   Store every failure on the verification session record: failure events, and
   a thrown `ResultVerificationError` (`error.reason` and each
   `error.outcome.proofs[].reason`). Respond `error.retryable ? 503 : 200`.
   A result that failed verification gets 2xx: retrying can't fix it, and an
   unacknowledged delivery holds back that session's later events. Respond 5xx
   for any other temporary problem too, such as a database outage.
   Add a status route that returns the stored status, data points, and failure
   reason. While the app has no result, it also reads
   `GET /verifications/sessions/{sessionId}`, so a session Builder has ended
   never stays pending in the app. Render the frontend per
   [UI states](#ui-states).
6. Exercise one session through the selected registered Verification Client,
   inspect its Builder events, and test the app's success and failure paths.
   Omit `verificationClientUrl` to use the Portal, or select another client
   from `VerificationClient` in the SDK. Do not send an unregistered URL or
   call a legacy backend for an `api=2` session.

   A session only works in the client it was created for: Builder fixes the
   client at creation, and any other client gets
   `403 x-reclaim-vc-id does not match this session`. For a mobile app using
   the in-app SDK or the add-to-app module, create every session with
   `verificationClientUrl` set to
   `https://build.reclaimprotocol.org/share/inapp-sdk`
   (`VerificationClient.inAppSdk`); the default Portal link won't open there.
   For native iOS or Android apps, follow the
   [iOS SDK README](https://github.com/reclaimprotocol/reclaim-inapp-ios-sdk#readme)
   or the
   [Android SDK README](https://github.com/reclaimprotocol/reclaim-inapp-android-sdk#readme).

   The hosted verification page streams the target site as an image, so text
   and DOM checks of that page come back empty. Check a session's progress
   with `list_verification_events` and `get_verification_session` instead.

The one-time management calls above use the developer's Builder login. The
consumer backend uses the separate organization token. The SDK's API-only
entry point, `@reclaimprotocol/client/api`, is available when an application
needs typed Builder operations without the full verification workflow.

The MCP session tools (`create_verification_session`,
`get_verification_session`, `list_verification_events`,
`list_verification_deliveries`, `retry_verification_callback`,
`create_callback_subscription`, `list_callback_subscriptions`,
`delete_callback_subscription`, `bind_verification_session_tee_nonce`, and
`get_verification_result`) call these same production endpoints with the org
key: pass it as `orgToken`, or let them fall back to the MCP server's
`RECLAIM_ORG_SECRET`. Use them to test the integration end to end.

## Code to write

Use the API base URL the developer's Builder runs at (production:
`https://build.reclaimprotocol.org`). Every call authenticates with
`authorization: Bearer $RECLAIM_ORG_SECRET`.

Deployed apps subscribe a callback once (or use
`create_org_callback_subscription`); local development uses
`proxy_callback_events` instead. Session creation returns 409 while the org has
no subscription, and a result is only delivered to
subscriptions that include the event the session ends with, so subscribe to all
five session-ending events:

```bash
curl -X POST https://build.reclaimprotocol.org/verifications/callback-subscriptions \
  -H "authorization: Bearer $RECLAIM_ORG_SECRET" \
  -H "content-type: application/json" \
  -d '{
    "callbackUrl": "https://your.app/reclaim/callback",
    "events": [
      "verification_success",
      "verification_rejected",
      "verification_error",
      "verification_cancelled",
      "session_expired"
    ]
  }'
```

Create a session per claimant, from the backend; store `id` and hand
`verificationUrl` to the frontend:

```bash
curl -X POST https://build.reclaimprotocol.org/verifications/sessions \
  -H "authorization: Bearer $RECLAIM_ORG_SECRET" \
  -H "content-type: application/json" \
  -d '{
    "providers": [
      {
        "providerId": "<your-provider-id>"
      }
    ],
    "context": {
      "userId": "abc"
    }
  }'
```

For an in-app SDK or add-to-app host, add the in-app SDK's client URL and pass
the returned `verificationUrl` to the app's `startVerificationFromUrl`:

```bash
curl -X POST https://build.reclaimprotocol.org/verifications/sessions \
  -H "authorization: Bearer $RECLAIM_ORG_SECRET" \
  -H "content-type: application/json" \
  -d '{
    "providers": [
      {
        "providerId": "<your-provider-id>"
      }
    ],
    "context": {
      "userId": "abc"
    },
    "verificationClientUrl": "https://build.reclaimprotocol.org/share/inapp-sdk"
  }'
```

With `@reclaimprotocol/client`:

```js
import { ReclaimVerification, VerificationClient } from '@reclaimprotocol/client'

const reclaim = ReclaimVerification.create({
  orgSecret: process.env.RECLAIM_ORG_SECRET,
})

const session = await reclaim.sessions.create({
  providers: [{ providerId: '<your-provider-id>' }],
  context: { userId: 'abc' },
  // Required for the in-app SDK and add-to-app module. Omitted, Builder
  // selects the Portal, and the app's requests get 403.
  verificationClientUrl: VerificationClient.inAppSdk,
})
// Store session.id; hand session.verificationUrl to the app.
```

The app opens it with `startVerificationFromUrl(verificationUrl)`. If the
backend returns fields instead of a link, it calls
`startVerificationFromJson({ "api": "2", "sessionId": session.id })` with the
same result. Add `"diag": "1"` only when `verificationUrl` contains `diag=1`;
other keys are ignored.

For a native app, read the SDK's README before writing app code. Each README
has a Builder mode section covering installation, starting from a URL or
JSON, and handling the result:

- iOS (Swift):
  [reclaim-inapp-ios-sdk](https://github.com/reclaimprotocol/reclaim-inapp-ios-sdk#readme)
- Android (Kotlin/Java):
  [reclaim-inapp-android-sdk](https://github.com/reclaimprotocol/reclaim-inapp-android-sdk#readme)

Receive and verify the result on the callback route. This is the one place the
client package is needed:

```js
import { ReclaimVerification, ResultVerificationError } from '@reclaimprotocol/client'

const reclaim = ReclaimVerification.create({
  orgSecret: process.env.RECLAIM_ORG_SECRET,
})

app.post('/reclaim/callback', async(req, res) => {
  let outcome
  try {
    outcome = await reclaim.results.receive(req.body, {
      reclaimSessionId: sessionId, // the id you stored
    })
  } catch(error) {
    if(!(error instanceof ResultVerificationError)) {
      throw error
    }

    if(error.retryable) {
      return res.sendStatus(503) // temporary: Builder retries the delivery
    }

    // Retrying can't fix a result that failed verification. Store the failure
    // where the status route returns it, then acknowledge the delivery.
    const proofReasons = (error.outcome.proofs ?? [])
      .filter((proof) => !proof.proofValid)
      .map((proof) => proof.reason)
    console.warn('result failed verification', error.reason, proofReasons)
    await markSessionFailed(sessionId, error.reason) // your app's storage
    return res.sendStatus(200)
  }

  if(outcome.kind === 'result') {
    console.log(outcome.result.payload) // verified
  }

  res.sendStatus(200)
})
```

### UI states

Apply these rules when you write the frontend. Test each state, including one
failure.

| State | Render |
| --- | --- |
| Idle | The **Verify** button. |
| Waiting in the other tab | The current step ("Finish verifying in the new tab") and a way to reopen `verificationUrl`. After about 30 seconds, say what is happening and offer **Cancel** or **Try again**. |
| Verifying | "Checking your result". |
| Verified | The requested data points. |
| Failed | A plain-language reason and what to do next, near the **Verify** button, with **Try again**. |
| Expired or cancelled | Say which, with **Try again**. |

- Show the current step, never an indefinite spinner (Nielsen heuristic 1,
  visibility of system status).
- Write errors in plain language that says what happened and what to do next,
  visible next to the action, with a recovery action (Nielsen Norman Group
  error-message guidelines).
- Send reason codes (`error.reason`, proof `reason`) to logs or an expandable
  **Details** section, not the headline.
- Announce changes: `role="status"` (or `aria-live="polite"`) for progress,
  `role="alert"` for failures (WCAG 2.2 SC 4.1.3).
- Pair color with text or an icon (WCAG 2.2 SC 1.4.1).
- Stop the waiting state when the status route reports a terminal status.

Check or investigate a session from the status route or by hand with `curl`.
All routes take the org key:

| Route | Use |
| --- | --- |
| `GET /verifications/sessions/{sessionId}` | Status and outcome. |
| `GET /verifications/sessions/{sessionId}/events` | The claimant's event timeline, to see where a flow stopped. |
| `GET /verifications/sessions/{sessionId}/deliveries` | Callback delivery attempts and their responses. |
| `GET /verifications/sessions/{sessionId}/result` | Recovery only: a signed result Builder hasn't delivered yet. Builder clears it once the callback succeeds, or after 7 days undelivered (`payload: null`). Verify with `verifyResultFull`. |
| `POST /verifications/sessions/{sessionId}/retry-callback` | Redeliver an undelivered result (within the 7 days). |

```bash
curl https://build.reclaimprotocol.org/verifications/sessions/$SESSION_ID \
  -H "authorization: Bearer $RECLAIM_ORG_SECRET"
```

## Create and launch a session

Consumers authenticate with an organization token (`rorg_…`, issued in the
dashboard or via `POST /orgs/{orgId}/token`) and call
`POST /verifications/sessions`. Open the returned `verificationUrl` for the
claimant. It contains only the registered Verification Client URL, session ID,
and `api=2` mode selector.

A consumer can pass `launchOptions` (`redirectUrl`/`redirectUrlOptions` on
success, `cancelRedirectUrl`/`cancelRedirectUrlOptions` on cancellation, `https:`
only) in the `POST /verifications/sessions` body. Builder validates and stores
them on the session at creation and returns them unchanged from bootstrap
(`session.launchOptions`); it never redirects to them itself — only the
Verification Client that renders the flow does. Set `diagnostics: true` on the
same request only for deliberate troubleshooting, since diagnostic logs can
contain personal data; Builder appends `diag=1` to `verificationUrl` for that
session and strips any `diag` the consumer's own `verificationClientUrl` carries.

An optional `themeId` selects an active organization theme. If it is absent,
Builder snapshots the organization's most recently updated active theme. A
localized consent block tells supported clients to show consent before the
first provider. Branding and theme data don't affect proof trust.

## Try a provider without an app

Session creation returns 409 while the org has no callback subscription.
`read_callback_events` creates the org's pull listener, which satisfies that
check and holds results for you to read. No tunnel or public URL is needed.

1. Call `read_callback_events`.
2. `create_verification_session`, then give the developer `verificationUrl`.
3. Poll `get_verification_session` until it is terminal.
   `list_verification_events` shows progress.
4. Call `read_callback_events({ sessionId })` for the verified result.

## Call the direct Builder API

In `api=2` mode, send the registered client UUID in `x-reclaim-vc-id` on every
request. Generate the client from Builder's OpenAPI document (`/openapi.yaml` on the Builder API origin); don't hand-write
route types or proxy these calls through `api.reclaimprotocol.org`.
The UUID must match the session, but it is public and doesn't authenticate the
caller.

| Route | Purpose |
| --- | --- |
| `GET /verifications/sessions/{sessionId}/bootstrap` | Load the session, resolved recipes, runtime configuration, branding, and theme. |
| `PATCH /verifications/sessions/{sessionId}/claimant` | Update the latest claimant and device snapshot. |
| `POST /verifications/sessions/{sessionId}/events` | Report canonical lower-snake-case analytics events. |
| `POST /verifications/sessions/{sessionId}/attestor-auth` | Request session-bound attestor authentication. Don't send a legacy application secret or provider signature. |
| `POST /verifications/sessions/{sessionId}/results` | Submit exact proof objects or a terminal error/cancellation. Builder atomically records the canonical outcome and prepares signed callback delivery. |

URLs without `api=2` stay on each client's existing legacy path. Builder mode
must not call legacy lifecycle, application-info, or result APIs.

## Preserve and verify proofs

Verification Clients put each exact proof in the Builder result. They
don't reverify proofs. Builder signs the outer result JWS without
rewriting the proof.

Consumers call `verifyResultFull` on their backend. It verifies the registered
Builder issuer, outer JWS, session, audience, and every proof with the local
`verifyRequestProof` implementation. Treat outer `extracted_parameters` and
`content_hash` as diagnostics, not trusted proof inputs.

Results are delivered to the org's registered callback subscriptions
(`POST /orgs/{orgId}/callback-subscriptions`), plaintext by default. When the
org has enabled `canEncryptResult` on its secp256k1 keypair
(`PUT /orgs/{orgId}/keypair`), Builder ECIES-encrypts the terminal payload to
that public key instead; decrypt it with `@reclaimprotocol/client`'s
`decryptCallback`/`verifyResult` and the org's eth private key before treating
it as a result. A session created without `canEncryptResult` never needs this
step. Troubleshoot a stuck or failed session with `get_verification_session`,
`list_verification_events`, `list_verification_deliveries` (all with
`orgToken`), and `list_org_verification_sessions`.

## Use the browser extension

For an `api=2` URL, use
`reclaimExtensionSDK.fromVerificationUrl` or `initBuilder` with the returned
`verificationClientId`, then call `startVerification()`. The extension sends
`x-reclaim-vc-id`, loads recipes from bootstrap, runs them sequentially, and
submits the raw proofs. It doesn't perform redundant `allowedJsRequests`
validation. Missing or unknown `api` values keep the existing `init`,
`fromJsonString`, and direct-callback behavior.

## Bind a TEE nonce when required

A consumer can pass `orgEthPrivateKey` to `sessions.create`. The SDK derives the
legacy-compatible nonce locally, signs the binding payload with EIP-191, and
calls `PUT /verifications/sessions/{sessionId}/tee-nonce` with the organization
token. The private key stays in the consumer process. Bind before proof
generation; the same binding is idempotent and a different binding is rejected.
