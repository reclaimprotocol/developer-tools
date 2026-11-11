import { badRequest } from '@hapi/boom'
import { throwProblemError } from '@reclaimprotocol/client/api'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { remapErrorAsResponse } from '../src/mcp/remap_errors.ts'

describe('remapErrorAsResponse', () => {
	it('omits structuredContent for a Boom error with no data payload', () => {
		const result = remapErrorAsResponse(badRequest('orgId is required'))
		assert.equal('structuredContent' in result, false)
	})

	it('keeps structuredContent for a Boom error with a data payload', () => {
		const result = remapErrorAsResponse(
			badRequest('invalid provider', { field: 'providerId' }),
		)
		assert.deepEqual(result.structuredContent, { field: 'providerId' })
	})

	it('keeps Builder problem details from the browser-safe API client',
		async() => {
			const response = new Response(JSON.stringify({
				type: 'https://builder.test/problems/not-found',
				title: 'Session not found',
				status: 404,
				detail: 'No session has this ID.',
			}), {
				status: 404,
				headers: { 'Content-Type': 'application/problem+json' },
			})
			const error = await throwProblemError(response).catch(value => value)
			const result = remapErrorAsResponse(error)

			assert.equal(
				(result.content[0] as { text: string }).text,
				'Session not found: No session has this ID.',
			)
			assert.deepEqual(result.structuredContent, {
				type: 'https://builder.test/problems/not-found',
				title: 'Session not found',
				status: 404,
				detail: 'No session has this ID.',
			})
		}
	)
})
