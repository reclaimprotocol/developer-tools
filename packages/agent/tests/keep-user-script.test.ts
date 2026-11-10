import { ReclaimClient } from '@reclaimprotocol/client'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	type AuthoringBackend,
	authoringTools
} from '../src/authoring/index.ts'
import { ConfigStore } from '../src/config/store.ts'
import type { CaptureStore } from '../src/mcp/tools/agent/capture.ts'
import { createVersionFromCaptureTool } from '../src/mcp/tools/agent/publish.ts'
import { sessionTools } from '../src/mcp/tools/agent/session.ts'

function setup() {
	const captures: CaptureStore = { sessions: new Map() }
	const sent: { method: string, params?: Record<string, unknown> }[] = []
	let next = 0
	const backend = {
		kept: captures,
		sendCdp: async(method: string, params?: Record<string, unknown>) => {
			sent.push({ method, params })
			if(method === 'Page.addScriptToEvaluateOnNewDocument') {
				return { identifier: `s${++next}` }
			}

			if(method === 'Runtime.evaluate') {
				return { result: { value: { ran: true, errors: [] } } }
			}

			return {}
		},
		waitForEvent: async() => 'fired' as const,
	} as unknown as AuthoringBackend
	const tool = authoringTools(() => backend)
		.find((t) => t.definition.name === 'test_user_script')
	assert(tool)
	return { captures, sent, tool }
}

const methods = (sent: { method: string }[]) => sent.map((s) => s.method)

describe('test_user_script keep', () => {
	it('removes a non-kept script after navigating', async() => {
		const { captures, sent, tool } = setup()
		await tool.handler({ script: 'a()', navigateUrl: 'https://x.test' })
		assert.equal(captures.keptScript, undefined)
		assert.ok(
			methods(sent).includes('Page.removeScriptToEvaluateOnNewDocument'),
		)
	})

	it('keeps the script, replaces an earlier one, and shows it in get_session',
		async() => {
			const { captures, sent, tool } = setup()
			const first = await tool.handler({
				script: 'a()', navigateUrl: 'https://x.test', keep: true,
			})
			assert.equal((first as { kept: boolean }).kept, true)
			assert.deepEqual(captures.keptScript, { script: 'a()', identifier: 's1' })
			assert.ok(
				!methods(sent).includes('Page.removeScriptToEvaluateOnNewDocument'),
			)

			await tool.handler({ script: 'b()', keep: true })
			assert.deepEqual(captures.keptScript, { script: 'b()', identifier: 's2' })
			const removed = sent.filter(
				(s) => s.method === 'Page.removeScriptToEvaluateOnNewDocument',
			)
			assert.deepEqual(removed.map((r) => r.params), [{ identifier: 's1' }])

			const session = sessionTools(
				{ config: new ConfigStore('/nonexistent/config.json') }, captures,
			).find((t) => t.definition.name === 'get_session')
			assert(session)
			const state = await session.handler({}) as { keptUserScript?: string }
			assert.equal(state.keptUserScript, 'b()')
		})

	it('is published as jsUserScripts unless the call passes its own',
		async() => {
			const { captures, tool } = setup()
			await tool.handler({ script: 'kept()', keep: true })
			const bodies: { webSettings: { jsUserScripts?: string } }[] = []
			const fetch: typeof globalThis.fetch = async(_input, init) => {
				const isPost = init?.method === 'POST'
				if(isPost) {
					bodies.push(JSON.parse(String(init.body)))
				}

				return new Response(
					JSON.stringify(isPost ? {} : { items: [] }),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				)
			}

			const publish = createVersionFromCaptureTool(
				new ReclaimClient({ baseUrl: 'https://builder.example', fetch }),
				undefined,
				captures,
			)
			const args = {
				providerId: 'p',
				initialUrl: 'https://x.test',
				provider: {
					name: 'n',
					url: 'https://x.test/api',
					method: 'GET',
					responseMatches: [{ type: 'contains', value: 'x' }],
				},
			}
			await publish.handler(args)
			await publish.handler({ ...args, jsUserScripts: 'explicit()' })
			assert.equal(bodies[0].webSettings.jsUserScripts, 'kept()')
			assert.equal(bodies[1].webSettings.jsUserScripts, 'explicit()')
		})
})
