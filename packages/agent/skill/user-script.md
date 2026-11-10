# User scripts (`jsUserScripts` / `customInjection`)

A provider can inject **plain JavaScript** that runs in the page before every
page load. Builder stores it as `webSettings.jsUserScripts`; old-devtools stores
it as `customInjection`. The injection timing and purpose match; available
`window.Reclaim` bridge methods depend on the Verification Client.

## What the script is for

The verification client **already intercepts the page's network requests
automatically** — the script does not need to capture, forward, or "claim" them.
Its job is to get the page into the state where the target request happens,
using standard browser APIs:

- **Navigate** — `window.location.href = '…'`, `location.assign(…)`, the
  history API.
- **Interact** — select an element and `.click()` it, submit a form, dispatch
  events.
- **Wait** — poll the DOM until login/MFA completes or content loads, then
  trigger the next step.

Write it like any page script. It runs before every page load, so keep it
idempotent, cheap, and guarded against firing at the wrong time.

Both backends run it the same way: before every page load, including before the
first navigation to `initialUrl`/`loginUrl`.

## Support both authentication states

Design the script around the page's current state, not only around a login
event. A claimant can reach `initialUrl` in either state:

- **Signing in now:** wait through login and MFA, detect authenticated content,
  then navigate or interact until the target request fires.
- **Already signed in:** the login transition might never happen. Detect the
  authenticated UI or target content immediately and continue directly.

Keep the branches idempotent. Don't blindly send every claimant to the login
page: some sites leave an authenticated user on `/login` instead of redirecting
them, which can leave a script waiting forever for a navigation that never
happens. Navigate to the authenticated data page only after a positive login
signal, and avoid firing the same action again after the target state is
reached.

For an optional post-publish authenticated-state retest, follow topic `publish`.
Do not clear cookies or force another sign-in; inconclusive coverage must not
block publication. This browser check does not emulate a client-specific
interceptor.

## Write the navigation script first

Write the navigation script as soon as the developer is signed in, or as soon
as you know the sign-in page. Then capture through it, so authoring, testing,
and verification follow the same path.

The script does two things:

1. **Signed out:** send the user to the sign-in page.
2. **Signed in:** visit each page that holds a data point, in order. Data
   points can live on different pages. Keep a step index in `sessionStorage` so
   the script survives reloads and repeated runs.

Loop: `test_user_script({ script, keep: true })` → fix → retest. With `keep:
true` the script stays installed for every later navigation in the authoring
browser, as it does at verification. `create_provider_version_from_capture`
publishes it as `webSettings.jsUserScripts` unless you pass your own.

```js
(() => {
	const SIGN_IN = '/login'
	const STEPS = [
		{ path: '/account', ready: () => document.querySelector('#dob') },
		{ path: '/settings/profile', ready: () => document.querySelector('#plan') },
	]
	const signedIn = () => document.querySelector('[data-user-menu]')
		&& !document.querySelector('a[href="/login"]')
	let tries = 0
	const timer = setInterval(() => {
		if(++tries > 120) {
			return clearInterval(timer)
		}

		if(!signedIn()) {
			// stay put on the sign-in page; also covers unknown pages
			if(location.pathname !== SIGN_IN) {
				clearInterval(timer)
				location.assign(SIGN_IN)
			}

			return
		}

		const i = Number(sessionStorage.getItem('rc-step') || 0)
		const step = STEPS[i]
		if(!step) {
			return clearInterval(timer)
		}

		if(location.pathname !== step.path) {
			clearInterval(timer)
			return location.assign(step.path)
		}

		if(step.ready()) {
			sessionStorage.setItem('rc-step', String(i + 1))
		}
	}, 500)
})()
```

Adapt the selectors to the site. Each new tab starts at the first step, and a
reload resumes at the current step.

## `window.Reclaim` — rarely needed

`window.Reclaim` is an optional bridge for a handful of edge cases. Most
providers never touch it, and **it does not do navigation** — use the standard
browser APIs above for that.

The Builder verification client drains `window.Reclaim.requestClaim` through
CDP and uses the page-supplied request to generate the proof. It does not
authorize the request against `allowedJsRequests`; `verifyRequestProof`/
`verifyResultFull` validates the resulting proof's recipe hash. The built-in
client doesn't deliver traffic to
`reclaimInterceptor.addResponseMiddleware`, so response middleware remains
unavailable there. Prefer ordinary browser JavaScript and let the capture loop
find the request unless the provider explicitly needs `requestClaim`.

For both an automatically intercepted request and a direct
`window.Reclaim.requestClaim`, the Verification Client automatically attaches
cookies applicable to the request URL to the claim it sends to the attestor.
This includes cookies unavailable to page JavaScript when the client can access
them. Do not read cookies in the script or copy a `Cookie` value into public
parameters; the client supplies it as private claim input.

Don't reach for it by default. When an edge case genuinely requires it, consult
the [provider web-script API types](https://github.com/reclaimprotocol/provider-web-script-dev/blob/main/src/support/env.d.ts)
rather than guessing.

### Portal-only request APIs

The portal client also exposes two methods that the built-in Builder client,
in-app SDK, and browser extension do not:

- `Reclaim.refetch(request)` sends a bounded request through the portal worker.
- `Reclaim.browserRequest(actionId, input)` runs a declared same-origin action
  in an isolated page that shares the portal browser's cookie jar. Declare its
  action in `browserRequestActions` when creating the provider version. The
  declaration can set the isolated page's User-Agent or omit a fetch action's
  automatic Origin header when the target requires it.

Use them only when the provider is explicitly portal-only. For the current
client matrix, see `docs/verification-client-capabilities.md` in Builder.

## Declaring the requests the script fires

Requests the script triggers beyond the proven one (for example, pagination) are
declared as `allowedJsRequests` (Builder) / `allowedInjectedRequestData`
(old-devtools) for `verifyRequestProof`/`verifyResultFull`. They express the same
policy with different field names.

⚠️ **Before populating them to gate `verifyRequestProof(proof, { providerId })`**, read
topic `hash-validation` — the declared `url` is hashed VERBATIM, so a
session-unique URL there makes `verifyRequestProof` reject every real proof. Leaving
the field empty is better than populating it wrong.

## Related topics

- `interception` — `injectionType`/`interceptorType`, live interception, and the
  document-replay flag.
- `hash-validation` — `bodySniff`, and how `verifyRequestProof({ providerId })` gates
  on the provider's declared spec.
