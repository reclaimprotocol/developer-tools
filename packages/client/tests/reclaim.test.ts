import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { generateEthKeypair } from '../src/enckeys.ts'
import { jwksFromPrivateKey } from '../src/jwks.ts'
import { generateKeypair } from '../src/keypair.ts'
import { ReclaimVerification } from '../src/reclaim.ts'
import {
	type DeliveryEnvelope,
	encryptForEthPublicKey,
	ResultVerificationError,
	signResultJws,
} from '../src/result.ts'
import { stubFetch } from './fetch.ts'

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}

const BASE = 'https://builder.test'
const TOKEN = 'rorg_test-token'

describe('ReclaimVerification.create', () => {
	it('sessions.create leaves verificationClientUrl to the Builder default',
		async() => {
			const { fetch, calls } = stubFetch(() => jsonResponse({ id: 's-1' }))
			const reclaim = ReclaimVerification.create({
				baseUrl: BASE, orgSecret: TOKEN, fetch,
			})

			await reclaim.sessions.create({
				providers: [{ providerId: 'p-1' }],
				context: {},
			})

			const [{ url, init }] = calls
			assert.equal(url, `${BASE}/verifications/sessions`)
			const body = JSON.parse(String(init.body))
			assert.equal('verificationClientUrl' in body, false)
			const headers = new Headers(init.headers)
			assert.equal(headers.get('authorization'), `Bearer ${TOKEN}`)
		})

	it('sessions.create binds TEE without transmitting the private key',
		async() => {
			const org = generateEthKeypair()
			const sessionId = '0192cc40-5ac0-7d90-8f2a-9b3c4d5e6f7a'
			const orgId = '0192cc40-5ac0-7d90-8f2a-9b3c4d5e6f7b'
			const { fetch, calls } = stubFetch((url) => {
				if(url === `${BASE}/verifications/sessions`) {
					return jsonResponse({ id: sessionId, orgId })
				}

				assert.equal(
					url,
					`${BASE}/verifications/sessions/${sessionId}/tee-nonce`,
				)
				return jsonResponse({
					id: sessionId,
					orgId,
					teeNonceBoundAt: new Date().toISOString(),
				})
			})
			const reclaim = ReclaimVerification.create({
				baseUrl: BASE, orgSecret: TOKEN, fetch,
			})

			await reclaim.sessions.create({
				providers: [{ providerId: 'p-1' }],
				context: {},
				orgEthPrivateKey: org.privateKeyHex,
			})

			assert.equal(calls.length, 2)
			const createBody = JSON.parse(String(calls[0].init.body))
			assert.equal(createBody.orgEthPrivateKey, undefined)
			assert.doesNotMatch(
				String(calls[0].init.body),
				new RegExp(org.privateKeyHex, 'i'),
			)

			const bindBody = JSON.parse(String(calls[1].init.body))
			assert.equal(bindBody.attestationNonceData.sessionId, sessionId)
			assert.match(bindBody.attestationNonceData.timestamp, /^\d+$/)
			assert.equal(
				bindBody.attestationNonceData.applicationId.toLowerCase(),
				org.ethAddress,
			)
			assert.match(bindBody.attestationNonce, /^[0-9a-f]{64}$/)
			assert.match(bindBody.signature, /^0x[0-9a-f]{130}$/)
			assert.doesNotMatch(
				String(calls[1].init.body),
				new RegExp(org.privateKeyHex, 'i'),
			)
		})

	it('flow(session).getUrl() resolves verificationUrl with no network call',
		async() => {
			const verificationUrl = `${BASE}/v/s-1?api=2&sessionId=s-1`
			const { fetch, calls } = stubFetch(() => jsonResponse({
				id: 's-1',
				verificationUrl,
			}))
			const reclaim = ReclaimVerification.create({
				baseUrl: BASE, orgSecret: TOKEN, fetch,
			})

			const session = await reclaim.sessions.create({
				providers: [{ providerId: 'p-1' }],
				context: {},
			})
			assert.equal(calls.length, 1)

			const flow = reclaim.flow(session)
			assert.equal(flow.session, session)
			assert.equal(await flow.getUrl(), verificationUrl)
			assert.equal(
				calls.length, 1, 'flow(session) makes no additional network call',
			)
		})

	it('flow.create() creates a session and wraps its verificationUrl',
		async() => {
			const verificationUrl = `${BASE}/v/s-2?api=2&sessionId=s-2`
			const { fetch, calls } = stubFetch(() => jsonResponse({
				id: 's-2',
				verificationUrl,
			}))
			const reclaim = ReclaimVerification.create({
				baseUrl: BASE, orgSecret: TOKEN, fetch,
			})

			const flow = await reclaim.flow.create({
				providers: [{ providerId: 'p-1' }],
				context: {},
			})

			assert.equal(calls.length, 1)
			assert.equal(flow.session.id, 's-2')
			assert.equal(await flow.getUrl(), verificationUrl)
		})

	it('exports and imports only non-secret configuration', () => {
		const secret = 'rorg_must-not-be-serialized'
		const reclaim = ReclaimVerification.create({
			baseUrl: BASE,
			orgSecret: secret,
			headers: { 'x-private': 'must-not-be-serialized' },
		})
		const serialized = reclaim.export()
		assert.deepEqual(JSON.parse(serialized), { version: 1, baseUrl: BASE })
		assert.doesNotMatch(serialized, /must-not-be-serialized/)

		const restored = ReclaimVerification.import(serialized, {
			orgSecret: TOKEN,
		})
		assert.equal(restored.export(), serialized)
	})

	it('throws a named error when no org secret is configured', () => {
		assert.throws(
			() => ReclaimVerification.create({ baseUrl: BASE } as never),
			/requires an org secret/,
		)
	})

	it('results.receive decrypts an ECIES envelope and verifies via JWKS',
		async() => {
			const vc = generateKeypair()
			const org = generateEthKeypair()
			const sessionId = '0192cc40-5ac0-7d90-8f2a-9b3c4d5e6f7a'
			const verificationClientId =
				'0192cc40-5ac0-7d90-8f2a-9b3c4d5e6f70'

			const payload = {
				reclaimSessionId: sessionId,
				verification_session: {
					status: 'error',
					verification_client_id: verificationClientId,
				},
				results: [],
			}
			const jws = signResultJws(vc.privateKey, payload, `${BASE}`)
			const ciphertext = await encryptForEthPublicKey(
				org.publicJwk,
				new TextEncoder().encode(JSON.stringify(jws)),
			)
			const envelope: DeliveryEnvelope = {
				sessionId,
				event: 'verification_error',
				timestamp: new Date().toISOString(),
				data: ciphertext,
			}

			// Serve Builder's trusted result-signing key.
			const { fetch } = stubFetch((url) => {
				assert.equal(url, `${BASE}/.well-known/jwks.json`)
				return jsonResponse(jwksFromPrivateKey(vc.privateKey))
			})
			const reclaim = ReclaimVerification.create({
				baseUrl: BASE, orgSecret: TOKEN, fetch,
			})

			// All accepted shapes: parsed envelope, JSON text, raw bytes, bare ct.
			for(const body of [
				envelope,
				JSON.stringify(envelope),
				new TextEncoder().encode(JSON.stringify(envelope)),
				ciphertext,
			]) {
				const received = await reclaim.results.receive(body, {
					orgEthPrivateKey: org.privateKeyHex,
					reclaimSessionId: sessionId,
				})
				assert.ok(received.kind === 'result')
				assert.equal(received.result.reclaimSessionId, sessionId)
			}
		})

	it('results.receive handles a plaintext (unencrypted) JWS delivery',
		async() => {
			// Without an org encryption key, `data` is plaintext JWS JSON.
			const vc = generateKeypair()
			const sessionId = '0192cc40-5ac0-7d90-8f2a-9b3c4d5e6f7b'
			const verificationClientId =
				'0192cc40-5ac0-7d90-8f2a-9b3c4d5e6f70'
			const jws = signResultJws(
				vc.privateKey,
				{
					reclaimSessionId: sessionId,
					verification_session: {
						verification_client_id: verificationClientId,
						status: 'error',
					},
					results: [],
				},
				BASE,
			)
			const envelope: DeliveryEnvelope = {
				sessionId,
				event: 'verification_error',
				timestamp: new Date().toISOString(),
				data: JSON.stringify(jws),
			}
			const { fetch } = stubFetch(() => {
				return jsonResponse(jwksFromPrivateKey(vc.privateKey))
			})
			const reclaim = ReclaimVerification.create({
				baseUrl: BASE, orgSecret: TOKEN, fetch,
			})

			const received = await reclaim.results.receive(envelope, {
				reclaimSessionId: sessionId,
			})
			assert.ok(received.kind === 'result')
		})

	it('results.receive throws an error on an encrypted delivery with no key',
		async() => {
			const vc = generateKeypair()
			const org = generateEthKeypair()
			const jws = signResultJws(vc.privateKey, { reclaimSessionId: 's' }, BASE)
			const ciphertext = await encryptForEthPublicKey(
				org.publicJwk,
				new TextEncoder().encode(JSON.stringify(jws)),
			)
			const reclaim = ReclaimVerification.create({
				baseUrl: BASE, orgSecret: TOKEN,
			})
			await assert.rejects(
				() => reclaim.results.receive(ciphertext),
				/no org ETH private key was provided/,
			)
		})

	it('results.receive returns a non-terminal event as a plaintext payload',
		async() => {
			const reclaim = ReclaimVerification.create({
				baseUrl: BASE, orgSecret: TOKEN,
			})
			const envelope: DeliveryEnvelope = {
				sessionId: '0192cc40-5ac0-7d90-8f2a-9b3c4d5e6f7a',
				event: 'request_matched',
				timestamp: new Date().toISOString(),
				data: Buffer.from(
					JSON.stringify({
						event: 'request_matched',
						eventData: { request_id: 'r1' },
					}),
				).toString('base64'),
			}
			const received = await reclaim.results.receive(envelope)
			assert.ok(received.kind === 'event')
			assert.equal(received.event, 'request_matched')
			assert.deepEqual(received.eventData, { request_id: 'r1' })
		})

	it('results.receive rejects a session-id mismatch', async() => {
		const vc = generateKeypair()
		const org = generateEthKeypair()
		const jws = signResultJws(
			vc.privateKey,
			{ reclaimSessionId: 'other-session' },
			BASE,
		)
		const ciphertext = await encryptForEthPublicKey(
			org.publicJwk,
			new TextEncoder().encode(JSON.stringify(jws)),
		)

		const { fetch } = stubFetch(
			() => jsonResponse(jwksFromPrivateKey(vc.privateKey)),
		)
		const reclaim = ReclaimVerification.create({
			baseUrl: BASE, orgSecret: TOKEN, fetch,
		})

		// An invalid result throws (carrying the outcome) rather than returning it.
		await assert.rejects(
			() => reclaim.results.receive(ciphertext, {
				orgEthPrivateKey: org.privateKeyHex,
				reclaimSessionId: 'expected-session',
				trustedIssuers: [BASE],
			}),
			(err: unknown) => {
				assert.ok(err instanceof ResultVerificationError)
				assert.equal(err.reason, 'reclaimSessionId-mismatch')
				assert.equal(err.outcome.payload.reclaimSessionId, 'other-session')
				return true
			},
		)
	})
})
