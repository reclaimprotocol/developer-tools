import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MCP_TOOLS } from '../src/mcp/api/operations.gen.ts'

describe('generated MCP tool input schemas', () => {
	it('preserves requiredContext through create_provider_version', () => {
		const schema = {
			type: 'object',
			required: ['username'],
			properties: { username: { type: 'string' } },
		}
		const out = MCP_TOOLS.CreateProviderVersion.inputSchema.parse({
			params: {
				providerId: '550e8400-e29b-41d4-a716-446655440000',
			},
			query: {},
			body: {
				initialUrl: 'https://example.com',
				requests: [],
				allowedJsRequests: [],
				webSettings: {},
				requiredContext: schema,
			},
		})
		assert.partialDeepStrictEqual(out, { body: { requiredContext: schema } })
	})

	it('preserves consumer context through create_verification_session', () => {
		const out = MCP_TOOLS.CreateVerificationSession.inputSchema.parse({
			params: {},
			query: {},
			body: {
				providers: [{ providerId: '550e8400-e29b-41d4-a716-446655440000' }],
				context: { username: 'alice', orderId: 'x1' },
				verificationClientUrl: 'https://v/{sessionId}',
			},
		})
		assert.partialDeepStrictEqual(
			out,
			{
				body: {
					context: { username: 'alice', orderId: 'x1' },
				}
			}
		)
	})

	it('still rejects invalid leaf values (uuid format, version pattern)', () => {
		assert.throws(() => {
			MCP_TOOLS.CreateProviderVersion.inputSchema.parse({
				params: { providerId: 'not-a-uuid' },
				query: {},
				body: {
					initialUrl: 'not-a-url',
					requests: [],
					allowedJsRequests: [],
					webSettings: {},
				},
			})
		})
	})
})
