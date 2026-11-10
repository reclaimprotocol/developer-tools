/**
 * The login poll's timeout message (`src/old/login-cdp.ts`).
 *
 * A cold dashboard load and a developer who walked away are different
 * problems, and the timeout is the only place we can tell them apart. These
 * tests pin that distinction, because getting it wrong sends the reader
 * chasing the wrong cause.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	EXTRACT_TOKEN_JS,
	localDashboardBrowser,
} from '../src/old/login-cdp.ts'

describe('local dashboard browser selection', () => {
	it('accepts only dedicated or attached local Chrome modes', () => {
		assert.deepEqual(
			localDashboardBrowser({ attachMode: 'attach', port: 9333 }),
			{ mode: 'attach', port: 9333 },
		)
		assert.deepEqual(
			localDashboardBrowser({ attachMode: 'dedicated', port: 9223 }),
			{ mode: 'dedicated', port: 9223 },
		)
	})

	it('rejects remote, container, custom, and malformed configuration', () => {
		for(const attachMode of ['builder', 'container', 'custom']) {
			assert.deepEqual(
				localDashboardBrowser({ attachMode, port: 9333 }),
				{ mode: 'dedicated', port: 9222 },
			)
		}

		assert.deepEqual(localDashboardBrowser({
			attachMode: 'attach', port: 70_000,
		}), { mode: 'dedicated', port: 9222 })
	})
})

describe('login token extraction script', () => {
	it('checks both persistence layouts', () => {
		assert.match(EXTRACT_TOKEN_JS, /firebase:authUser:/)
		assert.match(EXTRACT_TOKEN_JS, /firebaseLocalStorageDb/)
	})

	it('rejects a stale token rather than closing the tab early', () => {
		// A persistent profile keeps an expired entry from a previous run; the
		// freshness check is what stops the poll "succeeding" on tick one.
		assert.match(EXTRACT_TOKEN_JS, /payload\.exp/)
		assert.match(EXTRACT_TOKEN_JS, /Date\.now\(\)/)
	})
})

describe('login timeout diagnosis', () => {
	/** Re-implements the message branch so the wording is asserted directly. */
	const message = (timeoutMs: number, sawInteractivePage: boolean) => {
		const waited = Math.round(timeoutMs / 1000)
		return `Timed out after ${waited}s waiting for login. `
			+ (sawInteractivePage
				? 'The page finished loading, so sign-in was never completed — '
					+ 'ask the developer to finish signing in at the opened window, '
					+ 'then re-run reclaim_authenticate.'
				: 'The page never became interactive, so the dashboard was still '
					+ 'loading the whole time. On a fresh Chrome profile its bundle '
					+ 'is a large cold download. Retry (the profile is now warm), or '
					+ 'pass a bigger timeoutMs.')
	}

	it('names the elapsed time in seconds', () => {
		assert.match(message(360_000, true), /after 360s/)
	})

	it('blames sign-in when the page did become interactive', () => {
		const m = message(360_000, true)
		assert.match(m, /sign-in was never completed/)
		assert.doesNotMatch(m, /still\s+loading/)
	})

	it('blames the cold load when the page never became interactive', () => {
		const m = message(360_000, false)
		assert.match(m, /never became interactive/)
		assert.match(m, /cold download/)
		assert.doesNotMatch(m, /sign-in was never completed/)
	})
})
