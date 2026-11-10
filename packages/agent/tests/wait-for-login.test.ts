import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AuthoringBackend } from '../src/authoring/backend.ts'
import { authoringTools } from '../src/authoring/tools.ts'

// wait_for_login confirms login from TWO signals: a NEW session cookie (real
// CDP cookies, httpOnly included, analytics/bot ignored) AND the page having
// LEFT the auth URL. Both are required — a mid-flow httpOnly challenge token
// (for example, LinkedIn chp_token on /checkpoint) must NOT count. These drive
// it with a scripted cookie sequence (call 1 = baseline) and a fixed current
// URL.

type Cookie = { name: string, httpOnly?: boolean }

/** A backend whose `Network.getCookies` returns `seq[i]` on the i-th call
 *  (clamped), and whose `Runtime.evaluate` (location.href) returns `url`. */
function fakeBackend(seq: Cookie[][], url: string): AuthoringBackend {
	let i = 0
	return {
		sendCdp: async(method: string) => {
			if(method === 'Network.getCookies') {
				const cookies = seq[Math.min(i, seq.length - 1)]
				i++
				return { cookies }
			}

			if(method === 'Runtime.evaluate') {
				return { result: { value: url } }
			}

			return {}
		},
	} as unknown as AuthoringBackend
}

function runWaitForLogin(
	backend: AuthoringBackend,
	timeoutMs: number,
): Promise<{ loggedIn: boolean, newCookies: string[] }> {
	const tool = authoringTools(() => backend)
		.find((t) => t.definition.name === 'wait_for_login')
	assert.ok(tool, 'wait_for_login tool should be registered')
	return tool.handler({ timeoutMs }) as Promise<
		{ loggedIn: boolean, newCookies: string[] }
	>
}

const FEED = 'https://site.example/feed'

describe('wait_for_login', () => {
	it('makes cloud page evaluation read-only without changing local tools',
		async() => {
			let params: Record<string, unknown> | undefined
			const backend = {
				...fakeBackend([], FEED),
				readOnlyPageEval: true,
				sendCdp: async(
					_method: string,
					value?: Record<string, unknown>,
				) => {
					params = value
					return { result: { value: 'alice' } }
				},
			}
			const tool = authoringTools(() => backend)
				.find((entry) => entry.definition.name === 'eval_in_page')
			assert.ok(tool)

			assert.deepEqual(
				await tool.handler({ expression: 'document.title' }),
				{ value: 'alice' },
			)
			assert.equal(params?.throwOnSideEffect, true)
		})

	it('fires on a new httpOnly cookie once off the auth URL', async() => {
		const res = await runWaitForLogin(fakeBackend([
			[{ name: '_ga' }, { name: '__ddg1_', httpOnly: true }],
			[{ name: '_ga' }, { name: '__ddg1_', httpOnly: true },
				{ name: 'msid', httpOnly: true }],
		], FEED), 5000)
		assert.equal(res.loggedIn, true)
		assert.deepEqual(res.newCookies, ['msid'])
	})

	it('fires on a session-NAMED cookie off the auth URL', async() => {
		const res = await runWaitForLogin(fakeBackend([
			[{ name: 'a' }],
			[{ name: 'a' }, { name: 'connect.sid' }],
		], FEED), 5000)
		assert.equal(res.loggedIn, true)
		assert.deepEqual(res.newCookies, ['connect.sid'])
	})

	it('does NOT fire on a mid-flow token still on /checkpoint', async() => {
		// The LinkedIn regression: chp_token is a NEW httpOnly cookie, but the page
		// is still on the challenge URL — login is not complete.
		const res = await runWaitForLogin(fakeBackend([
			[{ name: 'bcookie', httpOnly: true }],
			[{ name: 'bcookie', httpOnly: true },
				{ name: 'chp_token', httpOnly: true }],
		], 'https://www.linkedin.com/checkpoint/lg/login-submit'), 50)
		assert.equal(res.loggedIn, false)
	})

	it('does NOT fire on a new analytics cookie', async() => {
		const res = await runWaitForLogin(fakeBackend([
			[{ name: 'a' }],
			[{ name: 'a' }, { name: '_gid' }],
		], FEED), 50)
		assert.equal(res.loggedIn, false)
	})

	it('does NOT fire on a new httpOnly BOT cookie (__ddg is junk)', async() => {
		const res = await runWaitForLogin(fakeBackend([
			[{ name: 'a' }],
			[{ name: 'a' }, { name: '__ddg2_', httpOnly: true }],
		], FEED), 50)
		assert.equal(res.loggedIn, false)
	})

	it('does NOT fire while still on the /login URL', async() => {
		const res = await runWaitForLogin(fakeBackend([
			[{ name: 'a' }],
			[{ name: 'a' }, { name: 'sessionid', httpOnly: true }],
		], 'https://site.example/login'), 50)
		assert.equal(res.loggedIn, false)
	})
})
