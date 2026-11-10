/**
 * Short field hints for the user-script inputs on both publish tools
 * (`webSettings.jsUserScripts` on the builder, `customInjection` on
 * old-devtools).
 *
 * These used to inline the whole `skill/injection-api.md` guide (~22 KB) into
 * the tool's input schema. That guide is needed by a small minority of
 * providers, but an input-schema description is sent to the model on EVERY
 * request — it was roughly half the old-devtools tool surface on its own. The
 * prose now lives in `skill/user-script.md`, `skill/interception.md` and
 * `skill/hash-validation.md`, served on demand as `how_it_works` topics; what
 * stays here is the pointer plus the one warning that must be seen BEFORE the
 * field is filled in, since acting on it wrongly is worse than not acting.
 *
 * Shared by both publish tools so the two can't drift apart.
 */

/** Auth behavior shared by intercepted and script-requested claims. */
export const COOKIE_ATTACHMENT_HINT =
	'For an intercepted request or window.Reclaim.requestClaim, the verification '
	+ 'client automatically attaches cookies applicable to the request URL to '
	+ 'the claim sent to the attestor. Do not read, hardcode, or copy Cookie '
	+ 'values into the script or public params. '

/** What the script is and where the real guidance lives. */
export const USER_SCRIPT_HINT =
	'Plain JavaScript injected into the provider page before every page load. '
	+ 'Use standard browser APIs (window.location, element.click(), forms) to '
	+ 'drive login/navigation so the target request fires — the client already '
	+ 'intercepts page requests, and window.Reclaim is only for rare edge cases, '
	+ 'not navigation. ' + COOKIE_ATTACHMENT_HINT
	+ 'Full guide: how_it_works({ topic: "user-script" }).'

/** Prefixes the `allowedJsRequests` / `allowedInjectedRequestData` field. The
 *  trap it describes is silent and total — a mis-declared entry makes
 *  `verifyRequestProof({ providerId })` reject EVERY real proof — so the
 *  warning itself stays in the schema even though its explanation moved to a
 *  topic. */
export const ALLOWED_REQUESTS_HINT =
	'⚠️ Only populate this if you intend to gate '
	+ '`verifyRequestProof(proof, { providerId })`: each entry feeds a '
	+ 'client-side hash-equality check and its `url` is hashed VERBATIM (no '
	+ 'regex/template resolution, even with urlType REGEX/TEMPLATE). If the '
	+ 'real captured URL carries ANY per-session part (nonce, CSRF token, '
	+ 'cache-busting timestamp), no declared spec can ever hash-match a real '
	+ 'proof — populating it then makes verifyRequestProof reject every real '
	+ 'proof, which is worse than leaving it empty. Diff the same endpoint\'s '
	+ 'captured URL across two sessions first. Mechanics, the '
	+ 'body-templating rules and the '
	+ 'dangerouslyDisableContentValidation fallback: '
	+ 'how_it_works({ topic: "hash-validation" }).'
