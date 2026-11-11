import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { diagnoseNetworkFailure } from '../src/mcp/tools/agent/proof.ts'
import { checkAttestor, isNetworkError } from '../src/proof/check-attestor.ts'

const signed = {
	claim: {
		context: JSON.stringify({ extractedParameters: { cardanoPrice: '0.5' } }),
	},
	signatures: { claimSignature: new Uint8Array([1]) },
}
const prepare = async() => {}

describe('checkAttestor', () => {
	it('returns the extracted prices when the attestor signs the claim',
		async() => {
			const result = await checkAttestor({
				prepare,
				createClaim: async() => signed,
			})
			assert.equal(result.ok, true)
			assert.deepEqual(result.extractedParameters, { cardanoPrice: '0.5' })
			assert.equal(result.errorKind, undefined)
		})

	it('classifies a dropped connection as attestor-unreachable', async() => {
		const result = await checkAttestor({
			prepare,
			createClaim: async() => {
				throw new Error('Connection closed, cannot send message')
			},
		})
		assert.equal(result.ok, false)
		assert.equal(result.errorKind, 'attestor-unreachable')
	})

	it('classifies a hang as attestor-unreachable after the timeout',
		async() => {
			const result = await checkAttestor({
				prepare,
				timeoutMs: 20,
				createClaim: () => new Promise(() => {}),
			})
			assert.equal(result.errorKind, 'attestor-unreachable')
			assert.match(result.error!, /timed out/)
		})

	it('classifies a rejected claim as attestor-error', async() => {
		const result = await checkAttestor({
			prepare,
			createClaim: async() => ({
				...signed,
				error: { code: 5, message: 'invalid proof' },
			}),
		})
		assert.equal(result.errorKind, 'attestor-error')
		assert.equal(result.error, 'invalid proof')
	})

	it('does not treat a target-site timeout or websocket error as network',
		async() => {
			for(const message of [
				'target site request timeout',
				'Response timed out',
				'websocket frame ignored by the site',
			]) {
				assert.equal(isNetworkError(message), false, message)
				const result = await checkAttestor({
					prepare,
					createClaim: async() => {
						throw new Error(message)
					},
				})
				assert.equal(result.errorKind, 'attestor-error', message)
			}

			for(const message of [
				'Connection closed, cannot send message',
				'ERROR_NETWORK_ERROR',
				'connect ECONNREFUSED 1.2.3.4:443',
				'Failed to connect to the attestor',
			]) {
				assert.equal(isNetworkError(message), true, message)
			}
		})

	it('classifies other local setup failures as setup-failed', async() => {
		const result = await checkAttestor({
			prepare: async() => {
				throw new Error('crypto init failed')
			},
			proofFilesState: () => ({ status: 'ready' }),
			createClaim: async() => signed,
		})
		assert.equal(result.errorKind, 'setup-failed')
	})

	it('reports a failed proof file download with its reason', async() => {
		const result = await checkAttestor({
			prepare: async() => {
				throw new Error('zk circuit download exited with code 1')
			},
			proofFilesState: () => ({ status: 'failed', reason: 'HTTP 403' }),
			createClaim: async() => assert.fail('attestor must not be contacted'),
		})
		assert.equal(result.ok, false)
		assert.equal(result.errorKind, 'proof-files-failed')
		assert.match(result.error!, /HTTP 403/)
		assert.deepEqual(
			result.proofFiles,
			{ status: 'failed', reason: 'HTTP 403' },
		)
	})

	it('reports a download still in progress instead of attestor-unreachable',
		async() => {
			const downloading = {
				status: 'downloading' as const,
				method: 'full-archive' as const,
				elapsedMs: 30_000,
				bytesDownloaded: 1024,
			}
			const result = await checkAttestor({
				prepare: () => new Promise(() => {}),
				timeoutMs: 20,
				proofFilesState: () => downloading,
				createClaim: async() => assert.fail('attestor must not be contacted'),
			})
			assert.equal(result.errorKind, 'proof-files-downloading')
			assert.match(result.error!, /still downloading.*1024 bytes/)
			assert.deepEqual(result.proofFiles, downloading)
		})

	it('blames the attestor only once the proof files are ready', async() => {
		const result = await checkAttestor({
			prepare,
			proofFilesState: () => ({ status: 'ready' }),
			createClaim: async() => {
				throw new Error('connect ECONNREFUSED 1.2.3.4:443')
			},
		})
		assert.equal(result.errorKind, 'attestor-unreachable')
		assert.deepEqual(result.proofFiles, { status: 'ready' })
	})
})

describe('run_proof diagnosis', () => {
	const ok = async() => ({ ok: true, attestorUrl: 'wss://a', durationMs: 1 })
	const down = async() => ({
		ok: false,
		attestorUrl: 'wss://a',
		durationMs: 1,
		errorKind: 'attestor-unreachable' as const,
	})
	const networkFailure = {
		verified: false,
		error: 'Connection closed, cannot send message',
	}

	it('blames the target site when the attestor check passes', async() => {
		const diagnosis = await diagnoseNetworkFailure(networkFailure, ok)
		assert.equal(diagnosis?.attestor.ok, true)
		assert.match(diagnosis.likelyCause, /target site/)
		assert.match(diagnosis.next, /run_proof_via_pod/)
	})

	it('blames this machine when the attestor check fails', async() => {
		const diagnosis = await diagnoseNetworkFailure(networkFailure, down)
		assert.equal(diagnosis?.attestor.ok, false)
		assert.match(diagnosis.likelyCause, /this machine/)
		assert.match(diagnosis.next, /RECLAIM_AGENT_TRACE=1/)
	})

	it('skips the check for verified proofs and non-network errors',
		async() => {
			const never = async() => {
				throw new Error('must not run')
			}

			assert.equal(
				await diagnoseNetworkFailure({ verified: true }, never),
				undefined,
			)
			assert.equal(
				await diagnoseNetworkFailure(
					{ verified: false, error: 'Response does not contain X' }, never,
				),
				undefined,
			)
		})
})
