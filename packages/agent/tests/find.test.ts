import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findTool } from '../src/mcp/tools/agent/find.ts'
import type { CapturedRequest } from '../src/provider/schema.ts'

/** A resolver returning a fake backend whose capture holds `reqs` — findTool
 *  only reads `backend.capture.requests`. */
function backendWith(reqs: CapturedRequest[]) {
	const requests = new Map(reqs.map((r) => [r.requestId, r]))
	return () => ({ capture: { requests } }) as never
}

const mk = (o: Partial<CapturedRequest>): CapturedRequest => ({
	requestId: 'r', method: 'GET', url: 'https://x/api', status: 200,
	contentType: 'application/json', size: 100, requestHeaders: {},
	responseHeaders: {}, responseBody: '', finishedAt: 0, ...o,
})

async function run(reqs: CapturedRequest[], value: string) {
	const tool = findTool(backendWith(reqs))
	const out = await tool.handler({ value }) as {
		candidates: { splitMatch?: boolean, matchedVariant: string }[]
	}
	return out.candidates
}

describe('find_requests_containing', () => {
	it('finds a whole-value match (no splitMatch flag)', async() => {
		const c = await run(
			[mk({ contentType: 'text/html', responseBody: '<li>Ada Lovelace</li>' })],
			'Ada Lovelace',
		)
		assert.equal(c.length, 1)
		assert.equal(c[0].splitMatch, undefined)
	})

	it('finds a split-field JSON match', async() => {
		const c = await run(
			[mk({ responseBody: '{"firstName":"Ada","lastName":"Lovelace"}' })],
			'Ada Lovelace',
		)
		assert.equal(c.length, 1)
		assert.equal(c[0].splitMatch, true)
	})

	it('ranks a whole-value match above a split match', async() => {
		const c = await run([
			mk({ requestId: 'split', responseBody: '{"fn":"Ada","ln":"Lovelace"}' }),
			mk({ requestId: 'whole', responseBody: '{"name":"Ada Lovelace"}' }),
		], 'Ada Lovelace')
		assert.equal(c.length, 2)
		assert.equal(c[0].splitMatch, undefined, 'whole-value match first')
		assert.equal(c[1].splitMatch, true, 'split match second')
	})

	it('does not split-match a single-token value', async() => {
		const c = await run(
			[mk({ responseBody: '{"a":"Ada","b":"elsewhere"}' })],
			'Ada',
		)
		// 'Ada' is a whole match; single token never produces a split candidate.
		assert.equal(c[0].splitMatch, undefined)
	})
})
