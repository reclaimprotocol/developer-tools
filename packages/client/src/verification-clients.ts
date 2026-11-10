import { DEFAULT_BASE_URL } from './consts.ts'

/**
 * Production Verification Client URLs. Use `custom(uri)` for a separately
 * registered client or a non-production Builder deployment.
 *
 * Builder resolves a session's `verificationClientUrl` by EXACT string match
 * against the registered `uri` and 400s for anything unregistered — these
 * constants MUST match Builder's built-in client registry exactly, or a
 * consumer passing one of these gets a failed session creation instead of a
 * warning (see
 * `tests/verification-clients.test.ts`, which pins all six against that
 * registry).
 *
 * As of migration `20260917130000000.share-routes-uris.sql`, all six
 * built-ins (`builder` included) share one uniform shape,
 * `{origin}/share/{name}` — what each `/share/{name}` page actually does
 * differs (a redirect for `builder`/`portals`, the QR/App-Clip/deep-link
 * launcher for `verifier-app`/`reclaimBrowserExtension`, a static
 * informational page for `inAppSdk`/`zkFetch`), but the registry entry is
 * uniform. `../launch/target.ts`'s `parseFlowUrl` is what turns one of these
 * back into a client.
 */
export const VerificationClient = Object.freeze({
	builder: `${DEFAULT_BASE_URL}/share/builder`,
	portals: `${DEFAULT_BASE_URL}/share/portals`,
	verifierApp: `${DEFAULT_BASE_URL}/share/verifier-app`,
	inAppSdk: `${DEFAULT_BASE_URL}/share/inapp-sdk`,
	reclaimBrowserExtension:
		`${DEFAULT_BASE_URL}/share/reclaim-browser-extension`,
	zkFetch: `${DEFAULT_BASE_URL}/share/zkfetch`,
	custom(uri: string) {
		return uri
	},
})
