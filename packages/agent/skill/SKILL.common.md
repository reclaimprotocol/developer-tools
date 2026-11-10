<!-- section: terminology -->
> **provider** = the recipe you author (the `responseMatches`/`responseRedactions`
> spec behind a `providerId`). **verification** = the runtime act of an end-user
> proving a data point *using* a provider. Never call a provider a
> "verification". If the developer does, use "provider" yourself.
>
> **user script** = the plain browser JS that runs before every page load
> ("JS injection", "custom injection", "web script" all mean this). Builder's
> field is `jsUserScripts`; old-devtools' is `customInjection`. Same thing.

**Your stance is driver, not orchestrator.** Navigation, reloads, DOM
inspection, request capture — all yours. Pause only for what needs a human:
typing credentials, 2FA, captchas, confirming a genuinely ambiguous value.

**When you're stuck, read before you guess.** Every failure mode here has a
topic. Pull the matching one with `how_it_works({ topic })` and offer the
developer what it says — a site that won't load points at `interception`, a
failing proof at `prove`, a dead browser at `browser`, an expired draft at
`troubleshooting`. Inventing a cause wastes their time; the guide usually
already names it.

<!-- section: browser -->
## Choosing a browser

## Contents

- [Sharing a container browser](#sharing-the-containers-live-view-share_browser_view)
- [Container lifetime and isolation](#how-containers-are-shared-and-when-they-close)
- [Container startup problems](#when-the-container-will-not-start)

**Default: call `attach_browser()` with no arguments. Don't ask anything
first.** It opens a visible browser on the developer's own machine with the
persistent Reclaim profile (`~/.reclaim/chrome-profile`), so a site they sign
in to stays signed in. It uses installed Chrome, then Chromium, then Edge. If
none is installed, or the installed one won't start, it downloads Chrome for
Testing once into `~/.reclaim/browsers` and uses that. When the result says
Chrome for Testing was used, tell the developer in one line.

**Side note on sharing.** Tell the developer once, in passing, that if a
volunteer is helping them sign in, you can set up a shareable link to the
browser (`container` mode and `share_browser_view`). Don't ask about it, and
don't set it up unless they ask.

**Other modes are opt-in.** Pass `mode` only when the developer explicitly asks
for one of these, or when `attach_browser()` fails even with Chrome for
Testing (for example, no display on Linux). In that case, use `container` if
Docker is running and say why in one line. Otherwise don't offer them, list
them, or pick one yourself, and don't reuse a mode from an earlier session.

| mode | when the developer asks for | needs |
| --- | --- | --- |
| `attach` | The Chrome they already have open, with its tabs, extensions, and logins | `port` (default 9222) |
| `container` | Someone else signs in, or a phone-only site. The Reclaim runtime runs in Docker on their machine; `share_browser_view` turns its viewer into a public link | Docker running |
| `builder` | A browser hosted by Reclaim, or browsing from a specific country. **Billed** against the org's quota; say so before you call it | Builder auth, `orgId` |
| `custom` | A `ws://` or `wss://` CDP endpoint they supply | `cdpUrl` |

**`attach` gotcha (Chrome 136 and later):** the developer's Chrome must be
started with BOTH `--remote-debugging-port=9222` AND
`--user-data-dir=<non-default-path>`. The debug flag is silently ignored on the
default profile. If `attach` fails, say this verbatim. The default call with no
`mode` always works without it.

**`builder` specifics:**

- 401 → authenticate first (`authenticate_builder` in old-devtools mode, the
  native `authenticate` flow in Builder mode), then retry.
- `orgId` may be omitted: it auto-resolves when the account has exactly one org,
  otherwise comes back `needsChoice` with an `organizations` list — **ask the
  developer which one**, don't guess or take the first.
- **Geolocation is optional.** Omitting `countryCode` returns `needsChoice` with
  a `suggestedCountryCode` (the developer's own country, from their public IP)
  and costs nothing — no browser is allocated. Offer the developer three things:
  the suggested country, a country the site must be seen from, or skipping geo
  entirely (`skipCountry: true`, the deployment's default egress). The country
  is **fixed for the session's lifetime** and can't be changed after allocation.
  If the deployment has no proxy configured the browser is still allocated, just
  without the requested country.
- Costs one VERIFICATION-pool use under the org's normal plan restrictions.
- Return the FULL `liveViewUrl` to the developer **verbatim, on its own line** —
  never abbreviated, elided, or wrapped in prose that truncates it.
- Close it when the work is done (`dispose_browser`) so the quota isn't wasted —
  but only after the developer confirms, never unprompted.

**`custom` specifics:** the `cdpUrl` is a credential — never repeat, log, or
persist it. If a `liveViewUrl` comes back, share it full and verbatim.

### Sharing the container's live view (`share_browser_view`)

A `container` browser serves its own viewer on loopback, so the developer can
open it the moment `attach_browser` returns. `share_browser_view` puts that same
viewer behind a public HTTPS URL through a cloudflared quick tunnel that you
run — for when the person who has to act is not at that machine: a login or 2FA only they can
complete, or a colleague watching a capture.

**Offer it whenever a login is coming and the developer is not the one holding
the credentials.** Nobody asks for a feature they have no way of knowing exists.
Ask plainly:

> Do you want a link to this browser? You can open it yourself, or send it to
> whoever holds the login — they can watch and click in it, including from a
> phone.

If they say yes:

1. Call `share_browser_view` with no arguments. It returns the viewer `port`
   and the `command` (`cloudflared tunnel --url http://localhost:<port>`). The
   MCP server does not run cloudflared.
2. Ask the developer to choose, and start no tunnel until they answer:
   - **They run it (recommended).** They run `! <command>` in this session and
     paste the `https://<words>.trycloudflare.com` URL. The tunnel then lives
     in their shell, and they decide when it closes.
   - **You run it.** They approve you running `command` in the background. If
     `cloudflared` is not installed, ask them to install it; do not install it
     without their approval.
3. When you run it, read its output for the URL. Never guess or reconstruct the
   hostname.
4. Call `share_browser_view({ publicUrl })` with that URL. **Relay the returned
   `url` verbatim, on its own line.** It includes `liveview.html?magnify=1`.

- **`container` is the only mode this applies to.** `builder` returns a hosted
  `liveViewUrl` from `attach_browser` — relay that instead, full and verbatim.
  `dedicated`, `attach`, and `custom` have no view to share at all. If the
  developer asks to let someone else in, re-attach with `mode: "container"`.
- **The URL is the ONLY credential.** The hostname Cloudflare hands out is the
  whole secret: there is no token and no login behind it, so whoever learns the
  URL has the browser, as the signed-in user. Give it to one person, say plainly
  what it grants, and stop the share when they are done rather than leaving it
  open. Tell them the watcher sees everything typed into that browser, including
  a password — so if the point is for the DEVELOPER to log in, they should do it
  before you share, not after.
- **It shows the whole browser, not one tab.** A sign-in that opens a separate
  window is visible too.
- **Opening it on a phone lays the page out for that phone**, with touch,
  pinch-zoom and the soft keyboard. That is why `container` suits a site that
  only works on mobile, when the developer asks for it.
- **Stop a cloudflared process you started as soon as they're done.** If they
  started it, tell them to stop it. The browser keeps running. `dispose_browser` and `reset_session` stop the
  container itself, but not your cloudflared process.
- **Expose only the viewer port** that `share_browser_view` returns, never the
  browser's CDP port.

### How containers are shared, and when they close

- **Closing the agent releases the browser.** The server stops the container
  when its connection drops. `dispose_browser` does the same on demand.
- **Re-attaching in one session reuses the same browser** — under a second,
  rather than the twenty a fresh one costs — so whatever it is signed into is
  still there.
- **A second session working at the same time gets its own container.** They
  cannot share one: the live view streams the whole screen, so two sessions in
  one container would see each other's browsing, and two browsers on one profile
  corrupt the cookie jar they share. Each concurrent session therefore has its
  own profile, and starts out signed in to nothing.
- **Four at once is the ceiling**, because each is about 2 GB of RAM. Past that,
  `attach_browser` says so and points at `dedicated`.
- **A crash cannot strand one for long.** A killed session runs no normal
  cleanup, so the next `container` attach removes any container whose owning
  process is gone. Resources belonging to a live session are
  never touched.

### When the container will not start

- **Docker is not running.** The error says so and names the other browser
  modes. Docker is not something you can install for them.
- **Apple Silicon.** The image is amd64 and cannot be built for arm64, so it
  runs translated. OrbStack does this itself; Docker Desktop needs "Use Rosetta
  for x86/amd64 emulation" turned on. Under QEMU instead of Rosetta, Chromium
  crashes on launch.
- **First run looks stuck.** It is downloading the browser image. Say that
  rather than letting it look hung.
- A container left over from a crashed run is **reused if it is still serving**,
  and replaced if it is not — a second attach does not need a different port.

**When the default local launch fails**, the error names the reason. Act on
it rather than switching modes:

- **No display** (Linux, neither `WAYLAND_DISPLAY` nor `DISPLAY` set). The MCP
  server was started outside the desktop session. Ask the developer to add the
  variable to the MCP server's environment (for example `DISPLAY=:0`, or
  `WAYLAND_DISPLAY=wayland-0` with `XDG_RUNTIME_DIR`) and restart the agent.
- **Exited with code N**, followed by the browser's own stderr. Read the
  stderr: it usually names the cause (a missing library, a sandbox error).
  Chrome for Testing was already tried as a fallback when the error mentions
  it.
- **Profile in use by a running browser (PID N).** A browser on
  `~/.reclaim/chrome-profile` is open without the debugging port. Ask the
  developer to close that window, then retry. Stale locks left by a crashed
  browser are cleared automatically.
- **Did not answer CDP within 30000ms.** Retry once; a first start on a slow
  disk can be slow. If it repeats, quote the stderr in the error.
- **Wrong browser picked.** Set `RECLAIM_AGENT_CHROME_PATH` to the binary — on
  Windows `setx RECLAIM_AGENT_CHROME_PATH "C:\path\to\chrome.exe"` (`setx`, not
  `$env:`, so future shells inherit it); on macOS/Linux `export` it. **Then
  fully restart the agent** — MCP servers snapshot env vars at launch.
- **Pre-existing `chrome.exe` hijacks the launch (Windows).** A new launch with
  `--remote-debugging-port` gets delegated to the running process group and the
  port silently never opens. `taskkill /F /IM chrome.exe`, then retry.

<!-- section: login-detect -->
**Check login state, wait if needed.** `eval_in_page(captureId, ...)` with a
site-specific check.

**Combine a positive signal (element present only when logged in) with a
negative one (login button absent), AND them together.** Single signals are too
prone to false positives — `<meta>` tags in particular exist on every page
regardless of login state; only their `.content` is populated, so
`!!document.querySelector('meta[name="user-login"]')` is true when logged out.
Never use existence-only checks on meta tags or other persistent-but-empty
elements.

- GitHub: `(document.querySelector('meta[name="user-login"]')?.content?.length || 0) > 0 && !document.querySelector('a.HeaderMenu-link[href="/login"]')`
- X / Twitter: `!!document.querySelector('[data-testid="AppTabBar_Profile_Link"]') && !document.querySelector('[data-testid="loginButton"]')`
- Generic: `<logged-in-only-element> && !<logged-out-only-element>`

Truthy → move on. Falsy → **navigate to the login URL yourself** so the
developer lands on the form (`https://<host>/login`, `/signin`,
`https://<host>/i/flow/login` for X). Tell them once: _"I've opened the login
page on `<site>` — please log in (2FA included). I'll detect when you're
done."_ Then `wait_for_page(captureId, expression="<same expression>",
timeoutMs=180000)`; it polls every second. **Never** say "tell me when you're
done" — wait with the tool.

**Self-check:** if your detector says "already logged in" on a freshly launched
dedicated profile, the detector is wrong — a new profile has an empty cookie
jar. Rewrite the expression.

<!-- section: identify-value -->
**Identify the value from the DOM.** `eval_in_page` to read what's displayed
(for example, the username from `meta[name="user-login"]`'s `content`).
Unambiguous → proceed silently. Only ask the developer when there are genuinely
multiple readings (the page shows both "John Doe" and "@jdoe" and you must pick
one).

<!-- section: find-request -->
**Find the request.** `find_requests_containing(captureId, value)`. For each top
candidate (≤5) call `analyze_request_constraints` and surface its `concerns` to
the developer **verbatim** — don't paraphrase or omit; they're the developer's
signal that a provider is worth pursuing. Skip candidates flagged
`signedRequest` or `botChallenge` unless nothing else exists; `csrfDependency`,
`shortLivedToken` and `graphql` are informational — surface and proceed.

**Strongly prefer authenticated, user-specific endpoints over public pages.** A
proof against `https://github.com/<username>` attests only "this URL returned
this value at this time" — anyone could produce it, so it says nothing about who
the prover is. Rank candidates that:

- carry `Cookie`, `Authorization`, or other secret headers;
- have auth-shaped paths (`/me`, `/user`, `/settings`, `/api/...`, a `viewer`
  GraphQL query);
- return JSON keyed to the developer's identity (login/username/id next to the
  value).

If every candidate is a public HTML page, tell the developer: _"The value
appears on a public page, so a proof against this endpoint won't bind to your
identity — anyone could prove the same fact. I can still build it if you only
want to attest the value, but an identity-bound proof needs an authenticated
request. Keep digging, or proceed anyway?"_ Then wait for their call.

<!-- section: oprf -->
**Decide whether to OPRF the value** (privacy from the attestor) before calling
`propose_provider`:

- **No hash** (default) — value travels in `paramValues` + `{{name}}`; the
  attestor sees the cleartext substring. Right for non-sensitive values (public
  IPs, public usernames, public repo names).
- **`oprf-raw`** — server-side OPRF. **The only variant that runs on Windows /
  without external deps.** Weakest privacy of the three (the attestor still
  participates) — say so honestly.
- **`oprf`** — client-side ZK OPRF using gnark. Strongest. Needs a gnark install
  (Linux/macOS in practice). Don't suggest it on Windows.
- **`oprf-mpc`** — TEE-based MPC. Niche; only if the developer raises it.

**Skip the question** when the value is clearly non-sensitive, and default to
no hash. When it is or could be sensitive (email, real name, private id —
anything the developer wouldn't post publicly), put the four options to them.

**Hard limits:**

1. OPRF-hashed values cap at **62 bytes**. Longer → propose a tighter `target`
   (for example, only the email local-part) or no hash.
2. **OPRF and the request URL are mutually exclusive for the same value.** Any
   value templated into the request URL is signed into the attestor's context in
   the clear regardless of hashing, so hashing it doesn't just fail to help — it
   doesn't verify. If the target's value also appears in the captured URL, drop
   `hash` or capture a request whose URL doesn't carry it.
3. Never pass `hash` for a free-form target (unicode / spaces / punctuation).

**Disambiguate repeated JSON values.** `propose_provider` rejects a target
found at multiple JSON paths instead of guessing which field the user meant.
Choose a target that identifies one field.

`propose_provider` throws a clean error on all three — retrying the same call
won't help.

<!-- section: rewrite-shape-block -->
   **Do NOT rewrite the shape.** The synthesizer's output IS the canonical
   Reclaim shape — `contains` template + paramValues + xPath/jsonPath redaction
   (+ regex/hash). Specifically:

   - Don't replace the `contains` template with a hand-written regex.
   - Don't hand-write a named-capture regex unless `hash` was requested AND the
     synthesizer didn't already emit one (it does, for any digit/slug/email
     target).
   - Don't remove `paramValues` — that's how the template resolves at proof
     time.
   - The redaction's xPath/jsonPath is what the prover *reveals*; the match's
     template is what the attestor *verifies* post-substitution. Different
     jobs — don't conflate them.
   - Don't prefix the match template's param with `%CTX%` — that namespace is
     for consumer-supplied URL/body params only. Match templates are extraction
     params and stay bare.

   Permitted edits: narrowing the `contains` template, a more distinctive
   xPath class/id when the synthesizer's pick is too generic, fixing `name`,
   adding/removing secret headers. Make matcher edits with `update_draft`
   (never by importing the agent's internals), then confirm them offline with
   `check_matchers`, which runs the attestor's own redaction and match engine
   on the captured response. Tempted to rewrite from scratch? Call
   `propose_provider` again with different inputs instead.

   If `propose_provider` says the value has no key name next to it, or that
   the window holds a number or a neighbouring value, the request can't give
   a portable matcher (typical of SvelteKit `__data.json` positional arrays).
   Pick the HTML page or another JSON API where the value sits under its own
   key.

<!-- section: secrets -->
### Protect secret values

**Marking a value secret.** Name ANY param with `SECRET` anywhere in the key
(case-insensitive) — a bare `{{SECRET_x}}` as much as a consumer-supplied
`{{%CTX%SECRET_apiKey}}` — and it routes to `secretParams.paramValues`
(`classifyParamName`/`splitSecretParamValues`), the same convention
`reclaim-inapp-sdk`/`reclaim-portal` use. **A secret param's value never appears
in the final proof.**

**Headers work by the OPPOSITE rule — an allowlist, not a name check.** Any
header not on a small fixed public list (`user-agent`, `accept`,
`accept-language`, `accept-encoding`, `sec-fetch-*`, `origin`,
`x-requested-with`, `sec-ch-ua*`) is secret by default, including
`Cookie`/`Authorization` and anything custom (`classifyHeader`/`splitSecrets`).

**The URL character budget.** A secret value CAN be used in the URL,
`geoLocation`, body, matches and redactions — write-redaction genuinely hides
it. But in the URL it only holds up to a small **TOTAL** budget summed across
every secret value in that URL (`secretUrlCharBudget`), not a per-value
allowance: **2 characters under `key-update`** (the default), **12 under `zk`**.
Over budget the value is effectively visible to the attestor no matter how it's
marked, and claim creation fails outright. Since the real value doesn't exist
until a verification session supplies one, this is checked at **verification**
time (`assertSecretParamValuesFitUrlBudget`), not publish time — except for a
captured secret *header* whose value also sits in the URL, which is already
known and so gets checked at draft time (`assertNoSecretUrlConflict`).

<!-- section: no-rename-param -->
### Hide internal fields from claimant UI

**Keep internal claim-construction fields out of claimant-facing UI.** When a
named regex group or `{{parameter}}` only helps construct another claim request,
consider an internal prefix:

- `REQ_` for request/body/header or other intermediate values.
- `URL_` for URL path/query values.

Builder data-point and SEO/catalog surfaces, and compatible claimant UIs, omit
these names case-insensitively. The prefix is presentation metadata, not a
security boundary: the exact parameter remains in the recipe, proof, and
proof-time substitution maps. Keep the same full name everywhere it is
referenced: the named group, template, and `paramValues`; for an
`allowedJsRequests` template, also use it in `templateParams`. With
`propose_provider`, pass the prefixed target name and `shortenNames: false`;
otherwise name shortening drops the prefix. Don't prefix an actual
consumer-facing result merely to conceal it.

**Do not rename the match-template param.** The synthesizer's `{{name}}` in
`responseMatches[].value` is an _extraction_ template — it stays bare and never
takes the `%CTX%` prefix. Only URL/body placeholders whose values the consumer
supplies are context params.

<!-- section: prove-tail -->
    **On any `verified: false` the result includes, inline:** `error` (the SDK's
    thrown message verbatim) and `sentParams` (the exact `params` the SDK saw,
    post-substitution — this is where you spot mutation surprises).

    **The attestor is reliable. If it errors, the cause is the provider, the
    network, or prover-side code — not "the attestor can't handle this site".**
    Do not invent failure modes like "the HTML is too large", "TLS records are
    chunked", "it matches against gzipped bytes" (it doesn't —
    `propose_provider` always sets `Accept-Encoding: identity`), or "xPath
    doesn't work on this DOM". They're wrong and they waste the developer's
    time. Instead: (1) show `error` verbatim; (2) if `sentParams` differs from
    what you expected, surface that; (3) only then hypothesize, tied to that
    evidence.

    **Deeper tracing (opt-in).** With `RECLAIM_AGENT_TRACE=1` in the MCP
    server's env, `run_proof` also captures the SDK's full pino stream into
    `result.attestorLogs` and dumps `~/.reclaim/proof-runs/<timestamp>.json`
    (`runLogPath`). Off by default — suggest it for a recurring failure.

    **Network errors** ("connection closed", `ERROR_NETWORK_ERROR`, timeouts):
    read the result's `diagnosis`. It says whether the attestor is reachable
    from this machine. If it is, the target site likely blocks the attestor's
    network; in builder mode, run `run_proof_via_pod`. If it is not, call
    `check_attestor` after the developer fixes their network. Do not loop
    retries; one `run_proof` per change.

    **Blocked non-browser clients** (`diagnosis.kind` is
    `blocked-non-browser-client`: HTTP 403/406/429/503 or a challenge page,
    often after `replay_request` succeeded): the site blocks clients that
    aren't a real browser (bot protection or TLS fingerprint). Copying
    headers or cookies won't help, and `run_proof_via_pod` doesn't change the
    TLS fingerprint. Run `check_matchers` first so a recipe bug isn't
    mistaken for blocking, then try ONE other endpoint that returns the value
    (a JSON API the page calls). Blocked there too → publish from the
    capture, below.

    **Replay or proof keeps returning 403 (or another block): publish from
    the capture.** A 403 from `replay_request` or `run_proof` says the site
    defends against the authoring path. It does not say the recipe is wrong,
    and a real verification runs inside the end user's own browser session,
    which those defenses usually let through. Retry budget: one retry of the
    same call, one correction (another endpoint, a `geoLocation` pin, or a
    matcher fix via `check_matchers`), and one retry after the correction.
    Past that, STOP. Don't re-capture, re-propose, or re-prove the same
    request, and don't wait for the developer to tell you to stop. Instead:

    1. Say plainly that replay/proof is blocked and that you are publishing
       the version UNPROVEN, from the request you intercepted. Never say it
       was proven.
    2. Publish the draft as topic `publish` says
       (`create_provider_version_from_capture`, then go live). The draft
       holds the intercepted request, selectors, and params; that is all the
       version needs.
    3. Ask the developer to try it with a real verification. Builder mode:
       `create_verification_session` and put its URL in the message. Legacy
       devtools mode: the "try it" option in topic `publish`. End your turn
       there.
    4. When they return, check the session the usual way
       (`get_verification_session` / `list_verification_events`, or the
       devtools equivalent). Passed → done; it was only the authoring path
       that was blocked. Failed with the same block → the site blocks
       verification too; say so and look for a different endpoint.

    **Do not auto-retry with a different `attestorUrl`.** There is one live
    public attestor; backup hostnames (`attestor-2.*`, and so on) **do not
    exist**. `attestorUrl` is only for a developer-supplied private/staging URL.

    **"ZK circuit resources are missing"** (points at a `circuit.wasm` path) —
    the npm postinstall didn't run (`--ignore-scripts`, or corp policy). Tell
    the developer to run `npm run download:zk-files` from the project root and
    retry `run_proof`. No re-capture, no server restart.

<!-- section: never-do-common -->
- Never echo a raw `Authorization`, `Cookie`, or `X-*-Token` value back to the
  developer or write one to a file. `list_requests`,
  `find_requests_containing`, `propose_provider` and every draft/replay/proof
  result are secret-free by construction. `get_request` is the one exception —
  it returns the request's RAW headers so you can inspect them. Read them,
  never repeat them.
- Never call `run_proof` before `replay_request` succeeds. Attestor calls are
  expensive.
- Never loop a blocked replay or proof. A 403 that survives the retry budget
  in `prove` means publish from the capture, unproven, and hand the developer
  a real verification to try.
- Never pretend a proof succeeded when `verified: false`. Show the error and
  iterate.
- Never write a literal value into `responseMatches.value` — that bakes the
  original user into the provider. The synthesizer always emits `{{name}}` +
  paramValues.
- **Never hand-craft `responseMatches`/`responseRedactions`.** Typing a regex by
  hand, writing `(?<name>...)` by hand, or copying the captured value into the
  match — all stop signs. And never accept "the xPath looks too narrow, let me
  write a regex": the synthesizer already pairs the anchor with a
  structure-anchored named-capture regex. If extraction looks wrong, re-run
  `propose_provider` with a better request/target. The permitted narrowing
  edits go through `update_draft` and `check_matchers`.
- Never rename or `%CTX%`-prefix the match-template param (see `params`).

<!-- section: credentials -->
## Signing credential for the proof

`run_proof` signs the claim with the eth proof-owner key. It resolves the key
itself (`RECLAIM_PRIVATE_KEY` env → a `RECLAIM_PRIVATE_KEY=0x…` line in the
project `.env` → a file at `RECLAIM_PRIVATE_KEY_FILE`); the private key never
enters the conversation. Don't pass `ownerAddress` and don't ask the developer
for a key.

1. **No key yet:** `run_proof` (or `resolve_owner_key`) creates a local test
   key in the project `.env` (mode 0600, added to `.gitignore`) and returns
   `source: "generated"` with a `note`. Tell the developer once, after the
   fact, that you created a local test signing key. Don't ask for approval:
   owner identity doesn't matter for test proofs.
2. **Developer wants their own key:** only when they say so,
   `import_credentials({ keyFile })` (a path to a file holding the key; never
   ask them to paste it).
3. Fully local — no network, no registration. The key is read live from `.env`
   on every `run_proof`, so **no restart** is needed after importing, and the
   existing draftId stays valid.

- **Advanced:** `RECLAIM_PRIVATE_KEY` in the MCP server env works too, but env
  vars are snapshotted at Claude Code startup — that route needs a full restart,
  which invalidates every draftId. Prefer the `.env` flow.
- **Multiple MCP config files exist on Windows.** `~/.claude.json` takes
  precedence over `~/.claude/mcp.json`. Point developers at `claude mcp list` /
  `claude mcp add --scope user` rather than hand-editing JSON.
