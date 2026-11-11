import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { successResponse } from '../src/mcp/success-response.ts'

describe('successResponse', () => {
	it('keeps object results machine-readable and text-compatible', () => {
		const value = {
			status: 'ready',
			url: 'https://example.test/liveview.html?magnify=1',
		}
		const result = successResponse(value)
		assert.deepEqual(result.structuredContent, value)
		const content = result.content[0]
		assert.equal(content.type, 'text')
		assert.deepEqual(JSON.parse(content.text), value)
	})

	it('wraps non-object values for structured content', () => {
		const result = successResponse(['one', 'two'])
		assert.deepEqual(result.structuredContent, { result: ['one', 'two'] })
	})
})
