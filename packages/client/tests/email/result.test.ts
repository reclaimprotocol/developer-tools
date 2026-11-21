import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { EmailProofV1 } from '../../src/email/core/contracts.ts'
import type { EmailRequest } from '../../src/email/core/protocol.ts'
import {
	generateKeypair,
	ReclaimVerification,
	type ResultProofOutcome,
	ResultVerificationError,
	signResultJws,
	verifyResultFull,
	type VerifyResultFullOptions,
} from '../../src/index.ts'
import { jwksFromPrivateKey } from '../../src/jwks.ts'
import { stubFetch } from '../fetch.ts'
import { emailProof, emailRequest, ISSUER } from './fixtures.ts'

const BUILDER = generateKeypair()
const ISS = 'https://builder.example'

describe('email results from AI sessions', () => {
	it('verifies an email entry with issuers from the Builder JWKS', async() => {
		const request = emailRequest()
		const { fetch, calls } = builderJwks([ISSUER.address])
		const { proofs } = await verifyResultFull(
			signed(emailEntry(emailProof({ request }), request)),
			{ trustedIssuers: [ISS], fetchImpl: fetch, reclaimSessionId: 'rs-1' },
		)
		assert.equal(calls.length, 1)
		assert.equal(proofs?.length, 1)
		assert.deepEqual(pick(proofs?.[0]), {
			requestId: 'email-1',
			method: 'email',
			proofValid: true,
			emailProvider: 'gmail',
			sender: 'regex:.*@shop[.]example',
			dkimSigner: 'shop.example',
			authenticatedAddress: 'alice@gmail.com',
			extractedParameters: { total: '12' },
			emailCheck: 'signature',
		})
	})

	it('trusts issuers passed in emailIssuers', async() => {
		const request = emailRequest()
		const { proofs } = await verifyResultFull(
			signed(emailEntry(emailProof({ request }), request)),
			{
				signerPublicKey: BUILDER.publicKey,
				emailIssuers: [ISSUER.address],
			},
		)
		assert.equal(proofs?.[0]?.proofValid, true)
	})

	it('rejects an email issuer that nobody trusts', async() => {
		const request = emailRequest()
		const { fetch } = builderJwks([])
		await rejectsWith(
			signed(emailEntry(emailProof({ request }), request)),
			{ trustedIssuers: [ISS], fetchImpl: fetch },
			'email-issuer-not-trusted',
		)
	})

	it('rejects a proof that does not answer the entry request', async() => {
		const request = emailRequest()
		const other = { ...request, nonce: 'c'.repeat(32) }
		await rejectsWith(
			signed(emailEntry(emailProof({ request }), other)),
			{ signerPublicKey: BUILDER.publicKey, emailIssuers: [ISSUER.address] },
			'email-proof-invalid',
		)
	})

	it(
		'reports full verification as unavailable without the sandbox',
		{ skip: process.platform === 'linux' },
		async() => {
			const request = emailRequest()
			await rejectsWith(
				signed(emailEntry(emailProof({ request }), request)),
				{
					signerPublicKey: BUILDER.publicKey,
					emailIssuers: [ISSUER.address],
					emailVerification: 'full',
				},
				'email-full-verification-unavailable',
			)
		},
	)

	it('rejects an email entry without the email request', async() => {
		const request = emailRequest()
		const [item] = emailEntry(emailProof({ request }), request).requests
		const { provider, sender, dkimSigner } = item.email
		await rejectsWith(
			signed({
				requests: [{ ...item, email: { provider, sender, dkimSigner } }],
			}),
			{ signerPublicKey: BUILDER.publicKey, emailIssuers: [ISSUER.address] },
			'email-proof-invalid',
		)
	})

	it('rejects entry names that differ from the verified proof', async() => {
		const request = emailRequest()
		const entry = emailEntry(emailProof({ request }), request)
		entry.requests[0].email.dkimSigner = 'other.example'
		await rejectsWith(
			signed(entry),
			{ signerPublicKey: BUILDER.publicKey, emailIssuers: [ISSUER.address] },
			'email-proof-invalid',
		)
	})

	it('rejects email entries when the caller pins proof hashes', async() => {
		const request = emailRequest()
		const jws = signed(emailEntry(emailProof({ request }), request))
		const opts = {
			signerPublicKey: BUILDER.publicKey,
			emailIssuers: [ISSUER.address],
			hashes: ['0x' + '0'.repeat(64)],
		}
		await rejectsWith(jws, opts, 'email-not-allowed')
		const { proofs } = await verifyResultFull(
			jws,
			{ ...opts, allowEmailProofs: true },
		)
		assert.equal(proofs?.[0]?.proofValid, true)
	})

	it('checks email proof expiry at the time Builder signed', async() => {
		// The proof expired an hour after it was issued, over an hour ago.
		const request = emailRequest(Date.now() - 3 * 3600_000)
		const proof = emailProof({ request })
		const issuedAtS = Math.floor(request.createdAt / 1000) + 1
		const opts = {
			signerPublicKey: BUILDER.publicKey,
			emailIssuers: [ISSUER.address],
		}
		const { proofs } = await verifyResultFull(
			signed(emailEntry(proof, request), { iat: issuedAtS + 60 }),
			opts,
		)
		assert.equal(proofs?.[0]?.proofValid, true)
		await rejectsWith(
			signed(emailEntry(proof, request), { iat: issuedAtS + 7200 }),
			opts,
			'email-proof-invalid',
		)
		// Without `iat`, the current time applies.
		await rejectsWith(
			signed(emailEntry(proof, request)),
			opts,
			'email-proof-invalid',
		)
	})

	it('throws on a malformed emailIssuers address', async() => {
		const request = emailRequest()
		await assert.rejects(
			verifyResultFull(
				signed(emailEntry(emailProof({ request }), request)),
				{ signerPublicKey: BUILDER.publicKey, emailIssuers: ['issuer'] },
			),
			(error: unknown) => {
				assert.ok(!(error instanceof ResultVerificationError))
				assert.match(String(error), /invalid email issuer address/)
				return true
			},
		)
	})

	it('verifies email entries through results.receive', async() => {
		const request = emailRequest()
		const jws = signed(emailEntry(emailProof({ request }), request))
		const { fetch } = builderJwks([ISSUER.address])
		const reclaim = ReclaimVerification.create({
			orgSecret: 'rorg_test',
			baseUrl: ISS,
			fetch,
		})
		const received = await reclaim.results.receive(
			{
				sessionId: 'rs-1',
				event: 'verification_success',
				data: JSON.stringify(jws),
			},
			{ reclaimSessionId: 'rs-1' },
		)
		assert.equal(received.kind, 'result')
		assert.equal(received.result.proofs?.[0]?.emailProvider, 'gmail')
	})
})

function emailEntry(proof: EmailProofV1, request: EmailRequest) {
	return {
		requests: [{
			request_id: 'email-1',
			method: 'email',
			proof,
			email: {
				provider: request.provider,
				sender: request.policy.sender,
				dkimSigner: proof.emailProof.acceptedDkimSignature.signingDomain,
				request,
			},
		}],
	}
}

function signed(
	entry: Record<string, unknown>,
	claims: Record<string, unknown> = {},
) {
	return signResultJws(BUILDER.privateKey, {
		...claims,
		reclaimSessionId: 'rs-1',
		verification_session: { status: 'success', providers: [] },
		results: [entry],
	}, ISS)
}

function builderJwks(emailIssuers: string[]) {
	return stubFetch(() => Response.json({
		...jwksFromPrivateKey(BUILDER.privateKey),
		'x-reclaim-email-issuers': emailIssuers,
	}))
}

function pick(outcome: ResultProofOutcome | undefined) {
	assert.ok(outcome)
	const { emailProof: _proof, providerId, resolvedVersion, ...rest } = outcome
	assert.ok(_proof)
	assert.equal(providerId, undefined)
	assert.equal(resolvedVersion, undefined)
	return rest
}

async function rejectsWith(
	jws: ReturnType<typeof signResultJws>,
	opts: VerifyResultFullOptions,
	proofReason: string,
) {
	await assert.rejects(verifyResultFull(jws, opts), (error: unknown) => {
		assert.ok(error instanceof ResultVerificationError)
		assert.equal(error.reason, 'invalid-proof')
		// Only a host that can't run full verification may get a redelivery.
		assert.equal(
			error.retryable,
			proofReason === 'email-full-verification-unavailable',
		)
		assert.equal(error.outcome.proofs?.[0]?.reason, proofReason)
		return true
	})
}
