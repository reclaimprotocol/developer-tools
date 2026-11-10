import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { makeDraftStore } from '../src/authoring/index.ts'
import { buildAgentTools } from '../src/mcp/tools/agent/build.ts'
import type { CaptureStore } from '../src/mcp/tools/agent/capture.ts'
import { draftTools } from '../src/mcp/tools/agent/draft-tools.ts'
import { shapeRichProofResult } from '../src/mcp/tools/agent/proof.ts'
import { sharedAuthoringTools } from '../src/mcp/tools/agent/shared.ts'
import type { MatcherCheckResult } from '../src/proof/check-matchers.ts'
import type { ReclaimProvider } from '../src/provider/schema.ts'
import { loadFixture } from './stub-cdp.ts'

type Check = MatcherCheckResult & { requestId: string }

describe('check_matchers + update_draft', () => {
	it('checks a proposed draft offline and shows what the attestor sees',
		async() => {
			const { call, draftId, captureId } = await proposeTierDraft()
			const check = await call('check_matchers', {
				captureId, draftId,
			}) as Check
			assert.equal(check.ok, true)
			assert.deepEqual(check.extractedParameters, {
				alaskaStatus: 'Atmos™ Member',
			})
			assert.deepEqual(
				check.revealed.map((s) => s.text),
				['currentTierDescription:"Atmos™ Member"'],
			)
			// Only the matched window is revealed, not the page.
			assert.ok(check.revealedBytes < check.bodyBytes)
		})

	it('reports the failing match for a trial edit without saving it',
		async() => {
			const { call, draftId, captureId } = await proposeTierDraft()
			const trial = await call('check_matchers', {
				captureId,
				draftId,
				responseMatches: [{
					type: 'contains',
					value: 'currentTierDescription:"{{alaskaStatus}}",',
				}],
			}) as Check
			assert.equal(trial.ok, false)
			assert.equal(trial.failedAt, 'match')
			assert.match(trial.reason ?? '', /does not contain/)

			const saved = await call('check_matchers', {
				captureId, draftId,
			}) as Check
			assert.equal(saved.ok, true, 'the trial must not change the draft')
		})

	it('fails at redaction when the capture is not 2xx, as the attestor does',
		async() => {
			const { call, draftId, captureId, session } = await proposeTierDraft()
			session.requests.get('page')!.status = 406
			const check = await call('check_matchers', {
				captureId, draftId,
			}) as Check
			assert.equal(check.failedAt, 'redaction')
			assert.match(check.reason ?? '', /Expected status 2xx, got 406/)
		})

	it('update_draft saves an edit, keeps the id, and checks it', async() => {
		const { call, draftId, captureId } = await proposeTierDraft()
		const updated = await call('update_draft', {
			captureId,
			draftId,
			responseMatches: [{
				type: 'regex',
				value: 'currentTierDescription:"(?<alaskaStatus>[^"]+)"',
			}],
			responseRedactions: [{
				regex: 'currentTierDescription:"[^"]+"',
			}],
		}) as {
			draftId: string
			provider: ReclaimProvider
			check: Check
		}
		assert.equal(updated.draftId, draftId)
		assert.equal(updated.provider.responseMatches[0].type, 'regex')
		assert.equal(updated.check.ok, true)
		assert.deepEqual(updated.check.extractedParameters, {
			alaskaStatus: 'Atmos™ Member',
		})
		// Secrets never enter the result.
		assert.ok(!JSON.stringify(updated).includes('FIXTUREONLY'))
	})

	it('update_draft rejects a matcher that bakes the captured value',
		async() => {
			const { call, draftId, captureId } = await proposeTierDraft()
			await assert.rejects(
				call('update_draft', {
					captureId,
					draftId,
					responseMatches: [{
						type: 'contains',
						value: 'currentTierDescription:"Atmos™ Member"',
					}],
				}),
				/un-templated/,
			)
		})

	it('update_draft rejects an edit that reveals more of the response',
		async() => {
			const { call, draftId, captureId } = await proposeTierDraft()
			await assert.rejects(
				call('update_draft', {
					captureId,
					draftId,
					responseRedactions: [{
						regex: 'currentTierCode:"[^"]+",currentTierDescription:"[^"]+"',
					}],
				}),
				/reveals \d+ bytes of the response to the attestor, more than/,
			)
			const saved = await call('check_matchers', {
				captureId, draftId,
			}) as Check
			assert.equal(saved.revealed.length, 1, 'the draft must be unchanged')
		})

	it('registers both tools with the agent tools', () => {
		const names = buildAgentTools().map((t) => t.definition.name)
		assert.ok(names.includes('check_matchers'))
		assert.ok(names.includes('update_draft'))
	})
})

describe('run_proof diagnosis for sites that block non-browser clients', () => {
	const failed = (error: string) => ({
		proof: undefined,
		extractedValue: '',
		extractedParameters: {},
		verified: false,
		error,
	})
	const shape = (
		error: string,
		lastReplay?: { status: number, ok: boolean },
	) => shapeRichProofResult(failed(error), {
		provider: {},
		hasSecrets: true,
		...(lastReplay ? { lastReplay } : {}),
	}) as {
		error?: string
		diagnosis?: { kind: string, status?: number, replayedInBrowser?: true }
	}

	it('diagnoses a 406 after a successful browser replay, keeping the error',
		() => {
			const error = 'Expected status 2xx, got 406 (Not Acceptable)'
			const out = shape(error, { status: 200, ok: true })
			assert.equal(out.error, error)
			assert.deepEqual(
				{
					kind: out.diagnosis?.kind,
					status: out.diagnosis?.status,
					replayedInBrowser: out.diagnosis?.replayedInBrowser,
				},
				{
					kind: 'blocked-non-browser-client',
					status: 406,
					replayedInBrowser: true,
				},
			)
		})

	it('diagnoses a blocking status even without a tracked replay', () => {
		assert.equal(
			shape('Provider returned error 403')?.diagnosis?.kind,
			'blocked-non-browser-client',
		)
	})

	it('diagnoses a challenge page the redaction could not match', () => {
		const page = Buffer.from(
			'<!doctype html><html><title>Just a moment...</title></html>',
		).toString('base64')
		const out = shape(
			`regexp x does not match found element '${page}'`,
			{ status: 200, ok: true },
		)
		assert.equal(out.diagnosis?.kind, 'blocked-non-browser-client')
	})

	it('stays quiet for an ordinary failure', () => {
		assert.equal(shape('Invalid receipt. Response does not contain "x"')
			.diagnosis, undefined)
		assert.equal(shape('Expected status 2xx, got 404 (Not Found)')
			.diagnosis, undefined)
	})

	it('says run_proof_via_pod does not get past bot protection', () => {
		const pod = buildAgentTools()
			.find((t) => t.definition.name === 'run_proof_via_pod')
		assert.match(pod?.definition.description ?? '', /TLS fingerprint/)
	})
})

/** A capture holding the SvelteKit fixture, a proposed draft for its tier
 *  status, and a caller for the agent tools bound to that capture. */
async function proposeTierDraft() {
	const session = loadFixture('sveltekit-tier')
	const captures: CaptureStore = {
		sessions: new Map([[
			session.captureId,
			// propose/check never touch the tab client, so a stub is fine.
			{ session, tabClient: {} as never, drafts: makeDraftStore() },
		]]),
	}
	const tools = [...sharedAuthoringTools(captures), ...draftTools(captures)]
	const call = (name: string, args: Record<string, unknown>) => {
		const tool = tools.find((t) => t.definition.name === name)
		assert.ok(tool, `no tool ${name}`)
		return tool.handler(args)
	}

	const drafted = await call('propose_provider', {
		captureId: session.captureId,
		requestId: 'page',
		name: 'status',
		shortenNames: false,
		targets: [{ value: 'Atmos™ Member', name: 'alaskaStatus' }],
	}) as { draftId: string }
	return {
		call, draftId: drafted.draftId, captureId: session.captureId, session,
	}
}
