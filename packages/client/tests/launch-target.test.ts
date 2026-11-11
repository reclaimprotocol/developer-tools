import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	appendSessionQuery,
	LEGACY_APP_LINK_BASE_URL,
	resolveDestinationUrl,
} from '../src/launch/destination.ts'
import { parseFlowUrl } from '../src/launch/target.ts'
import { VerificationClient } from '../src/verification-clients.ts'

const ORIGIN = 'https://build.reclaimprotocol.org'
const SESSION_ID = 's1'
const QUERY = `?api=2&sessionId=${SESSION_ID}`
const EXTENSION_BUILTIN_ID = '00000000-0000-4000-8000-000000000005'

describe('parseFlowUrl', () => {
	it('names `builder` from the /v/{id} path', () => {
		const parsed = parseFlowUrl(`${ORIGIN}/v/${SESSION_ID}${QUERY}`)
		assert.equal(parsed.target, 'builder')
		assert.equal(parsed.sessionId, SESSION_ID)
		assert.equal(parsed.diag, false)
	})

	it('names `portals` from the /portals path', () => {
		const parsed = parseFlowUrl(`${ORIGIN}/portals${QUERY}`)
		assert.equal(parsed.target, 'portals')
	})

	it('names `verifier-app` from the /verifier-app path', () => {
		const parsed = parseFlowUrl(`${ORIGIN}/verifier-app${QUERY}`)
		assert.equal(parsed.target, 'verifier-app')
	})

	it('names `reclaim-browser-extension` from that path', () => {
		const parsed = parseFlowUrl(
			`${ORIGIN}/reclaim-browser-extension${QUERY}`,
		)
		assert.equal(parsed.target, 'reclaim-browser-extension')
	})

	it('degrades an unrecognised path (e.g. /zkfetch) to no target', () => {
		const parsed = parseFlowUrl(`${ORIGIN}/zkfetch${QUERY}`)
		assert.equal(parsed.target, undefined)
	})

	describe('the post-migration /share/{name} shape', () => {
		it('names `builder` from /share/builder', () => {
			const parsed = parseFlowUrl(`${ORIGIN}/share/builder${QUERY}`)
			assert.equal(parsed.target, 'builder')
			assert.equal(parsed.sessionId, SESSION_ID)
		})

		it('names `portals` from /share/portals', () => {
			const parsed = parseFlowUrl(`${ORIGIN}/share/portals${QUERY}`)
			assert.equal(parsed.target, 'portals')
		})

		it('names `verifier-app` from /share/verifier-app', () => {
			const parsed = parseFlowUrl(`${ORIGIN}/share/verifier-app${QUERY}`)
			assert.equal(parsed.target, 'verifier-app')
		})

		it('names `reclaim-browser-extension` from /share/reclaim-browser-'
			+ 'extension', () => {
			const parsed = parseFlowUrl(
				`${ORIGIN}/share/reclaim-browser-extension${QUERY}`,
			)
			assert.equal(parsed.target, 'reclaim-browser-extension')
		})

		it('degrades /share/inapp-sdk to no target — not a launchable client',
			() => {
				const parsed = parseFlowUrl(`${ORIGIN}/share/inapp-sdk${QUERY}`)
				assert.equal(parsed.target, undefined)
			})

		it('degrades /share/zkfetch to no target — not a launchable client',
			() => {
				const parsed = parseFlowUrl(`${ORIGIN}/share/zkfetch${QUERY}`)
				assert.equal(parsed.target, undefined)
			})

		it('still falls back to the verificationClientId escape hatch for a '
			+ 'non-launchable /share/{name}', () => {
			const parsed = parseFlowUrl(
				`${ORIGIN}/share/zkfetch${QUERY}`,
				EXTENSION_BUILTIN_ID,
			)
			assert.equal(parsed.target, 'reclaim-browser-extension')
		})
	})

	it('every VerificationClient constant parses back to its own target, or '
		+ 'to no launchable target for the two attribution-only clients',
	() => {
		assert.equal(
			parseFlowUrl(`${VerificationClient.builder}${QUERY}`).target,
			'builder',
		)
		assert.equal(
			parseFlowUrl(`${VerificationClient.portals}${QUERY}`).target,
			'portals',
		)
		assert.equal(
			parseFlowUrl(`${VerificationClient.verifierApp}${QUERY}`).target,
			'verifier-app',
		)
		assert.equal(
			parseFlowUrl(
				`${VerificationClient.reclaimBrowserExtension}${QUERY}`,
			).target,
			'reclaim-browser-extension',
		)
		assert.equal(
			parseFlowUrl(`${VerificationClient.inAppSdk}${QUERY}`).target,
			undefined,
		)
		assert.equal(
			parseFlowUrl(`${VerificationClient.zkFetch}${QUERY}`).target,
			undefined,
		)
	})

	it('reads sessionId and diag=1 off the query string', () => {
		const parsed = parseFlowUrl(`${ORIGIN}/portals${QUERY}&diag=1`)
		assert.equal(parsed.sessionId, SESSION_ID)
		assert.equal(parsed.diag, true)
	})

	it('never invents diag when the URL omits it', () => {
		const parsed = parseFlowUrl(`${ORIGIN}/portals${QUERY}`)
		assert.equal(parsed.diag, false)
	})

	describe('the verificationClientId escape hatch', () => {
		it('names a target for an unrecognised path when the id matches '
			+ 'a builtin client', () => {
			const parsed = parseFlowUrl(
				`https://custom.example/verify${QUERY}`,
				EXTENSION_BUILTIN_ID,
			)
			assert.equal(parsed.target, 'reclaim-browser-extension')
		})

		it('is never required — an unrecognised path with no id degrades', () => {
			const parsed = parseFlowUrl(`https://custom.example/verify${QUERY}`)
			assert.equal(parsed.target, undefined)
		})

		it('is ignored once the path itself already names a client', () => {
			const parsed = parseFlowUrl(
				`${ORIGIN}/portals${QUERY}`,
				EXTENSION_BUILTIN_ID,
			)
			assert.equal(parsed.target, 'portals')
		})
	})
})

describe('resolveDestinationUrl', () => {
	it('opens `builder`\'s own registered URL unchanged', () => {
		const url = `${ORIGIN}/v/${SESSION_ID}${QUERY}`
		const parsed = parseFlowUrl(url)
		assert.equal(resolveDestinationUrl('builder', parsed, {}), url)
	})

	it('rebuilds `portals`\' attribution label into the real portal URL', () => {
		const parsed = parseFlowUrl(`${ORIGIN}/portals${QUERY}&diag=1`)
		const destination = resolveDestinationUrl('portals', parsed, {})
		const destinationUrl = new URL(destination)
		assert.equal(destinationUrl.origin, 'https://portal.reclaimprotocol.org')
		assert.equal(destinationUrl.pathname, '/verify')
		assert.equal(destinationUrl.searchParams.get('sessionId'), SESSION_ID)
		assert.equal(destinationUrl.searchParams.get('diag'), '1')
	})

	it('honours a custom portalUrl option', () => {
		const parsed = parseFlowUrl(`${ORIGIN}/portals${QUERY}`)
		const destination = resolveDestinationUrl('portals', parsed, {
			portalUrl: 'https://portal.example.test',
		})
		assert.equal(new URL(destination).origin, 'https://portal.example.test')
	})

	it('keeps a `verifier-app` url as its own share link', () => {
		// `verifier-app`'s registered uri is Builder's `GET /s`, a real page,
		// so the verificationUrl already IS the share link. Rewriting it onto
		// another origin would discard the app-link association that makes a
		// scan open the app.
		const url = `${ORIGIN}/s${QUERY}`
		const parsed = parseFlowUrl(url)
		assert.equal(resolveDestinationUrl('verifier-app', parsed, {}), url)
	})

	it('sends `verifier-app` elsewhere when appLinkBaseUrl is set', () => {
		const parsed = parseFlowUrl(`${ORIGIN}/s${QUERY}`)
		const destination = resolveDestinationUrl('verifier-app', parsed, {
			appLinkBaseUrl: LEGACY_APP_LINK_BASE_URL,
		})
		const destinationUrl = new URL(destination)
		assert.equal(destinationUrl.origin, 'https://share.reclaimprotocol.org')
		assert.equal(destinationUrl.searchParams.get('sessionId'), SESSION_ID)
	})

	it('degrades an unrecognised target to the original URL', () => {
		const url = `https://custom.example/verify${QUERY}`
		const parsed = parseFlowUrl(url)
		assert.equal(resolveDestinationUrl(undefined, parsed, {}), url)
	})

	it('never invents diag on a destination the session did not opt into', () => {
		const parsed = parseFlowUrl(`${ORIGIN}/verifier-app${QUERY}`)
		const destination = resolveDestinationUrl('verifier-app', parsed, {})
		assert.equal(new URL(destination).searchParams.has('diag'), false)
	})
})

describe('appendSessionQuery', () => {
	it('preserves an existing query parameter (e.g. an App Clip\'s ?p=)', () => {
		const parsed = parseFlowUrl(`${ORIGIN}/verifier-app${QUERY}`)
		const url = appendSessionQuery(
			'https://appclip.apple.com/id?p=org.reclaimprotocol.app.clip',
			parsed,
		)
		const parsedUrl = new URL(url)
		assert.equal(
			parsedUrl.searchParams.get('p'), 'org.reclaimprotocol.app.clip',
		)
		assert.equal(parsedUrl.searchParams.get('sessionId'), SESSION_ID)
		assert.equal(parsedUrl.searchParams.get('api'), '2')
	})
})
