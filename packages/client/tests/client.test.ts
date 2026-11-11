import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ReclaimClient } from '../src/client.ts'
import { stubFetch } from './fetch.ts'

function jsonResponse(body: unknown) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	})
}

describe('ReclaimClient.call', () => {
	it('substitutes path params and forwards header params (If-Match)',
		async() => {
			const { calls, fetch } = stubFetch(() => jsonResponse({ ok: true }))

			const client = new ReclaimClient({
				baseUrl: 'http://x',
				token: 't0',
				fetch,
			})
			await client.call('UpdateProviderVersion', {
				params: { providerId: 'p1', version: '1.0.0' },
				body: {},
				headers: { 'If-Match': 'etag-123' },
			})

			const [{ url, init }] = calls
			const headers = new Headers(init.headers)
			assert.equal(url, 'http://x/providers/p1/versions/1.0.0')
			assert.equal(headers.get('If-Match'), 'etag-123')
			// A header param must never clobber the bearer token.
			assert.equal(headers.get('Authorization'), 'Bearer t0')
		}
	)

	it('skips null/undefined header values', async() => {
		const { calls, fetch } = stubFetch(() => jsonResponse({ ok: true }))

		const client = new ReclaimClient({ baseUrl: 'http://x', fetch })
		await client.call('UpdateProviderVersion', {
			params: { providerId: 'p1', version: '1.0.0' },
			body: {},
			headers: { 'If-Match': undefined },
		})

		const headers = new Headers(calls[0].init.headers)
		assert.ok(!headers.has('If-Match'), 'undefined header is omitted')
	})

	it('works without a headers arg (most operations)', async() => {
		const { calls, fetch } = stubFetch(() => jsonResponse({ ok: true }))

		const client = new ReclaimClient({ baseUrl: 'http://x', fetch })
		await client.call('GetMe', {})
		assert.equal(calls.length, 1)
	})
})
