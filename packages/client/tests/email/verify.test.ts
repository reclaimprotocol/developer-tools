import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canonicalJson as clientCanonicalJson } from '../../src/canonical.ts'
import type { EmailProofV1 } from '../../src/email/core/contracts.ts'
import { canonicalJson } from '../../src/email/core/protocol.ts'
import { verifyEmailProof } from '../../src/email/index.ts'
import { generateKeypair } from '../../src/index.ts'
import {
	emailProof,
	emailRequest,
	ISSUER,
	RAW_EMAIL,
	sha256Hex,
} from './fixtures.ts'

const trustedIssuers = [ISSUER.address.toUpperCase().replace('0X', '0x')]

describe('verifyEmailProof in signature mode', () => {
	it('accepts a proof signed by a trusted issuer', async() => {
		const request = emailRequest()
		const outcome = await verifyEmailProof(emailProof({ request }), {
			trustedIssuers,
			request,
		})
		assert.deepEqual(outcome, {
			issuer: ISSUER.address,
			emailProvider: 'gmail',
			sender: 'regex:.*@shop[.]example',
			dkimSigner: 'shop.example',
			authenticatedAddress: 'alice@gmail.com',
			extractedParameters: { total: '12' },
			emailCheck: 'signature',
		})
	})

	it('accepts a proof without a request', async() => {
		const outcome = await verifyEmailProof(emailProof(), { trustedIssuers })
		assert.equal(outcome.emailCheck, 'signature')
	})

	it('rejects tampered signed parameters', async() => {
		const proof = emailProof()
		const parameters = JSON.parse(proof.claimData.parameters)
		proof.claimData.parameters = canonicalJson({ ...parameters, sender: 'x' })
		await rejectsWith(proof, 'email-proof-invalid')
	})

	it('rejects extracted values that differ from the context', async() => {
		const proof = emailProof()
		proof.extractedParameterValues.total = '9999'
		await rejectsWith(proof, 'email-proof-invalid')
	})

	it('rejects a proof from an issuer that is not trusted', async() => {
		const other = generateKeypair()
		await rejectsWith(
			emailProof({ signerKey: other.privateKey }),
			'email-issuer-not-trusted',
		)
		await rejectsWith(emailProof(), 'email-issuer-not-trusted', {
			trustedIssuers: [],
		})
	})

	it('throws on a malformed trusted issuer address', async() => {
		await assert.rejects(
			verifyEmailProof(emailProof(), {
				trustedIssuers: [...trustedIssuers, '0x1234'],
			}),
			/invalid email issuer address/,
		)
	})

	it('rejects a signature from a key other than the issuer', async() => {
		const proof = emailProof({ signerKey: generateKeypair().privateKey })
		proof.issuer.address = ISSUER.address
		await rejectsWith(proof, 'email-proof-invalid')
	})

	it('rejects a changed email proof or raw email', async() => {
		const changed = emailProof()
		changed.emailProof.authenticatedAddress = 'mallory@gmail.com'
		await rejectsWith(changed, 'email-proof-invalid', undefined, /proof digest/)

		const raw = Buffer.from(RAW_EMAIL)
		raw[raw.length - 3] = 0x39
		const rawChanged = emailProof({
			editEmailProof: (email) => {
				email.source.rawEmailBase64 = raw.toString('base64')
			},
		})
		await rejectsWith(rawChanged, 'email-proof-invalid', undefined, /raw email/)
	})

	it('rejects an emailProofSha256 that does not match', async() => {
		await rejectsWith(
			emailProof({ parameters: { emailProofSha256: sha256Hex('other') } }),
			'email-proof-invalid',
			undefined,
			/proof digest/,
		)
	})

	it('rejects an expired proof', async() => {
		const request = emailRequest(Date.now() - 2 * 3600_000)
		await rejectsWith(emailProof({ request }), 'email-proof-invalid')
		const fresh = emailProof()
		const { expiresAtS } = JSON.parse(fresh.claimData.parameters)
		await rejectsWith(fresh, 'email-proof-invalid', {
			trustedIssuers,
			now: expiresAtS,
		}, /expired/)
	})

	it('rejects a provider that differs from the request', async() => {
		const request = emailRequest()
		const proof = emailProof({
			request,
			parameters: { emailProvider: 'outlook' },
		})
		await rejectsWith(proof, 'email-proof-invalid', {
			trustedIssuers,
			request,
		})
		// The proof's provider must also be one this client knows.
		await rejectsWith(proof, 'email-proof-invalid')
	})

	it('rejects a proof for a different request', async() => {
		const proof = emailProof()
		const other = { ...emailRequest(), nonce: 'c'.repeat(32) }
		await rejectsWith(proof, 'email-proof-invalid', {
			trustedIssuers,
			request: other,
		}, /does not answer this request/)
		const request = emailRequest()
		await rejectsWith(emailProof({ request }), 'email-proof-invalid', {
			trustedIssuers,
			request: { ...request, context: { orderId: 'order-2' } },
		}, /does not answer this request/)
	})
})

describe('verifyEmailProof in full mode', () => {
	it('requires the email request', async() => {
		await rejectsWith(emailProof(), 'email-request-required', {
			trustedIssuers,
			mode: 'full',
		})
	})

	it(
		'refuses to run without the Linux sandbox instead of downgrading',
		{ skip: process.platform === 'linux' },
		async() => {
			const request = emailRequest()
			await rejectsWith(
				emailProof({ request }),
				'email-full-verification-unavailable',
				{ trustedIssuers, request, mode: 'full' },
			)
		},
	)
})

describe('email canonical JSON', () => {
	it('matches the client canonicalJson on tricky inputs', () => {
		// Line separator, DEL, and byte-order mark, built from code points.
		const [lineSeparator, del, bom] = [0x2028, 0x7f, 0xfeff]
			.map((code) => String.fromCodePoint(code))
		const inputs = [
			{ b: 1, a: [3, { d: 1e21, c: -0 }], é: 'ü' + lineSeparator, '': null },
			{ n: 0.1 + 0.2, big: 2 ** 53 + 2, small: 1e-7, e: 'line\n"q"' },
			['😀', del, bom, { z: true, y: false }],
		]
		for(const input of inputs) {
			assert.equal(canonicalJson(input), clientCanonicalJson(input))
		}
	})
})

async function rejectsWith(
	proof: EmailProofV1,
	reason: string,
	opts?: Parameters<typeof verifyEmailProof>[1],
	message?: RegExp,
) {
	const options = opts ?? { trustedIssuers }
	await assert.rejects(verifyEmailProof(proof, options), (error: unknown) => {
		assert.ok(error instanceof Error)
		assert.ok('reason' in error)
		assert.equal(error.reason, reason, error.message)
		if(message) {
			assert.match(error.message, message)
		}

		return true
	})
}
