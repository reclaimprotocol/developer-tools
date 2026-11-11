import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { stripPseudoHeaders } from '../src/cdp/capture.ts'

describe('stripPseudoHeaders', () => {
	it('drops HTTP/2 pseudo-headers while preserving real headers', () => {
		const input = {
			':authority': 'github.com',
			':method': 'GET',
			':path': '/api/me',
			':scheme': 'https',
			'user-agent': 'Mozilla/5.0',
			accept: 'application/json',
			cookie: 'session=abc',
		}
		assert.deepEqual(stripPseudoHeaders(input), {
			'user-agent': 'Mozilla/5.0',
			accept: 'application/json',
			cookie: 'session=abc',
		})
	})

	it('passes plain HTTP/1 headers through unchanged', () => {
		const input = { 'X-Custom': 'value', Authorization: 'Bearer t' }
		assert.deepEqual(stripPseudoHeaders(input), input)
	})
})
