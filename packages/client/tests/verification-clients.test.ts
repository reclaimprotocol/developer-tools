import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { VerificationClient } from '../src/index.ts'

describe('known Verification Clients', () => {
	it('exposes declarative production and custom client URLs', () => {
		// Must track the uri `builtin-clients.ts`'s `clientUrl()` seeds for
		// every one of the six built-ins. Builder resolves
		// `verificationClientUrl` by EXACT string match, so a constant that
		// drifts from the seed is a 400 at session creation, not a warning —
		// this exact class of bug has bitten twice already (`portals` and
		// `verifierApp`, both pinned below along with the rest).
		assert.equal(
			VerificationClient.builder,
			'https://build.reclaimprotocol.org/share/builder',
		)
		assert.equal(
			VerificationClient.portals,
			'https://build.reclaimprotocol.org/share/portals',
		)
		assert.equal(
			VerificationClient.verifierApp,
			'https://build.reclaimprotocol.org/share/verifier-app',
		)
		assert.equal(
			VerificationClient.inAppSdk,
			'https://build.reclaimprotocol.org/share/inapp-sdk',
		)
		assert.equal(
			VerificationClient.reclaimBrowserExtension,
			'https://build.reclaimprotocol.org/share/reclaim-browser-extension',
		)
		assert.equal(
			VerificationClient.zkFetch,
			'https://build.reclaimprotocol.org/share/zkfetch',
		)
		assert.equal(
			VerificationClient.custom('https://verify.example/session'),
			'https://verify.example/session',
		)
	})
})
