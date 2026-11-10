import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { makeDraftStore } from '../src/authoring/index.ts'
import type { CaptureStore } from '../src/mcp/tools/agent/capture.ts'
import { sharedAuthoringTools } from '../src/mcp/tools/agent/shared.ts'
import { loadFixture } from './stub-cdp.ts'

describe('full propose flow against fixture', () => {
	it(
		'finds the request, drafts a provider, and holds secrets under a draftId',
		async() => {
			const session = loadFixture('github-followers')
			const captures: CaptureStore = {
				sessions: new Map([[
					session.captureId,
					// find/propose don't touch the tab client — a stub is fine here.
					{ session, tabClient: {} as never, drafts: makeDraftStore() },
				]]),
			}
			const tools = sharedAuthoringTools(captures)
			const find = tools.find((t) => t.definition.name
				=== 'find_requests_containing')!
			const propose = tools.find((t) => t.definition.name
				=== 'propose_provider')!

			const found = (await find.handler({
				captureId: session.captureId,
				value: '1247',
			})) as {
				candidates: Array<{ requestId: string }>
			}
			assert.ok(found.candidates.length > 0)
			const reqId = found.candidates[0].requestId

			const drafted = (await propose.handler({
				captureId: session.captureId,
				requestId: reqId,
				target: '1247',
				name: 'github-followers',
			})) as {
				draftId: string
				provider: {
					headers?: Record<string, string>
					responseMatches: unknown[]
				}
				secretRefs: Array<{ name: string }>
			}

			assert.equal(drafted.provider.responseMatches.length, 1)
			assert.equal(drafted.provider.headers?.Authorization, undefined)
			assert.ok(drafted.secretRefs.find((r) => r.name === 'Authorization'))
			assert.match(drafted.draftId, /^draft_/)
			// The captured secret stays server-side, never in the tool result.
			assert.ok(!JSON.stringify(drafted).includes('ghp_FIXTUREONLY'))
		}
	)

	it('shortenNames: false uses the target name verbatim as the param key',
		async() => {
			const session = loadFixture('github-followers')
			const captures: CaptureStore = {
				sessions: new Map([[
					session.captureId,
					{ session, tabClient: {} as never, drafts: makeDraftStore() },
				]]),
			}
			const tools = sharedAuthoringTools(captures)
			const propose = tools.find((t) => t.definition.name
				=== 'propose_provider')!

			const drafted = (await propose.handler({
				captureId: session.captureId,
				requestId: 'r1',
				target: '1247',
				name: 'followers',
				shortenNames: false,
			})) as { provider: { paramValues?: Record<string, string> } }

			assert.deepEqual(drafted.provider.paramValues, { followers: '1247' })
		})
})
