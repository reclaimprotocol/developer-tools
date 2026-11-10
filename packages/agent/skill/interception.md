# Live interception: `injectionType` / `interceptorType`

## Contents

- The field, per backend
- Which mechanism to pick, and when to use any of them at all
- When a site won't load, or won't let the user sign in — ask which clients
  ship it, bisect, then the remedies
- The document-replay flag, and why the two backends invert its polarity
- Recognizing live interception on a provider you didn't author
- Related topics

Separate from the user script's content is how the client captures network
traffic for it to consume. This is a per-version field alongside
`customInjection`/`jsUserScripts`, not something you write into the script.

Whichever mechanism is selected, the script consumes what was caught through the
same API: `window.reclaimInterceptor.addResponseMiddleware(middleware,
middlewareName?)`. That fires for any intercepted request under every mechanism
below, `CDP` included — it is not HAWKEYE-specific.

When an intercepted request becomes a claim, the Verification Client
automatically attaches cookies applicable to its URL to the claim sent to the
attestor. The same rule applies to `window.Reclaim.requestClaim`. Authors should
not read, hardcode, or copy the `Cookie` header into a script, recipe, or public
parameter.

## The field, per backend

- **old-devtools:** `injectionType`, one of
  `NONE | MSWJS | XHOOK | CDP | HAWKEYE`. The backend's own column default is
  **`HAWKEYE`, not `NONE`** — harmless for the standard flow, since with no
  interceptor script installed nothing calls `addResponseMiddleware`.
  `create_provider_version_from_capture` exposes it as an author-settable input
  with no forced default: omit it and the backend default applies. Use `NONE`
  only for a controlled diagnostic after observed behavior suggests interception
  is breaking the provider. When passed, the value is sent on both register and
  add-version, and the tool's always-on add-version follow-up (see
  `disableRequestReplay` below) reapplies it.
- **builder:** `webSettings.inapp.interceptorOptions.interceptorType`, one of
  `HAWKEYE | MSWJS | CDP`. There is no `NONE` here — **omit
  `interceptorOptions` entirely to disable interception**, and the
  publish tool omits `inapp` rather than defaulting to `HAWKEYE`.

Don't assume a non-`NONE` `injectionType` on an existing provider means
something is broken — HAWKEYE-by-default is normal and inert for the standard
flow.

## Which mechanism, and when to use any of them at all

- **`CDP`** — interception at the browser/DevTools-protocol level, below the
  page's own JS. Works uniformly for every request the page makes, including its
  own document/navigation load. No caveats; works best.
- **`HAWKEYE` / `MSWJS` / `XHOOK`** — interception inside the page's JS context
  (different libraries, same idea). Fine for ordinary sub-resource/API requests,
  but the page's own document request is a special case — see
  "The document-replay flag".
- **Reach for any of them only when the data genuinely can't be reproduced by
  an independent replay** — for example, it depends on one-time server-side
  state (a nonce, a websocket push) that asking again wouldn't return. For
  everything else the standard capture → replay flow is simpler, and is what
  `propose_provider` / `run_proof` are built for.

## When a site won't load, or won't let the user sign in

Three symptoms point the same way:

- the page loads blank, half-rendered, or spins forever;
- sign-in is refused, or the form submits and bounces straight back;
- login succeeds, then the next page breaks.

### First, ask which clients ship this provider

**Ask the author which verification clients their end users will run — don't
infer it.** It decides whether any of this section applies, and it is not
something the session can tell you: the client you author through is `builder`,
whereas production is whatever the author's own app integrates. A provider that
looks healthy here can fail for every real user, and the reverse.

Ask plainly, and offer the list: *"Which clients will run this in production —
the InApp SDK, the verifier app, the browser extension, portals, or something
else? I need it to tell whether interception is a plausible cause."* If they
ship more than one, the diagnosis has to hold for all of them, so treat the
strictest row below as the answer.

| Client the end user runs | Where it intercepts | Does this section apply? |
| --- | --- | --- |
| `inapp-sdk` | Inside the page's JS | **Yes** |
| `verifier-app` | Inside the page's JS | **Yes** |
| `reclaim-browser-extension` | Inside the page's JS | **Yes** |
| `portals` | Browser level, over CDP | No |
| `builder` | Server-side CDP, out of band | No |

A session created with no `verificationClientUrl` runs in `portals`.
`builder` is the row for authoring and for Builder's own "Test this provider"
runs. Reaching it means you are diagnosing the authoring tool, not what the
author's users will hit — which is exactly why you ask first.

The `reclaim-browser-extension` row supports both modes. The extension selects
the Builder API only for the exact `api=2` query and keeps its legacy
interception, `init` / `fromJsonString`, and direct-callback path for missing or
unknown API versions. In Builder mode, Builder supplies the session-bound
attestor authorization; the extension still forwards raw proofs and
does not perform client-side `allowedJsRequests` validation.

**If production is only `portals` or `builder`, stop here and look elsewhere.**
CDP intercepts below the page's own JavaScript, so there is nothing for a site
to detect and nothing to disable — and `builder` never delivers intercepted
traffic to the page at all (topic `user-script`). A verification on those that
won't load or won't sign in is almost always a CAPTCHA or bot challenge
instead: check `analyze_request_constraints` for a `botChallenge` concern, and
treat it as a site that needs a human through a live view rather than a
provider to fix.

### Then bisect, cheapest change first

**For the three in-page clients, suspect interception before the recipe.** A
JS-level interceptor patches the page's own `fetch`/`XMLHttpRequest`, and some
sites treat that as tampering: anti-bot vendors probe for it directly (a
patched `fetch.toString()` is a well-known signal), and a few break on their
own without meaning to. None of that shows up while you author — the MCP agent
captures over CDP, out of band, so the site behaves normally right up until a
real verification runs.

Try document replay first and interception second. Often it is only
document replay that breaks a site, not interception as a whole — the page's
own top-level navigation is the one request pulled through the interceptor, and
that is the one some sites refuse to survive. Turning it off is a much smaller
change than going interceptor-free, and it tells you which half is at fault.
Copy this checklist and work down it:

- [ ] 1. **Turn document replay OFF, keep the interceptor.** Old-devtools:
      `disableRequestReplay: true`. Builder:
      `interceptorOptions.isDocumentRequestReplayEnabled: false` (the two
      backends name this with opposite polarity — see "The document-replay
      flag"). Both publish tools already default it off, so a provider that
      breaks here usually had it switched ON deliberately.
- [ ] 2. **Retry the verification.** Reload, then sign in as a real end-user
      would. Works now → stop here. This is the cheapest fix and you keep the
      interceptor.
- [ ] 3. **Still broken? Temporarily turn interception off to test it.**
      Old-devtools:
      publish with `injectionType: NONE`. Builder: omit `interceptorOptions`
      entirely — there is no `NONE` there, and omitting it disables interception.
- [ ] 4. **Retry again, and compare.** Loads and signs in now → interception
      itself was the cause; keep interception disabled and replace the
      intercepted claim path with `window.Reclaim.requestClaim`. Still broken →
      restore the previous interception setting and investigate the recipe
      (topic `prove`) or browser (topic `browser`).

If step 2 fixed it, you are done — the interceptor stays and only the document
request stops being replayed. Note that under `CDP` the flag is inert, so a
`CDP` provider that breaks is never a document-replay problem.

### Remedies

If step 3 confirmed interception is the cause, keep it disabled. Most providers
can use the standard capture-and-replay flow without an interceptor. Where the
data only exists in a live page, replace `addResponseMiddleware` with a user
script that navigates to the page holding the value and calls
`window.Reclaim.requestClaim`. Declare anything the script fires in
`allowedJsRequests` / `allowedInjectedRequestData` for result verification, and
read topic `hash-validation` first — a session-unique URL there makes
`verifyRequestProof({ providerId })` reject every real proof.

If direct `requestClaim` does not fit the client or provider, a different
interceptor is a fallback, not the first recommendation. The mechanisms patch
the page differently: old-devtools supports `HAWKEYE`, `MSWJS`, `XHOOK`, and
`CDP`; Builder supports `HAWKEYE`, `MSWJS`, and `CDP`. `CDP` operates below the
page's JavaScript but is not supported by every in-page client.

⚠️ **The direct-claim remedy needs a client that consumes `window.Reclaim`.**
The InApp SDK, browser extension, portals, and Builder's built-in client do. The
built-in client uses the page-supplied request to generate the proof;
verification of its recipe hash belongs to `verifyRequestProof`/`verifyResultFull`.
See topic `user-script`.

## The document-replay flag

**Both publish tools default this to disabled, and both let the author override
it.**

- **old-devtools:** `disableRequestReplay`, schema default `false`. The publish
  tool sends `true` by default, auto-following a fresh register with an
  add-version call to apply it (the register endpoint hardcodes it `false`
  regardless of what's sent). Pass `disableRequestReplay: false` explicitly for
  real document replay.
- **builder:** `webSettings.clientOptions.inapp.interceptorOptions.isDocumentRequestReplayEnabled`
  — positive naming, schema default `false`. The publish tool sets `false`
  whenever you pass `interceptorOptions` at all. Pass
  `interceptorOptions.isDocumentRequestReplayEnabled: true` to enable it.

The two backends' polarity is inverted, so don't carry an assumption across.
The old dashboard makes this worse: its checkbox is labeled "Enable Document
Request Replay" and is CHECKED when `disableRequestReplay` is `false`. Its field
hint, verbatim: *"When enabled (default), the main document HTTP request is
actually sent to get the response. When disabled, the expected request and
response are constructed locally without making the network call."*

**This does not gate `addResponseMiddleware` in general** — that fires for any
intercepted request regardless. What it actually controls is whether the
page's own document/navigation request (the one that loads the page's HTML, not
a sub-resource or API call) is sent for real over the network, for the non-CDP
mechanisms. It only matters when the request you're proving *is* that document
request — that is, when the target value is embedded in the page's own HTML
rather than fetched by a separate API call.

- Document request genuinely sent → `addResponseMiddleware` sees it like any
  other request. This is what you need to prove data straight out of the page's
  HTML.
- Document request constructed locally → the interceptor never observes it
  (every OTHER request is still intercepted normally). This is a **per-site
  compatibility escape hatch**: some sites misbehave when their top-level
  navigation is pulled through a JS-level interceptor. Not a privacy or
  architecture choice.
- **`CDP` is exempt from all of it** — it intercepts at the browser level, so
  the document request is never a special case and this flag is inert.

## Recognizing this on a provider you didn't author

`get_provider_info` (old-devtools mode; reads the public SDK backend) returns
the raw `providerConfig`. If `injectionType`/
`interceptorType` is set to something other than the inert default AND the
`customInjection`/`jsUserScripts` calls `reclaimInterceptor.addResponseMiddleware`
(or references `MSWJS`/`XHook`), that provider is on the live-interception path,
not the standard replay flow — read the script before carrying it forward or
editing around it.

If, on top of that, the request being proven IS the login/landing page itself
(its `url` matches `loginUrl`, so it's the document request) and the mechanism
isn't `CDP`, check the document-replay flag too: a value that routes it around
live interception was a deliberate site-compatibility decision, not an
oversight.

## Related topics

- `user-script` — what the script itself does with intercepted traffic, and how
  Builder's built-in client handles `window.Reclaim.requestClaim`.
- `hash-validation` — declaring script-fired requests without breaking
  `verifyRequestProof({ providerId })`.
- `browser` — the modes with a live view (`container`, `builder`), for handing
  a stuck sign-in to a human.
