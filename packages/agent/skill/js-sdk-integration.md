# @reclaimprotocol/js-sdk — backend integration guide

Keep `appSecret` on your BACKEND only. Everything below runs server-side;
the browser only ever sees the `requestUrl`.

## Contents

- Testing locally, without deploying anything
- Steps 1-4: install, create the proof request, open it, verify the callback
- Gotchas

## Testing locally, without deploying anything

- **providerId `"example"`**: a canonical built-in smoke-test provider —
  no need to author and publish your own provider to confirm the SDK
  plumbing works end-to-end. Swap in your real providerId once this passes.
- **A public callback URL**: `setAppCallbackUrl` needs a URL Reclaim's
  servers can reach over the public internet — `localhost` will never
  receive the callback. Two ways to get one, pick whichever fits:
  - **ngrok** (or a similar tunnel): `ngrok http 3000` (or your port)
    alongside your local server, then set `PUBLIC_URL` to the
    `https://<id>.ngrok-free.app` URL it prints. Zero-deploy, but the tunnel
    URL is temporary.
  - **A development or staging server you can deploy to quickly**: if you
    already have one reachable from the internet, point `PUBLIC_URL` at it
    instead — that skips the extra local tool.
  Without either, only the frontend-side flow (opening `requestUrl` and
  reading the result client-side) works — the async webhook never lands.
- `scaffold_reclaim_demo_server` defaults `providerId` to `"example"`; its
  README covers both callback-URL options above — use it to get a working
  local loop before wiring in a real provider.

## 1. Install

```bash
npm install @reclaimprotocol/js-sdk
```

## 2. Create a proof request (backend)

```js
import { ReclaimProofRequest } from "@reclaimprotocol/js-sdk";

const reclaimProofRequest = await ReclaimProofRequest.init(
  process.env.RECLAIM_APP_ID,
  process.env.RECLAIM_APP_SECRET,
  providerId,
  {
    // acceptAiProviders: true,   // allow AI-verified providers
    // useAppClip: true,          // mobile app-clip flow, not a browser popup
    // providerVersion: "1.0.0",  // pin a specific provider version
  },
);

// Deliver the verified proof back to your server asynchronously instead of
// (or in addition to) reading it from the frontend callback:
reclaimProofRequest.setAppCallbackUrl(
  `${process.env.PUBLIC_URL}/webhooks/reclaim`,
  true, // jsonProofResponse: send the callback body as JSON, not form-encoded
);

// Optional: attach your own correlation id / metadata, retrievable later.
reclaimProofRequest.setContext(
  sessionId,
  JSON.stringify({ createdAt: Date.now() }),
);

// IMPORTANT: getRequestUrl() is ASYNC — await it.
const requestUrl = await reclaimProofRequest.getRequestUrl();

// Hand the requestUrl to the frontend to open in a new tab/window/webview.
// If you need to rehydrate this request object later (for example, in the
// webhook handler, in a different process), persist
// reclaimProofRequest.toJsonString() (sync) and rehydrate with:
//   const req = await ReclaimProofRequest.fromJsonString(json); // ASYNC
```

## 3. Frontend: open the request URL

Fetch `requestUrl` from your backend, then open it (popup/new tab/QR code) —
never construct it in the browser, since that would require the appSecret
client-side. Trigger the fetch+open from a real user click (not a page-load
effect) or some browsers block the popup.

## 4. Verify the callback (backend webhook)

```js
import { verifyProof } from "@reclaimprotocol/js-sdk";

app.post("/webhooks/reclaim", express.json(), async (req, res) => {
  // req.body is already a parsed object here because jsonProofResponse was
  // true above AND express.json() parsed it. If you did NOT set
  // jsonProofResponse (or aren't using express.json()), the body arrives as
  // form-encoded/raw text and must be JSON.parse()'d (and decodeURIComponent'd
  // if form-encoded) into a Proof / Proof[] before calling verifyProof.
  const proof = req.body;

  // The second argument is REQUIRED — at minimum providerId.
  const result = await verifyProof(proof, {
    providerId,
    // providerVersion,       // optional, pin if you pinned it in init()
  });

  if (!result.isVerified) {   // NOTE: isVerified, not is_verified
    console.error("Proof verification failed:", result.error);
    return res.status(400).json({ verified: false, error: result.error });
  }

  console.log("Verified data:", result.data, result.publicData);
  res.status(200).json({ verified: true });
});
```

## Gotchas

- `getRequestUrl()` and `ReclaimProofRequest.fromJsonString()` are async —
  a missing `await` silently hands you a Promise instead of a string/instance.
- `verifyProof`'s config arg is mandatory; omitting `providerId` throws.
- Prefer `setContext` over the deprecated `addContext` (same signature).
- `ReclaimProofRequest.init` needs network access to the Reclaim backend at
  call time — don't call it at module load / cold-start if your platform pools
  processes long-term; call it per-request instead.
- Use `check_app_status` (this MCP server) to confirm your app is linked
  and not still sandbox-limited before debugging "verification never lands"
  issues.
