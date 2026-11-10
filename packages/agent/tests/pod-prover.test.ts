/**
 * popcornProve maps the pod's /reclaim/prove response onto the shared
 * ProofResult. No live Popcorn: a stub fetch returns a known claim/signature
 * and we assert the request shape, the base64→hex signature conversion, and
 * the context→extractedParameters parse. The resulting AttestorClaim's own
 * round-trip through wrapProofAsJws is covered separately by the app's
 * nested-proof.test.ts — not duplicated here.
 */
import { bytesToHex } from '@noble/hashes/utils.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { popcornProve } from '../src/proof/pod-prover.ts'

const SIG_BYTES = Uint8Array.from({ length: 65 }, (_, i) => (i * 7) % 256)
const SIG_B64 = Buffer.from(SIG_BYTES).toString('base64')

function stubFetch(captured: { url?: string, body?: unknown }): typeof fetch {
	return (async(url: string | URL | Request, init?: RequestInit) => {
		captured.url = String(url)
		captured.body = init?.body ? JSON.parse(String(init.body)) : undefined
		// ReclaimProveResult is snake_case (../popcorn-images oapi.go): session_id,
		// claim.timestamp_s, and the whole signature object.
		const payload = {
			session_id: 'req_test',
			claim: {
				provider: 'http',
				parameters: '{"url":"https://api.github.com/user"}',
				owner: '0xowner',
				timestamp_s: 1717000000,
				context: JSON.stringify({
					extractedParameters: { username: 'octocat' },
				}),
				identifier: '0xid',
				epoch: 1,
			},
			signature: {
				attestor_address: '0xattestor',
				claim_signature: SIG_B64,
				result_signature: Buffer.from([1, 2, 3]).toString('base64'),
			},
		}
		return new Response(JSON.stringify(payload), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		})
	})
}

test('popcornProve maps claim + signature onto ProofResult', async() => {
	const captured: { url?: string, body?: unknown } = {}
	const context = {
		reclaimSessionId: '0192cc40-5ac0-7d90-8f2a-9b3c4d5e6f7a',
		attestationNonce: 'a'.repeat(64),
		attestationNonceData: {
			applicationId: '0x1234567890123456789012345678901234567890',
			sessionId: '0192cc40-5ac0-7d90-8f2a-9b3c4d5e6f7a',
			timestamp: '1774346557104',
			attestationVersion: 'v3',
		},
	}
	const result = await popcornProve({
		apiUrl: 'http://pod.local/',
		params: {
			url: 'https://api.github.com/user',
			method: 'GET',
			responseMatches: [{ type: 'contains', value: '"login":"{{username}}"' }],
			responseRedactions: [{ jsonPath: '$.login' }],
		},
		secretParams: { headers: { Cookie: 'session=secret' } },
		context,
		authRequest: 'base64-session-auth',
		fetchImpl: stubFetch(captured),
	})

	// Request shape: posts to {apiUrl}/reclaim/prove with a provider_params_json
	// (snake_case — the Popcorn contract) blob naming http + params/secretParams.
	assert.equal(captured.url, 'http://pod.local/reclaim/prove')
	const body = captured.body as { provider_params_json: string }
	const ppd = JSON.parse(body.provider_params_json) as Record<string, unknown>
	assert.equal(ppd.name, 'http')
	assert.deepEqual(
		(ppd.secretParams as { headers: unknown }).headers,
		{ Cookie: 'session=secret' },
	)
	assert.deepEqual(JSON.parse(ppd.context as string), context)
	assert.equal(ppd.authRequest, 'base64-session-auth')

	// Result mapping.
	assert.equal(result.verified, true)
	assert.deepEqual(result.extractedParameters, { username: 'octocat' })
	assert.equal(result.extractedValue, 'octocat')
	assert.equal(result.owner, '0xowner')
	// base64 signature → 0x-hex on the AttestorClaim.
	assert.equal(
		result.attestorClaim?.claimSignature,
		'0x' + bytesToHex(SIG_BYTES),
	)
	assert.equal(result.attestorClaim?.attestorAddress, '0xattestor')
})

test('popcornProve surfaces a non-2xx as an unverified result', async() => {
	const errFetch: typeof fetch = async() => {
		return new Response('boom', { status: 500 })
	}

	const result = await popcornProve({
		apiUrl: 'http://pod.local',
		params: { url: 'https://x', method: 'GET', responseMatches: [] },
		secretParams: {},
		fetchImpl: errFetch,
	})
	assert.equal(result.verified, false)
	assert.match(result.error ?? '', /500/)
})
