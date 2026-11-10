/**
 * Which client a `verificationUrl` names, and what a caller-supplied
 * `verificationClientId` escape hatch can override.
 *
 * Builder's verification URL builder appends
 * `?api=2&sessionId=<uuid>` (plus optional `&diag=1`) to the registered
 * client's base URL, so parsing the path is enough to name the client — the
 * registered URI is an attribution label, never the URL to open (see
 * ./destination.ts for what actually gets opened).
 *
 * As of migration `20260917130000000.share-routes-uris.sql`, every built-in
 * client (`builder` included) registers at the uniform `{origin}/share/
 * {name}` shape. Only four of
 * the six names are launchable targets here — `inapp-sdk` and `zkfetch` have
 * no claimant browser flow, so `/share/inapp-sdk` and `/share/zkfetch`
 * degrade the same as the old bare `/zkfetch` label always did.
 *
 * The pre-migration shapes — `/portals`, `/s` / `/verifier-app`,
 * `/reclaim-browser-extension`, and `builder`'s own `/v/{id}` — are kept
 * recognised too, deliberately, not just for a transition window:
 *   - a deployment that has not yet run that migration still seeds and
 *     serves the old uris, so dropping them would break every consumer
 *     hitting an un-migrated Builder;
 *   - `register_verification_client`'s seed upsert COALESCEs `uri` and never
 *     clobbers a non-null value, so an admin who set a custom (old-shape)
 *     uri before the migration keeps it forever — there is no future point
 *     at which the old shapes stop appearing in the wild;
 *   - `builder`'s own `/share/builder` route 302s to `/v/{sessionId}`
 *     server-side (see SharePage.tsx) — `/v/{id}` is where a claimant
 *     *actually lands* regardless of which shape the session was created
 *     against, so it must stay recognised independent of the migration
 *     question entirely.
 * There is no ambiguity cost to recognising both: the shapes are disjoint
 * path segments, so a URL can only ever match one.
 */

export type VerificationTarget =
	| 'builder'
	| 'portals'
	| 'verifier-app'
	| 'reclaim-browser-extension'

/**
 * Fixed, deployment-independent ids for the built-in clients — duplicated
 * from Builder's built-in client registry
 * (also duplicated in the in-app SDK and the browser
 * extension SDK). Changing one copy alone breaks every other caller.
 *
 * Used only as the `options.verificationClientId` escape hatch: when a
 * staff-registered custom client's URL doesn't match the path convention
 * above (an admin-overridden `uri`, or a fresh custom registration that was
 * nonetheless assigned one of these fixed ids), a caller who knows the id
 * out of band can still get the right launch mechanism instead of degrading
 * to a tab. This is unrelated to — and does not feed — the extension
 * handoff payload, which never carries a client id at all (see
 * ./extension.ts).
 */
const BUILTIN_CLIENT_IDS: Record<VerificationTarget, string> = {
	builder: '00000000-0000-4000-8000-000000000001',
	'verifier-app': '00000000-0000-4000-8000-000000000002',
	portals: '00000000-0000-4000-8000-000000000004',
	'reclaim-browser-extension': '00000000-0000-4000-8000-000000000005',
}

export interface ParsedFlowUrl {
	url: URL
	target: VerificationTarget | undefined
	sessionId: string | undefined
	diag: boolean
}

/** Parses a `verificationUrl` into its client and session id, without
 *  rebuilding anything — see `./destination.ts` for the openable URL. */
export function parseFlowUrl(
	verificationUrl: string,
	verificationClientId?: string,
): ParsedFlowUrl {
	const url = new URL(verificationUrl)
	const segments = url.pathname.split('/').filter(Boolean)

	let target: VerificationTarget | undefined
	if(segments[0] === 'v' && segments.length >= 2) {
		// Both a pre-migration `builder` uri (registered directly at
		// `/v/{sessionId}`) and where a claimant's browser actually lands after
		// `/share/builder`'s server-side 302 — recognised unconditionally, not
		// merely as one of the two shapes below.
		target = 'builder'
	} else if(segments[0] === 'share' && segments.length >= 2) {
		target = targetForShareName(segments[1])
	} else if(segments[0] === 'portals') {
		target = 'portals'
	} else if(segments[0] === 's' || segments[0] === 'verifier-app') {
		// `/s` is Builder's own share page and the uri `verifier-app` is
		// registered at today; `/verifier-app` is the attribution-only label it
		// used to carry, still recognised for a deployment that has not run the
		// re-pointing migration (or whose admin kept the old uri).
		target = 'verifier-app'
	} else if(segments[0] === 'reclaim-browser-extension') {
		target = 'reclaim-browser-extension'
	}

	// Falls back for EITHER an unrecognised path (old shape or new) or a
	// `/share/{name}` naming a non-launchable client (`inapp-sdk`/`zkfetch`) —
	// `targetForShareName` returning `undefined` for those must still let this
	// run, not short-circuit it.
	if(!target && verificationClientId) {
		target = targetForClientId(verificationClientId)
	}

	return {
		url,
		target,
		sessionId: url.searchParams.get('sessionId')?.trim() || undefined,
		diag: url.searchParams.get('diag') === '1',
	}
}

/** The four launchable targets' `/share/{name}` segment, post-migration —
 *  see `builtin-clients.ts`'s `clientUrl()`. `inapp-sdk` and `zkfetch` get a
 *  real `/share/{name}` page too (so a stray GET doesn't 404), but neither
 *  has a claimant browser flow, so they degrade like the old bare `/zkfetch`
 *  label always did. */
function targetForShareName(name: string): VerificationTarget | undefined {
	switch (name) {
		case 'builder':
		case 'portals':
		case 'verifier-app':
		case 'reclaim-browser-extension':
			return name
		default:
			return undefined
	}
}

function targetForClientId(
	verificationClientId: string,
): VerificationTarget | undefined {
	const normalized = verificationClientId.trim().toLowerCase()
	for(const [target, id] of Object.entries(BUILTIN_CLIENT_IDS)) {
		if(id === normalized) {
			// The key side of `Object.entries` on
			// `Record<VerificationTarget, string>` is exactly
			// `VerificationTarget`; TS widens it to `string` on the way out.
			return target as VerificationTarget
		}
	}

	return undefined
}
