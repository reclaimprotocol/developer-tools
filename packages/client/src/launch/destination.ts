/**
 * Rebuilds the real, openable destination URL for a parsed flow.
 *
 * Since migration `20260917130000000.share-routes-uris.sql`, every built-in
 * client's registered uri is itself a real, openable Builder page (`/share/
 * {name}` — see `builtin-clients.ts` and `SharePage.tsx`), including
 * `portals`, which used to be an attribution-only label Builder served
 * nothing at. That does NOT mean this file's job shrinks to "pass every
 * target through unchanged": which side rewrites is decided per target by
 * who is able to honour an override and who has to keep working against a
 * pre-migration deployment, not by whether Builder happens to have a page
 * there today.
 *
 *   - `builder`: registered uri (`/v/{sessionId}` pre-migration, `/share/
 *     builder` post-migration) is always real and there is no override to
 *     express — Builder's own route owns any redirecting (`/share/builder`
 *     302s to `/v/{sessionId}` server-side). This file never rewrites it.
 *   - `portals`: this file keeps rewriting to `options.portalUrl ??
 *     DEFAULT_PORTAL_URL`, unconditionally, even though `/share/portals` now
 *     redirects there too. Two reasons it can't defer to Builder's hop: (1) a
 *     pre-migration `/portals` uri is still a bare label Builder serves
 *     nothing at, so passing it through would 404; (2) `options.portalUrl` is
 *     an override Builder's fixed server-side redirect has no way to honour.
 *     `DEFAULT_PORTAL_URL` here and `SharePage.tsx`'s redirect default are
 *     deliberately kept identical, so the common (no-override) case reaches
 *     the same destination either hop — Builder's `/share/portals` hop is
 *     what makes a *pasted* link (opened without this SDK) still work.
 *   - `verifier-app`: registered uri (`/s` or `/share/verifier-app`, both
 *     real) is the share link itself, so this file passes it through unless
 *     `options.appLinkBaseUrl` overrides it — same shape of reasoning as
 *     `portals`, just already correct before this migration.
 *   - `reclaim-browser-extension`: has no destination URL at all — the
 *     mechanism is a `postMessage` handoff, not a navigation (see
 *     ./extension.ts) — so `getUrl()` on that target, like an unrecognised
 *     path, returns the original `verificationUrl` unchanged regardless of
 *     which shape registered it.
 */
import { stripTrailingSlashes } from '../encoding.ts'
import type { ParsedFlowUrl, VerificationTarget } from './target.ts'

export interface DestinationOptions {
	portalUrl?: string
	appLinkBaseUrl?: string
}

export const DEFAULT_PORTAL_URL = 'https://portal.reclaimprotocol.org'
/** The legacy share page. No longer a default — `verifier-app` sessions now
 *  carry a real Builder share URL — but kept as the value a deployment still
 *  pointing at `share.reclaimprotocol.org` would pass as `appLinkBaseUrl`. */
export const LEGACY_APP_LINK_BASE_URL
	= 'https://share.reclaimprotocol.org/verify'

/** Copies `api`/`sessionId`/`diag` onto `base`, preserving any query
 *  parameters `base` already carries (e.g. an App Clip's `?p=`). */
export function appendSessionQuery(
	base: string,
	parsed: Pick<ParsedFlowUrl, 'sessionId' | 'diag'>,
): string {
	const url = new URL(base)
	url.searchParams.set('api', '2')
	if(parsed.sessionId) {
		url.searchParams.set('sessionId', parsed.sessionId)
	}

	if(parsed.diag) {
		url.searchParams.set('diag', '1')
	}

	return url.toString()
}

function withoutTrailingSlash(value: string): string {
	return stripTrailingSlashes(value)
}

export function resolveDestinationUrl(
	target: VerificationTarget | undefined,
	parsed: ParsedFlowUrl,
	options: DestinationOptions,
): string {
	switch (target) {
		case 'builder':
			return parsed.url.toString()
		case 'portals': {
			// Always rewritten here, even now that `/share/portals` also
			// redirects server-side — see the file header for why this file,
			// not Builder's route, has to own it.
			const base = options.portalUrl ?? DEFAULT_PORTAL_URL
			return appendSessionQuery(`${withoutTrailingSlash(base)}/verify`, parsed)
		}

		case 'verifier-app': {
			// The registered uri for `verifier-app` is Builder's own share page
			// (`GET /s`), a real openable URL — so the verificationUrl already
			// IS the share link, and rewriting it onto another origin would
			// throw away the app-link association that makes a scan open the
			// app (`build.reclaimprotocol.org` is what the app's entitlements
			// and assetlinks now claim).
			//
			// `appLinkBaseUrl` stays as the override for a deployment that
			// hosts its own share page, or one still pointing at the legacy
			// `share.reclaimprotocol.org/verify`.
			const base = options.appLinkBaseUrl
			return base ? appendSessionQuery(base, parsed) : parsed.url.toString()
		}

		case 'reclaim-browser-extension':
		case undefined:
			return parsed.url.toString()
	}
}
