<!-- topic: overview -->
# Authoring a Reclaim provider (Builder backend)

For claimant-facing Builder-client integration, result verification, or optional
TEE binding, read topic `integration`. Keep URLs without `api=2` on the
existing legacy path. For an asynchronous volunteer contribution to a
public-contribution-enabled provider, read topic `contributions` before using
Builder.

<!-- common: terminology -->

## The loop, at a glance

Build a new org-private provider for the claim the developer described. Ask
one question if the site, account, or value is ambiguous. Copy this checklist
and check off each step. Read the linked topic before a step you don't know.

Steps 2 through 10 need the developer at the browser, so do them before other
work, such as app code. When you need the developer to answer or act, end
your turn with the question and every link they need. Don't use a background
or asynchronous question tool for a blocking question.

- [ ] 1. Name the data points: only the values the claim must prove, usually
      one or two. No identity or profile fields.
- [ ] 2. `attach_browser`, then `list_tabs` → `start_capture(tabId)` ⇒
      **`captureId`**. → topics `browser`, `capture`
- [ ] 3. Open the sign-in page and wait for the developer to sign in
      (`wait_for_page`). → topic `capture`
- [ ] 4. Write the navigation script: sign-in redirect, then each data
      point's page in order. → topic `user-script`
- [ ] 5. `test_user_script({ script, keep: true })`. Fix and retest until it
      reaches every page, also after a reload.
- [ ] 6. Capture by letting the script navigate: `find_requests_containing` →
      `analyze_request_constraints` → pick an **authenticated** request per
      data point. → topic `capture`
- [ ] 7. `propose_provider(captureId, requestId, …)` ⇒ **`draftId`**
      (`targets` = the data points). → topic `draft`
- [ ] 8. Parameterize user-specific URL segments; mark secrets.
      → topic `params`
- [ ] 9. `replay_request(captureId, draftId)`, then again with
      `withoutSecrets: true`. → topic `prove`
- [ ] 10. `run_proof(captureId, draftId)`.
      → topics `prove`, `credentials`
- [ ] 11. `create_provider` (or a new version of a provider your org owns) →
      `create_provider_version_from_capture` (publishes the kept script as
      `webSettings.jsUserScripts`) → `publish_provider_version` or
      `submit_provider_version_for_review`. → topic `publish`

Replay or proof blocked with 403 after one retry and one correction? Stop
retrying and go straight to step 11: publish the draft unproven from the
captured request, then ask the developer to try a real verification. → topic
`prove`, "publish from the capture".

Data points on different requests? Run steps 7-10 once per request, then
publish every proven draft in one call. See topic `publish`.

<!-- topic: contributions -->

<!-- topic: auth -->
## Getting authenticated

**Check first:** call `get_me`. A profile back means you're authenticated —
proceed.

**On 401:** `authenticate({})` starts a device-pairing session. It returns
immediately with a `code` and `attachUrl` — it does NOT poll.

1. Tell the user: _"Open `<attachUrl>`, sign in, and click 'Authorize this
   device'."_
2. After they confirm, call `authenticate({ code: "<code>" })` —
   `LINKED` → proceed; `PENDING` → wait and call again; `EXPIRED` → start over.

The 2-day token is cached in `~/.reclaim/config.json` and reused on later runs
(`RECLAIM_API_TOKEN` in the server env overrides it).

### Backend mode

`get_devtools_mode` reports the active mode. `set_devtools_mode` persists a
switch to `~/.reclaim/config.json`, effective on the next server start. An
explicit `USE_OLD_DEVTOOLS` env var wins.

<!-- topic: devtools-migration -->
## Import providers from devtools

Use these operations only when the developer is migrating an existing legacy
integration. Prefer Builder for new integrations.

### Import from devtools

1. Get the target `orgId` with `list_orgs`.
2. Ask the developer for the legacy provider UUID.
3. Call `import_devtools_provider(orgId, providerId)`.
4. Use the returned provider UUID for all Builder operations. Import preserves
   the UUID and latest legacy semantic version. It claims an anonymous catalog
   seed idempotently, but never moves a provider from another Builder org. The
   server reads the public devtools API; no legacy token is required.

<!-- topic: browser -->
<!-- common: browser -->

<!-- topic: capture -->
## Capture

1. **Attach** — topic `browser`.

2. **Pick a tab and start the capture.** `list_tabs`, then
   `start_capture(tabId)` ⇒ a **`captureId`**: the session handle every browser
   and inspect tool takes as its first argument (`navigate`, `eval_in_page`,
   `wait_for_page`, `list_requests`, `find_requests_containing`,
   `propose_provider`). If a tab is already on the right origin use it,
   otherwise the first is usually fine. Capturing from the start is harmless —
   it also records the login navigation. Then `navigate(captureId, url)` to
   the site you inferred from the developer's request ("GitHub username" →
   `https://github.com`). Don't ask the developer to navigate.

3. <!-- common: login-detect -->

4. **Write and keep the navigation script** (topic `user-script`) as soon as
   the developer is signed in, or the sign-in URL is known. Test it with
   `test_user_script` and `keep: true`. The script visits each data point's
   page; build its URLs from what you know about the site and read page state
   with `eval_in_page` when needed (for example, GitHub's
   `meta[name="user-login"]`'s `content`).

5. **Trigger the requests by letting the script navigate.** Capture has been
   live since step 2. Reload the page (`eval_in_page(captureId,
   "location.reload()")`) so the kept script runs from the start. Don't click
   by hand or ask the developer to; if a request needs an interaction, add it
   to the script.

6. <!-- common: identify-value -->

7. <!-- common: find-request -->

<!-- topic: draft -->
## Draft the provider

## Contents

- [Choose a privacy mode](#choose-a-privacy-mode)
- [Draft and inspect the request](#draft-and-inspect-the-request)
- [Preserve the canonical shape](#preserve-the-canonical-shape)

### Choose a privacy mode

<!-- common: oprf -->

### Draft and inspect the request

**Call `propose_provider`.** It returns a **`draftId`** — the handle for
`replay_request` and `run_proof` — plus the secret-free `provider` and
`secretRefs`. The recipe **and the captured secret values** live server-side
under that `draftId`; the secrets never enter the transcript, so you carry the
`draftId`, not the provider JSON, into replay/prove.

**Extracting more than one value?** Add a value only when the claim needs it.
Prefer a **single request whose response contains all of them** and draft them
together — one `responseMatches` +
`responseRedactions` pair per value. Find that request by running
`find_requests_containing` for each value and picking a `requestId` common to
all. Then pass a `targets` array, each entry with its `value` (exactly as it
appears) and a distinct `name`:

```
propose_provider(captureId, requestId, name, targets: [
  { value: "Scratch-net", name: "username" },
  { value: "2019",        name: "member_since_year" },
])
```

The shorthand `propose_provider(captureId, requestId, target, name, hash?)`
still works for one target. Per-target `hash` works inside `targets` too.

**Inspect what comes back:**

- Is the right header marked secret? (cookies, `Authorization`, `X-*` tokens)
- Is `responseMatches[0].value` a `contains` with a `{{name}}` template matching
  the captured value's structural context?
- Is `paramValues[name]` the original captured value?
- Does each `responseRedactions` entry carry an `xPath`/`jsonPath` anchor
  **plus** a named-capture `regex` isolating the value? The synthesizer adds the
  regex in both cases — an HTML reveal is the element markup and a jsonPath
  reveal is the surrounding `"key":"value"`, so neither is the bare value
  without it. (With `hash`, the regex also carries `hash: oprf-…`.)

**Provenance — match the structure, never the bare value.** The `contains`
template and the redaction regex are always anchored on the value's surrounding
context — the JSON key (`"login":"{{username}}"`) or the enclosing element
(`<div class="handle">{{username}}</div>`) — never `{{username}}` alone. That
ties the proof to *where the value legitimately appears*; a bare-value match
would let a user surface the same string from any field they control. The
synthesizer does this for you.

**Canonical drafted shape** (no hash):

```json
{
    "responseMatches": [
        { "type": "contains", "value": "\"login\":\"{{username}}\"" }
    ],
    "responseRedactions": [
        {
            "xPath": "//script[@id=\"client-env\"]",
            "regex": "\"login\":\"(?<username>[A-Za-z0-9_-]+)\""
        }
    ],
    "paramValues": { "username": "Scratch-net" }
}
```

With `hash: 'oprf-raw'`, the redaction gains `"hash": "oprf-raw"`. Nothing else
changes.

### Preserve the canonical shape

<!-- common: rewrite-shape-block -->

<!-- topic: params -->
## Parameters: extracted, consumer-supplied, and secret

## Contents

- [Choose the parameter source](#choose-the-parameter-source)
- [Protect secret values](#protect-secret-values)
- [Hide internal fields from claimant UI](#hide-internal-fields-from-claimant-ui)
- [Understand runtime resolution](#how-the-verification-client-resolves-these-at-runtime)

### Choose the parameter source

**Parameterize user-specific URL segments** so the provider isn't pinned to one
user. The matcher already puts the *captured* value in `paramValues`. If the
consumer knows a URL value before verification and the proof must be pinned to
it, make it a **consumer-supplied context param**. At verification time, its
value comes from the consumer's session `context`, not from extraction.

Replace them with `{{context.<name>}}`, for example
`https://github.com/Scratch-net/repos` →
`https://github.com/{{context.username}}/repos`, with `paramValues: { …,
"context.username": "Scratch-net" }` for replay/proof (the key must match the
placeholder exactly, dot included).

- Query params with user-specific values → same treatment.
- Generic segments (`/api/v3`, `/users`, `/repos`) stay literal.
- No user-identifying segments (for example, `/settings/profile`) → leave it
  alone.

Use a bare `{{name}}` only when the value can be observed in the same live
request. A multi-request recipe does not bind a value extracted from one
response to a later request. If proving that relationship is required, use a
request that exposes both values, require the value as consumer context, or
stop and explain that the current recipe format cannot prove the dependency.

Declare them in the version's `requiredContext` at publish time (topic
`publish`).

<!-- common: secrets -->

The `context.` prefix is a **Builder-only namespace** (consumer-supplied vs
extracted-from-traffic). The attestor itself only looks up `{{whatever}}` in
`paramValues`/`secretParams.paramValues` and doesn't care about the prefix.

<!-- common: no-rename-param -->

### How the verification client resolves these at runtime

- Requests match by **exact origin+path** (query ignored). A
  `{{context.<name>}}` segment matches **only the value the consumer sent**
  (validated against `requiredContext`); a bare `{{name}}` segment matches any
  one path segment and its value is **auto-extracted from live traffic**.
- Interpolation and `contains` matching are **plain text** — JSON, XML, HTML,
  form-encoded, anything.
- Extract selectors apply **client-side in spec order xPath → jsonPath →
  regex**, each to the prior selection. Only the FIRST selector constrains the
  full response (an `xPath`→`jsonPath` chain reads JSON embedded in HTML; a
  jsonPath-first extract needs the whole response to be JSON). Only the selected
  portions reach the attestor.
- A matched response that can't satisfy the recipe is **skipped, not failed**
  (the first selector can't operate on it, or a required `contains` is missing).
  The client keeps polling until timeout.
- So: `{{context.<name>}}` when the consumer knows the value up front and the
  proof should be **pinned** to it; bare when the value should come from
  whatever the logged-in user's traffic shows.

Builder-mode Verification Clients include one migration fallback for old
DevTools providers: when a recipe uses bare `{{name}}` instead of
`{{context.name}}`, the client seeds a missing `parameters.name` from scalar
session `context.name`. An explicit parameter wins. Do not rely on this
fallback for new providers; keep using `{{context.<name>}}` so
`requiredContext` is derived and validated before the session starts.
Builder-owned `reclaimSessionId` and `attestationNonce` remain context-only.

`propose_provider` returns `verificationWarnings` for calls only an author can
make (currently: a captured value baked literally into the URL, needing the
`{{context.<name>}}`-vs-bare-vs-recapture decision). Advisory, never blocking —
**surface each one verbatim** and resolve it before publishing.

<!-- topic: prove -->
## Replay, then prove

**1. Replay.** `replay_request(captureId, draftId)`:

- `matchesOriginal: true` → proceed.
- `false` with `hints` mentioning auth/csrf → re-trigger the action yourself
  (navigate or reload with the tools) and redraft. Don't ask the developer to
  redo it.
- `false` with a stable diff (timestamps, and so on) → tighten the matcher
  and retry.

**2. The authentication-bound check — mandatory.**
`replay_request(captureId, draftId, withoutSecrets: true)` re-issues the request
with no secrets/cookies, as an anonymous visitor.

- FAILS to extract (401/403/redirect, or the value is gone) → the endpoint is
  auth-bound. Good: the proof genuinely means "the holder of these secrets saw
  this value."
- STILL extracts the value → the endpoint is **PUBLIC**; the proof binds to
  nobody. **Do NOT prove it.** Find a request whose response depends on the
  session (an API keyed to the logged-in user — `/settings/*`, a
  `viewer`/`currentUser` API) and re-check. If the value only ever appears on
  public responses, tell the developer it can't be proven as an identity claim.

**3. Prove.** `run_proof(captureId, draftId)`. On
`verified: true` the full claim is written to
`~/.reclaim/claims/<timestamp>.json` and you get
`{verified, extractedValue, extractedParameters, identifier, owner, claimPath, claim}`.
`claim` is display-ready (huge `request` payload stripped, byte arrays base64'd)
— **show it to the developer as a fenced JSON block at the end**, with the
provider JSON. That's the final result.

**Country.** `run_proof` sends the attestor's request from the developer's own
IP country, which is what `{{DYNAMIC_GEO}}` becomes when they verify; `egress`
in the result names the country. If a site that serves one country (for
example, a US airline) blocks the attestor, retry once with
`geoLocation: "US"`. If that verifies, pin it with
`update_draft({ geoLocation: "US" })` so the published version goes out from
there too.

**`errorKind: "missing-owner-key"`** → no eth proof-owner key yet. Tell the
developer what's happening and drive the bootstrap yourself — see topic
`credentials`. No restart needed, and the existing `draftId` stays valid.

**Network error from `run_proof`.** Read its `diagnosis`. Attestor reachable
→ the target site likely blocks the attestor's network; call
`run_proof_via_pod`. Attestor unreachable → `check_attestor` confirms it; the
fix is on the developer's network. Don't loop retries.

<!-- common: prove-tail -->

<!-- topic: publish -->
## Publish

`provider` is the JSON from the draft step with the `params` URL
parameterization applied. `initialUrl` is the page where the user logs in / the
value is displayed (for example, `https://github.com/Syed`) — **not** the API
endpoint URL inside the provider.

**1. Resolve the `providerId`.** For a new claim, call
`create_provider(orgId, domain, slug, title, description)` (`orgId` from
`list_orgs`; `domain` such as `github.com`, `slug` such as `github-username`,
`title` such as "GitHub Username"). It starts PRIVATE with an empty seed
version. Use an existing `providerId` only when your org owns the provider and
you are revising it: the capture lands as a NEW VERSION on it. For another
org's provider that almost fits, create your own provider and version.

**2. Persist the version.**
`create_provider_version_from_capture(providerId, provider, initialUrl, notes)`
— `notes` such as `"Initial draft from browser capture"`. It lands on the
`draft` branch. This always creates a new immutable semantic version. Omit
`version` and `bump` for the default patch bump; set `bump` to `major`, `minor`,
or `patch`, or pass the exact higher `version` requested by the user. Never edit
or archive an existing version to apply provider changes.

- **Multi-request provider** (landing call + details call, a
  CSRF-preflight/refresh-token chain, …): run capture→draft→replay→prove ONCE
  PER REQUEST, then pass `providers: [draftA, draftB, …]` instead of the single
  `provider`. Each becomes its own request on the version and **all** are
  required at verification time. This proves that every request matched; it
  does not automatically bind a value extracted from one response to another
  request.
- **Navigation script:** the script kept with `test_user_script` (`keep: true`)
  is published as `webSettings.jsUserScripts`. Pass `jsUserScripts` only to
  override it. → topic `user-script`. For extra requests the script may fire
  (for example, pagination), pass `allowedJsRequests`. Before populating it for
  a `verifyRequestProof({ providerId })` use case, read topic
  `hash-validation`: a session-unique URL there makes `verifyRequestProof`
  reject every real proof.

**3. `requiredContext` is derived for you.** The publish tool scans the recipe's
url/body for `{{context.<name>}}` placeholders and emits a JSON Schema requiring
each — the Builder then validates every session-create's `context` against it (a
clear 400 instead of a late attestor failure). Extra context fields are always
allowed; it's optional when the recipe has no `{{context.*}}` placeholders.
Derived properties are plain strings. To refine types or add descriptions,
pass the complete `requiredContext` in the same
`create_provider_version_from_capture` call:

```json
{ "requiredContext": { "type": "object", "required": ["username"], "properties": { "username": { "type": "string", "description": "GitHub username to verify" } } } }
```

**4. Go live.** PRIVATE → `publish_provider_version`. PUBLIC →
`submit_provider_version_for_review(providerId, version)`, then tell the
developer it's awaiting admin review.

**5. Tell the developer how consumers call it.** Sessions must include the
context params — for example, `context: { "username": "…" }` in
`create_verification_session`. Quote the `requiredContext` from the created
version verbatim — a session missing those fields gets a 400, and verification
matches the supplied values exactly. Then continue as the server
instructions say under "What the developer wants".

**6. If the response includes `_notes` for an attached browser, follow them for
an optional authenticated-state retest.** Only when its profile is still signed
in, navigate to `initialUrl`; if a user script is present, run
`test_user_script` with that script and `initialUrl`. When the existing capture
has enough data, replay and prove every required request. Do not clear
cookies or force another sign-in. Treat an unavailable or inconclusive retest as
advisory and do not block publication. Don't ask whether to close the
browser. Mention once in the final summary that it stays open for provider
changes and you can close it on request; call `dispose_browser` only when the
developer says so. A `builder` session is quota-accounted, so close it as soon
as they say the work is done.

<!-- topic: discover -->
## Discover and resolve existing providers

Use this flow only when the developer asks to reuse existing providers, names
one, or doesn't know what a site supports. Otherwise build a new provider.

1. Ask which website their users prove data from.
2. `discover_data_points({ domain })` → what's verifiable there. Confirm the
   data points with the developer.
3. `discover_resolve({ domain, dataPoints })` → the smallest provider set
   (`providers`, greedy combine), the `requiredContext` inputs to collect, and
   any `uncovered` points (author those with the checklist in topic
   `overview`, then re-resolve).
4. Use only the data points the developer confirmed: show and read only those
   and ignore the rest. A provider that needs any change (a missing data point, extra inputs, a different extraction) gets your own copy
   (`create_provider_version` when your org owns it; otherwise
   `create_provider`, then `create_provider_version` from a copy of its
   config, trimmed to the requested data points). Otherwise it's published and
   usable as-is; don't capture, replay, or prove it unless the developer asks.
   When a requirement (site, account, or value) is ambiguous, ask one concise
   question; don't guess.
5. To try them: `create_verification_session({ providers: [{ providerId }, …],
   context, verificationClientUrl })` with EVERY resolved provider id and the
   collected context. A session opens only in the client it was created for:
   for an in-app SDK or add-to-app host, pass
   `https://build.reclaimprotocol.org/share/inapp-sdk`; omitted, it is a
   Portal session. For a native app, read the README of the
   [iOS SDK](https://github.com/reclaimprotocol/reclaim-inapp-ios-sdk#readme)
   or the
   [Android SDK](https://github.com/reclaimprotocol/reclaim-inapp-android-sdk#readme)
   before writing app code. Topic `integration` ("Try a provider without an app")
   covers the callback and polling, and the integration steps.

`merge.mergeable` only signals the set *could* collapse into one provider. Pass
them all; the Builder runs them in one session.

<!-- topic: ai-sessions -->

<!-- topic: integration -->

<!-- topic: zkfetch -->

<!-- topic: never-do -->
## Things to never do

<!-- common: never-do-common -->
- Never request `hash` for a target whose value also appears in the request URL
  (topic `draft`), and never `hash` a free-form target — `propose_provider`
  throws either way; retrying won't help.

<!-- topic: credentials -->
<!-- common: credentials -->

<!-- topic: troubleshooting -->
## Troubleshooting

**`unknown draftId` / `no capture`.** The draft is bound to its capture, held in
the MCP server process. Anything that restarts the server (Claude Code restart,
`reset_session`, reboot) drops every capture and its drafts. The fix is always
`start_capture` → interact → `propose_provider` for a fresh `draftId`. Don't ask
the developer to "re-enter the value" — walk them back through capture.

**Replaying as an anonymous visitor.** Pass `withoutSecrets: true` to
`replay_request`; the draft still holds the captured secrets, so you never
re-supply them.

**Site won't load, won't let the user sign in, or breaks right after
sign-in.** Check WHICH client the session targets first: on `builder` (the
default) and `portals` interception happens over CDP, so it is never the
cause — look for a captcha instead. On `inapp-sdk`, `verifier-app`, or the
browser extension, suspect interception before the recipe, and bisect: FIRST
turn
document replay off and keep the interceptor (`disableRequestReplay: true`, or
`isDocumentRequestReplayEnabled: false` on builder) — often that alone is what
breaks the page, and it's the smallest change. Only if that doesn't help, turn
interception off temporarily to confirm it is the cause (`injectionType: NONE`,
or omit `interceptorOptions`). If that fixes the provider, keep interception
off and replace intercepted claims with `window.Reclaim.requestClaim`. Full
checklist and remedies: topic `interception`.

**Proof failures / attestor errors** → topic `prove`. For a network error,
read `run_proof`'s `diagnosis`, then `check_attestor` or `run_proof_via_pod`.
**Browser won't launch or attach** → topic `browser`.
**Missing signing key** → topic `credentials`.
