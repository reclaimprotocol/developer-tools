import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { makeDraftStore } from '../src/authoring/index.ts'
import { authoringTools } from '../src/authoring/tools.ts'
import { captureTools } from '../src/mcp/tools/agent/capture.ts'
import { loadFixture } from './stub-cdp.ts'

// A 6 MB page body or eval result must not land in the caller's context
// whole: both tools return a 20,000-character window by default and say how
// to get the rest.

const BIG = 'a'.repeat(50_000) + 'needle' + 'b'.repeat(50_000)

interface Truncation {
	totalChars: number
	offset: number
	returnedChars: number
	nextOffset?: number
	note: string
}

function getRequestTool() {
	const session = loadFixture('github-followers')
	session.bodies.set('r1', BIG)
	const captures = {
		sessions: new Map([[
			session.captureId,
			// get_request doesn't touch the tab client, so a stub is fine.
			{ session, tabClient: {} as never, drafts: makeDraftStore() },
		]]),
	}
	const tool = captureTools({}, captures)
		.find((t) => t.definition.name === 'get_request')
	assert.ok(tool)
	const call = (extra: Record<string, unknown> = {}) => tool.handler({
		captureId: session.captureId, requestId: 'r1', ...extra,
	}) as Promise<{
		responseBody: string
		responseBodyTruncation?: Truncation
		bodyAvailable: boolean
	}>
	return call
}

function evalTool(value: unknown) {
	const tool = authoringTools(() => ({
		sendCdp: async() => ({ result: { value } }),
	}) as never)
		.find((t) => t.definition.name === 'eval_in_page')
	assert.ok(tool)
	return (extra: Record<string, unknown> = {}) => tool.handler({
		expression: 'x', ...extra,
	}) as Promise<{ value: unknown, valueTruncation?: Truncation }>
}

describe('large tool output', () => {
	it('get_request cuts the body and pages through the rest', async() => {
		const call = getRequestTool()

		const first = await call()
		assert.equal(first.bodyAvailable, true)
		assert.equal(first.responseBody, BIG.slice(0, 20_000))
		assert.equal(first.responseBodyTruncation?.totalChars, BIG.length)
		assert.ok(first.responseBodyTruncation)
		assert.equal(first.responseBodyTruncation.nextOffset, 20_000)
		assert.match(first.responseBodyTruncation.note, /offset: 20000/)

		const next = await call({ offset: 49_998, maxChars: 10 })
		assert.equal(next.responseBody, 'aaneedlebb')
		assert.equal(next.responseBodyTruncation?.nextOffset, 50_008)

		const full = await call({ full: true })
		assert.equal(full.responseBody, BIG)
		assert.equal(full.responseBodyTruncation, undefined)
	})

	it('get_request returns a small body whole', async() => {
		const session = loadFixture('github-followers')
		const tool = captureTools({}, {
			sessions: new Map([[
				session.captureId,
				{ session, tabClient: {} as never, drafts: makeDraftStore() },
			]]),
		}).find((t) => t.definition.name === 'get_request')
		assert.ok(tool)
		const res = await tool.handler({
			captureId: session.captureId, requestId: 'r1',
		}) as { responseBody: string, responseBodyTruncation?: unknown }
		assert.equal(res.responseBody, session.requests.get('r1')?.responseBody)
		assert.equal(res.responseBodyTruncation, undefined)
	})

	it('eval_in_page cuts long strings and objects', async() => {
		assert.deepEqual(await evalTool('short')(), { value: 'short' })

		const text = await evalTool(BIG)()
		assert.equal(text.value, BIG.slice(0, 20_000))
		assert.equal(text.valueTruncation?.totalChars, BIG.length)
		const full = await evalTool(BIG)({ full: true })
		assert.equal(full.value, BIG)

		const object = { html: BIG }
		const json = await evalTool(object)({ maxChars: 9 })
		assert.equal(json.value, '{"html":"')
		assert.equal(
			json.valueTruncation?.totalChars, JSON.stringify(object).length,
		)
		assert.equal(
			(json.valueTruncation as { format?: string } | undefined)?.format,
			'json',
		)
	})
})
