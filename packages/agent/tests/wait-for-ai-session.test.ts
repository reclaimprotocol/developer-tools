import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	type AiSessionApi,
	waitForAiSessionTool,
} from '../src/mcp/tools/verification/wait-for-ai-session.ts'

type Out = {
	next: string
	verificationUrl?: string
	timedOut?: boolean
	fallback?: { recommended: boolean, reason: string }
	lookup: {
		candidates: { source: string }[]
		dataPoints: unknown
		error: { status: number }
	}
	session: { events: unknown }
}

type Step = {
	lookup: Record<string, unknown>
	session?: Record<string, unknown>
	events?: Record<string, unknown>[]
}

/** Scripted API: each poll consumes the next step, the last one repeats. */
function run(
	steps: Step[],
	args: Record<string, unknown> = {},
) {
	let poll = -1
	let clock = 0
	const current = () => steps[Math.min(Math.max(poll, 0), steps.length - 1)]
	const api = {
		async getLookup() {
			poll++
			return current().lookup
		},
		async getSession() {
			return current().session ?? { status: 'pending' }
		},
		async listEvents() {
			return current().events ?? []
		},
	} as unknown as AiSessionApi // scripted steps are loosely typed on purpose
	const tool = waitForAiSessionTool({
		createApi: () => api,
		sleep: async(ms) => {
			clock += ms
		},
		now: () => clock,
	})
	return tool.handler({ sessionId: 'sess-1', ...args }) as Promise<Out>
}

describe('wait_for_ai_session', () => {
	it('returns share_url once the lookup turns ready', async() => {
		const out = await run([
			{ lookup: { status: 'resolving' } },
			{
				lookup: {
					status: 'ready',
					candidates: [
						{
							loginUrl: 'https://a.example/login',
							source: 'web',
							confidence: 0.9,
						},
					],
					dataPoints: [
						{ name: 'username', description: 'x', isOptional: false },
					],
				},
				session: {
					status: 'pending',
					verificationUrl: 'https://share.example/s',
				},
			},
		])
		assert.equal(out.next, 'share_url')
		assert.equal(out.verificationUrl, 'https://share.example/s')
		assert.equal(out.lookup.candidates[0].source, 'web')
		assert.deepEqual(
			out.lookup.dataPoints,
			[{ name: 'username', isOptional: false }],
		)
		assert.equal(out.fallback, undefined)
	})

	it('recommends fallback when the lookup fails', async() => {
		const out = await run([
			{
				lookup: {
					status: 'failed',
					error: { title: 'Not Found', status: 404, detail: 'none' },
				},
				session: { status: 'error' },
			},
		])
		assert.equal(out.next, 'none')
		assert.equal(out.fallback?.recommended, true)
		assert.match(out.fallback?.reason ?? '', /No login page/)
		assert.match(out.fallback?.reason ?? '', /route: 'provider'/)
		assert.equal(out.lookup.error.status, 404)
	})

	it('recommends fallback when the session is rejected', async() => {
		const out = await run([
			{
				lookup: { status: 'started' },
				session: { status: 'rejected', callbackDeliveryStatus: 'pending' },
				events: [
					{
						event: 'verification_rejected',
						eventData: { reasonCode: 'missing-data-points', secret: 'x' },
					},
				],
			},
		])
		assert.equal(out.fallback?.recommended, true)
		assert.match(out.fallback?.reason ?? '', /missing-data-points/)
		assert.deepEqual(out.session.events, [
			{ event: 'verification_rejected', reasonCode: 'missing-data-points' },
		])
	})

	it('returns done on success', async() => {
		const out = await run(
			[
				{ lookup: { status: 'ready' } },
				{ lookup: { status: 'started' }, session: { status: 'success' } },
			],
			{ untilTerminal: true },
		)
		assert.equal(out.next, 'done')
		assert.equal(out.fallback, undefined)
	})

	it('returns the current state on timeout', async() => {
		const out = await run(
			[{ lookup: { status: 'started' } }],
			{ untilTerminal: true, timeoutSeconds: 6 },
		)
		assert.equal(out.timedOut, true)
		assert.equal(out.next, 'waiting_for_user')
	})

	it('reports the outcome, problem, and a webhook hint', async() => {
		const out = await run([
			{
				lookup: { status: 'started', aiSdkSessionId: 'portal-1' },
				session: {
					status: 'error',
					callbackDeliveryStatus: 'pending',
					callbackDeliveryStatuses: [
						{ subscriptionId: 's1', deliveryStatus: 'attempt_failed' },
					],
					outcome: 'data_not_found',
					outcomeNote: {
						label: 'The value was not found.',
						retry: 'change_request',
						suggestions: [],
					},
				},
				events: [
					{
						event: 'verification_error',
						eventData: {
							problem: { title: 'Failed', detail: 'No match', reasonCode: 'x' },
						},
					},
					{ event: 'session_expired' },
				],
			},
		]) as unknown as {
			lookup: { aiSdkSessionId: string }
			session: {
				outcome: string
				problem: { detail: string }
				callbackHint: string
			}
			fallback: { reason: string }
		}
		assert.equal(out.lookup.aiSdkSessionId, 'portal-1')
		assert.equal(out.session.outcome, 'data_not_found')
		assert.equal(out.session.problem.detail, 'No match')
		assert.match(out.session.callbackHint, /list_verification_deliveries/)
		assert.match(out.session.callbackHint, /test_callback_subscription/)
		assert.match(out.session.callbackHint, /delete_callback_subscription/)
		assert.match(out.fallback.reason, /The value was not found\./)
	})

	it('treats a default cancel detail as an unknown reason', async() => {
		const out = await run([
			{
				lookup: { status: 'started' },
				session: { status: 'cancelled' },
				events: [
					{
						event: 'verification_cancelled',
						eventData: {
							problem: { detail: 'The verification was cancelled.' },
						},
					},
				],
			},
		]) as unknown as { session: { problem: { reasonUnknown: boolean } } }
		assert.equal(out.session.problem.reasonUnknown, true)
	})
})
