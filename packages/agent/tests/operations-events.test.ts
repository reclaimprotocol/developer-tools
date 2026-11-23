import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { MCP_TOOLS } from '../src/mcp/api/operations.gen.ts'

const source = readFileSync(
	new URL('../src/mcp/api/operations.gen.ts', import.meta.url),
	'utf8',
)

// Matches an events array: maxItems, then items with a string enum.
const ARRAY_RE = new RegExp(
	'"maxItems": (\\d+),\\s*"items": \\{\\s*"type": "string",\\s*'
	+ '(?:"description": "[^\\n]*",\\s*)?"enum": \\[([^\\]]*)\\]',
	'g',
)
const EVENT_ARRAYS = [...source.matchAll(ARRAY_RE)]
	.map((m) => ({
		maxItems: Number(m[1]),
		values: [...m[2].matchAll(/"([^"]+)"/g)].map((v) => v[1]),
	}))
	.filter((a) => a.values.includes('ai_search_started'))

const AI_EMAIL_EVENTS = [
	'ai_website_failed',
	'ai_email_connected',
	'ai_email_selected',
	'ai_email_rejected',
	'ai_email_verified',
]

describe('generated verification event arrays', () => {
	it('finds the event arrays', () => {
		assert.ok(EVENT_ARRAYS.length >= 4)
	})

	it('allows every enum value in each events array', () => {
		for(const { maxItems, values } of EVENT_ARRAYS) {
			assert.ok(
				maxItems >= values.length,
				`maxItems ${maxItems} < ${values.length} enum values`,
			)
		}
	})

	it('includes the AI email fallback events', () => {
		for(const { values } of EVENT_ARRAYS) {
			for(const name of AI_EMAIL_EVENTS) {
				assert.ok(values.includes(name), `missing ${name}`)
			}
		}
	})

	it('accepts a subscription listing every event', () => {
		const events = EVENT_ARRAYS[0].values
		const out = MCP_TOOLS.CreateCallbackSubscription.inputSchema.parse({
			params: {},
			query: {},
			body: {
				deliveryMode: 'webhook',
				callbackUrl: 'https://example.com/hook',
				events,
			},
		})
		assert.partialDeepStrictEqual(out, { body: { events } })
	})
})
