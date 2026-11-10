import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { makeDraftStore } from '../src/authoring/index.ts'
import type { CaptureStore } from '../src/mcp/tools/agent/capture.ts'
import { draftTools } from '../src/mcp/tools/agent/draft-tools.ts'
import { sharedAuthoringTools } from '../src/mcp/tools/agent/shared.ts'
import type { runAttestorProof } from '../src/proof/attestor.ts'
import type { ReclaimProvider } from '../src/provider/schema.ts'
import { loadFixture } from './stub-cdp.ts'

// Passing ownerAddress keeps run_proof from creating a key in this repo.
const OWNER = `0x${'ab'.repeat(20)}`

describe('run_proof egress', () => {
	it('goes out from the developer\'s IP country for {{DYNAMIC_GEO}}',
		async() => {
			const { prove, sent } = await setup('IN')
			const out = await prove({})
			assert.equal(sent[0].geoLocation, 'IN')
			assert.deepEqual(out.egress, {
				geoLocation: 'IN', source: 'developer-ip',
			})
		})

	it('uses the geoLocation argument, then a pinned country', async() => {
		const { prove, sent, call, draftId, captureId } = await setup('IN')
		await prove({ geoLocation: 'us' })
		assert.equal(sent[0].geoLocation, 'US')

		await call('update_draft', { captureId, draftId, geoLocation: 'US' })
		const out = await prove({})
		assert.equal(sent[1].geoLocation, 'US')
		assert.deepEqual(out.egress, { geoLocation: 'US', source: 'draft' })
	})

	it('omits geoLocation when the IP lookup fails', async() => {
		const { prove, sent } = await setup(undefined)
		const out = await prove({})
		assert.equal(sent[0].geoLocation, undefined)
		assert.deepEqual(out.egress, { source: 'none' })
	})

	it('suggests retrying from the site\'s country when blocked', async() => {
		const { prove } = await setup('IN', 'Expected status 2xx, got 406')
		const out = await prove({})
		assert.match(out.diagnosis?.likelyCause ?? '', /went out from IN/)
		assert.match(out.diagnosis?.next ?? '', /`geoLocation`/)
	})
})

async function setup(country: string | undefined, error?: string) {
	const session = loadFixture('sveltekit-tier')
	const captures: CaptureStore = {
		sessions: new Map([[
			session.captureId,
			// propose/prove never touch the tab client, so a stub is fine.
			{ session, tabClient: {} as never, drafts: makeDraftStore() },
		]]),
	}
	const sent: ReclaimProvider[] = []
	const runProof: typeof runAttestorProof = async(provider) => {
		sent.push(provider)
		return {
			proof: undefined,
			extractedValue: '',
			extractedParameters: {},
			verified: false,
			error: error ?? 'not proved in tests',
		}
	}

	const tools = [
		...sharedAuthoringTools(
			captures,
			async() => assert.fail('unexpected attestor check'),
			runProof,
			async() => country,
		),
		...draftTools(captures),
	]
	const call = (name: string, args: Record<string, unknown>) => {
		const tool = tools.find((t) => t.definition.name === name)
		assert.ok(tool, `no tool ${name}`)
		return tool.handler(args)
	}

	const captureId = session.captureId
	const { draftId } = await call('propose_provider', {
		captureId,
		requestId: 'page',
		name: 'status',
		shortenNames: false,
		targets: [{ value: 'Atmos™ Member', name: 'alaskaStatus' }],
	}) as { draftId: string }
	const prove = (args: Record<string, unknown>) => call('run_proof', {
		captureId, draftId, ownerAddress: OWNER, ...args,
	}) as Promise<{
		egress: Record<string, unknown>
		diagnosis?: { likelyCause: string, next: string }
	}>
	return { prove, sent, call, draftId, captureId }
}
