<!-- topic: overview -->
# Authoring a Reclaim provider (old-devtools backend)

<!-- common: terminology -->

## The loop, at a glance

Copy this checklist and check off each step as you finish it. Read the linked
topic before a step you aren't already fluent in.

- [ ] 1. `reclaim_authenticate` once. → topic `auth`
- [ ] 2. `attach_browser()` with no arguments — opens a visible local browser.
      → topic `browser`
- [ ] 3. `list_tabs` → `start_capture(tabId)` ⇒ **`captureId`**, your handle for
      everything below. → topic `capture`
- [ ] 4. Drive the page: `navigate`, `wait_for_page`, `eval_in_page`,
      `get_cookies`. Detect login, land on the page showing the value, trigger
      the request. → topic `capture`
- [ ] 5. `find_requests_containing` → `analyze_request_constraints` → pick an
      **authenticated** request. → topic `capture`
- [ ] 6. `propose_provider(captureId, requestId, …)` ⇒ **`draftId`** (recipe +
      captured secrets, held server-side — secrets never enter the transcript).
      → topic `draft`
- [ ] 7. Parameterize user-specific URL segments; mark secrets. → topic `params`
- [ ] 8. `replay_request(captureId, draftId)`, then again with
      `withoutSecrets: true`. → topic `prove`
- [ ] 9. `run_proof(captureId, draftId)`.
      → topics `prove`, `credentials`
- [ ] 10. `create_provider_version_from_capture`. → topic `publish`

Replay or proof blocked with 403 after one retry and one correction? Stop
retrying and go straight to step 10: publish the draft unproven from the
captured request, then ask the developer to try a real verification. → topic
`prove`, "publish from the capture".

Multi-request provider? Run steps 6–9 once per request, then publish every
proven draft in one call. See topic `publish`.

**This mode's limits.** Only GET/POST requests can be captured into providers.
There is no organization management, credential-linking, or public-review
workflow — the narrow `authenticate_builder` / `list_builder_organizations`
exception exists only to allocate Builder-hosted authoring browsers.
`get_me_providers` is the only provider-listing tool here.

**Diagnosing a session:** `session_analytics_logs` returns a session's
milestone events; `session_logs` returns the log entries the SDK itself
emitted. Read both from topic `troubleshooting`.

<!-- topic: auth -->
## Getting authenticated

Call `reclaim_authenticate({})` with no arguments. It opens the Reclaim
dashboard only in a local Chrome over loopback CDP, waits for the developer to
sign in, reads the token from the page, and closes the tab. It never uses a
Builder, container, custom-CDP, or shared browser. A still-valid cached identity
is reused first, so it's often instant. Tell the developer once: _"A local
Chrome window is opening the Reclaim dashboard — please sign in and I'll
continue automatically."_

- Force a fresh login: `reclaim_authenticate({ useBrowser: true })`.
- Skip the browser: `reclaim_authenticate({ token: "<firebase-id-token>" })`, or
  `reclaim_authenticate({ ethAddress: "0x…" })` for a provisioned eth user.
- Tokens are short-lived (~1h). Any later 401 → call `reclaim_authenticate({})`
  again.

### Two independent auth systems — don't confuse them

`reclaim_authenticate` and `authenticate_builder` log into DIFFERENT backends
and are NOT interchangeable.

- **`reclaim_authenticate`** authorizes everything in this mode:
  `create_provider_version_from_capture`, `get_me_providers`, and the rest.
- **`authenticate_builder`** covers exactly two Builder-exclusive features:
  allocating a Builder remote browser (`attach_browser mode="builder"`) and
  `list_builder_organizations`. It authorizes nothing else.

`get_devtools_mode` reports the presence of both. If a publish or
`get_me_providers` call fails with an auth error even though
`reclaim_authenticate` ran earlier, the old-devtools token has expired — re-run
it. Don't assume `authenticate_builder` fixes it.

### Backend mode

The BUILDER backend (generated API tools, orgs, verification sessions, public
review) is one switch away. `get_devtools_mode` reports the active mode and
why; `set_devtools_mode` persists a switch to `~/.reclaim/config.json`,
effective on the NEXT server start. An explicit `USE_OLD_DEVTOOLS` env var wins
over the persisted choice.

<!-- topic: browser -->
<!-- common: browser -->

<!-- topic: capture -->
## Capture

1. **Attach** — topic `browser`.

2. **Pick a tab and start the capture.** `list_tabs`, then
   `start_capture(tabId)` ⇒ a **`captureId`**: the session handle every browser
   and inspect tool takes as its first argument (`navigate`, `eval_in_page`,
   `wait_for_page`, `get_cookies`, `list_requests`, `find_requests_containing`,
   `propose_provider`). If a tab is already on the right origin use it,
   otherwise the first is usually fine. Capturing from the start is harmless —
   it also records the login navigation. Then `navigate(captureId, url)` to
   the site you inferred from the developer's request ("GitHub username" →
   `https://github.com`). Don't ask the developer to navigate.

3. <!-- common: login-detect -->

4. **Navigate to the page that displays the value.** Construct the URL from what
   you know about the site; eval for anything you need (for example, GitHub's
   `meta[name="user-login"]`'s `content`), then `navigate(captureId, url)`.

5. **Trigger the request.** Capture has been live since step 2, so make the
   call fire: `eval_in_page(captureId, "location.reload()")`, or click an
   element / hit a SPA route programmatically. Don't ask the developer to click.

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

**Extracting more than one value?** Prefer a **single request whose response
contains all of them** and draft them together — one `responseMatches` +
`responseRedactions` pair per value. Find that request by running
`find_requests_containing` for each value and picking a `requestId` common to
all. Then pass a `targets` array, each entry with its `value` (exactly as it
appears) and a distinct `name`:

```
propose_provider(captureId, requestId, name, targets: [
  { value: "Scratch-net", name: "username" },
  { value: "Alex",        name: "name" },
])
```

The shorthand `propose_provider(captureId, requestId, target, name, hash?)`
still works for one target.

**Inspect what comes back:**

- Is the right header marked secret? (cookies, `Authorization`, `X-*` tokens)
- Is `responseMatches[0].value` a `contains` with a `{{name}}` template matching
  the captured value's structural context?
- Is `paramValues[name]` the original captured value?
- Does each `responseRedactions` entry carry an `xPath`/`jsonPath` anchor
  **plus** a named-capture `regex` isolating the value? (With `hash`, the regex
  also carries `hash: oprf-…`.)

**Provenance — match the structure, never the bare value.** The `contains`
template and the redaction regex are always anchored on the value's surrounding
context — the JSON key (`"login":"{{username}}"`) or the enclosing element —
never `{{username}}` alone. That ties the proof to *where the value legitimately
appears*; a bare-value match would let a user surface the same string from any
field they control. The synthesizer does this for you.

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

**Parameterize user-specific URL segments** so the provider isn't pinned to one
user. The matcher already puts the *captured* value in `paramValues`. If the URL
*also* carries user-identifying segments, those are **consumer-supplied context
params** — their values come from the consumer at verification time, not from
extraction.

Replace them with `{{context_<name>}}` and add
`paramValues: { …, "context_username": "Scratch-net" }`. **This backend does not
support the dotted `{{context.<name>}}` form the Builder uses**, and there is no
`requiredContext` declaration here — the convention is the whole mechanism.

- Query params with user-specific values → same treatment.
- Generic segments (`/api/v3`, `/users`, `/repos`) stay literal.
- No user-identifying segments (for example, `/settings/profile`) → leave it
  alone.

<!-- common: secrets -->

The `context_` prefix is a naming convention (consumer-supplied vs
extracted-from-traffic). The attestor itself only looks up `{{whatever}}` in
`paramValues`/`secretParams.paramValues` and doesn't care about the prefix.

<!-- common: no-rename-param -->

`propose_provider` returns `verificationWarnings` for calls only an author can
make (currently: a captured value baked literally into the URL, needing the
`{{context_<name>}}`-vs-bare-vs-recapture decision). Advisory, never blocking —
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
  session and re-check. If the value only ever appears on public responses, tell
  the developer it can't be proven as an identity claim.

**3. Prove.** `run_proof(captureId, draftId)`. On
`verified: true` the full claim is written to
`~/.reclaim/claims/<timestamp>.json` and you get
`{verified, extractedValue, extractedParameters, identifier, owner, claimPath, claim}`.
`claim` is display-ready (huge `request` payload stripped, byte arrays base64'd)
— **show it to the developer as a fenced JSON block at the end**, with the
provider JSON. That's the final result.

**`errorKind: "missing-owner-key"`** → no eth proof-owner key yet. Tell the
developer what's happening and drive the bootstrap yourself — see topic
`credentials`. No restart needed, and the existing `draftId` stays valid.

<!-- common: prove-tail -->

<!-- topic: publish -->
## Publish

`provider` is the JSON from the draft step with the `params` URL
parameterization applied. `initialUrl` is the page where the user logs in / the
value is displayed (for example, `https://github.com/Syed`) — **not** the API
endpoint URL inside the provider. It maps to the provider's `loginUrl`.

Call `create_provider_version_from_capture`:

- **New provider:** omit `providerId`. Registers a new provider at version
  1.0.0. Pass `provider`, `initialUrl`, optionally `description`,
  `geoLocation`, `providerType` (`PRIVATE` default | `PUBLIC`).
  ⚠️ Re-running without `providerId` registers ANOTHER provider — that's how
  duplicates appear. Check `get_me_providers` first.
- **New version of an existing provider:** pass its `providerId`. Omit
  `version` and `bump` for the default patch bump; set `bump` to `major`,
  `minor`, or `patch`, or pass the exact higher `version` requested by the
  user. Every change creates a new immutable version; never edit an existing
  version. Pass `notes` (≥10 chars).
- **Multi-request provider** (landing call + details call, a
  CSRF-preflight/refresh-token chain, …): run capture→draft→replay→prove ONCE
  PER REQUEST, then pass `providers: [draftA, draftB, …]` instead of the single
  `provider`. Each becomes a parallel `requestData` entry on the SAME version
  and **all** are required at verification time.
- **Login/navigation-gated data:** supply `customInjection` (plain page JS) and
  `allowedInjectedRequestData` (extra requests the script may fire).
  → topic `user-script`. Before populating `allowedInjectedRequestData` for a
  `verifyRequestProof({ providerId })` use case, read topic `hash-validation`.

**Ownership — you can only add a version to a provider YOU own.** The
`providerId` must come from `get_me_providers`. Versioning a public provider you
don't own fails with a permission error; that's expected. To publish your own
version of such a site, re-run **without** `providerId` to register your own
copy. If versioning a provider you *do* own fails, confirm you authenticated as
the account that created it.

**Before adding a version to an existing provider, read the current one with
`get_provider_info(providerId)` — this is not optional.** This backend has no
partial-patch endpoint: every version replaces the WHOLE `providerConfig` with
exactly what you pass in THIS call, and the tool carries **nothing** forward.
Any field you want to survive must be re-supplied here — `customInjection`,
`userAgent`, `pageTitle`, `allowedInjectedRequestData`, `stepsToFollow`,
`useIncognitoWebview`, `extensionConfig`, and `requestData` (through
`provider`/`providers`). Anything omitted is published blank. So to change one
field: read the live config, then pass the full desired config (existing values
plus your change) back in.

`allowedInjectedRequestData`, `useIncognitoWebview` and `extensionConfig` take
effect on add-version only — the register endpoint ignores them, so on a fresh
register the tool automatically follows up with an add-version call that
applies them.

**Related tools:**

- `update_provider_metadata(providerId, {…})` — rename, redescribe, retag, flip
  `providerType`, toggle `isActive`, **without** creating a version. A genuine
  partial update; don't route a pure metadata edit through a new version.
- `get_provider_info(providerId, versionNumber?)` — look up ANY published
  provider (not just yours) and see exactly what the live verification client
  would fetch. Reads the public production SDK backend directly, no auth.

There's no create-then-version step and no org / public-review workflow here.
When done, tell the developer the version is live, then ask once how they want
to use it — try it now, integrate it into an existing backend or frontend, or
create a new app — unless they already said:

> Want to (1) try it right now here, (2) integrate it into an existing backend
> or frontend (this directory or another path), or (3) create a new app for it?

Try it now → `scaffold_reclaim_demo_server` with its `providerId`. Integrate,
or new app → `get_js_sdk_integration_guide`, then work in the path they named.

A provider found with `get_me_providers` or `get_provider_info` is published
and usable as-is. Don't capture, `replay_request`, or `run_proof` against it
unless the developer asks you to check or test it.

**If the response includes `_notes` for an attached browser, follow them for an
optional authenticated-state retest.** Only when its profile is still signed in,
navigate to `initialUrl`; if `customInjection` is present, run
`test_user_script` with that script and `initialUrl`. When the existing capture
has enough data, replay and prove every required request. Do not clear
cookies or force another sign-in. Treat an unavailable or inconclusive retest as
advisory and do not block the completed provider. Don't ask whether to close the
browser. Mention once in the final summary that it stays open for provider
changes and you can close it on request; call `dispose_browser` only when the
developer says so.

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

**Auth errors on publish / `get_me_providers`** → the old-devtools token
expired. Re-run `reclaim_authenticate` (topic `auth`), not
`authenticate_builder`.

**`reclaim_authenticate` seems to hang.** On a FRESH Chrome profile the
dashboard is a large cold download, so the login form can take tens of seconds
to become usable — that time comes out of the sign-in budget. Tell the
developer it is loading and that the window is waiting for them, and DON'T
re-run the tool while it is still waiting: a second call restarts the whole
wait and is what turns a slow load into an apparent multi-minute hang. If it
does time out, the error says whether the page ever became interactive —
"never became interactive" means the load, not the human.

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

**A session stalled, matched nothing, or produced no claim.** Read it with
two tools, coarse to fine. `session_analytics_logs` returns the milestone
events for a session id — SESSION_STARTED, PROOF_GENERATION_FAILED, and so on
— which tells you how far the session got. `session_logs` returns the log
entries the SDK emitted, each with its event type, log level, and logger name,
which tells you why it stopped: the request it intercepted, the match or
redaction that failed, and what the attestor answered. Work through it in this
order:

1. Call `session_analytics_logs({ sessionId })` to place the failure on the
   timeline.
2. Call `session_logs({ sessionId, eventsOnly: true })` for the same timeline
   at entry level, then drop `eventsOnly` and add `contains` or `eventType` to
   read around the entry that failed.
3. To compare a working run against a broken one, filter by `source` — it
   carries the SDK, platform, and version, which is usually the variable that
   differs.

Two defaults decide whether you see anything: the backend searches only the
last 3 days unless you pass `startTime` and `endTime`, and it deletes entries
after 30 days. An empty result is more often one of those than a genuinely
silent session, so read the `hint` the tool returns before concluding
anything. When a session is too large to read inline, pass `saveTo` to write
every entry to an NDJSON file and grep that file instead.

**Proof failures / attestor errors** → topic `prove`.
**Browser won't launch or attach** → topic `browser`.
**Missing signing key** → topic `credentials`.
