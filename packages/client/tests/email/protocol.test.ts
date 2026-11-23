// Ported from the email core's email-protocol and email-proof-contract tests.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it, mock } from 'node:test'
import {
	canonicalJson,
	EMAIL_PROOF_LIMIT,
	redirectEndpoint,
	snapshotEmailProof,
	strictJson,
	validateEmailRequest,
} from '../../src/email/core/protocol.ts'
import { emailProof, emailRequest } from './fixtures.ts'

describe('strictJson', () => {
	const rejected = [
		'{"a":1,"a":2}',
		'{"a":{"x":1,"x":2}}',
		'{"__proto__":{}}',
		'{"prototype":1}',
		'{"constructor":1}',
		'//comment\n{}',
		'{"a":1,}',
		'{} trailing',
		'',
		'NaN',
		'{"s":"\\ud800"}',
		'{"n":1e999}',
	]
	for(const input of rejected) {
		it(`rejects ${JSON.stringify(input)}`, () => {
			assert.throws(() => strictJson(input))
		})
	}

	it('preserves JCS data and rejects deep or oversized payloads', () => {
		assert.equal(canonicalJson(strictJson('{"b":2,"a":1}')), '{"a":1,"b":2}')
		assert.throws(() => strictJson('['.repeat(21) + '0' + ']'.repeat(21)))
		assert.throws(() => strictJson('"' + 'a'.repeat(65536) + '"'))
	})
})

describe('snapshotEmailProof', () => {
	it('returns a defensive copy and never invokes accessors', () => {
		const input = emailProof()
		const copied = snapshotEmailProof(input)
		input.extractedParameterValues.total = '999'
		assert.equal(copied.extractedParameterValues.total, '12')

		const getter = mock.fn(() => 'email-v1')
		Object.defineProperty(input, 'proofType', { enumerable: true, get: getter })
		assert.throws(() => snapshotEmailProof(input))
		assert.equal(getter.mock.callCount(), 0)
	})

	it('rejects oversized input, unknown source kinds, and extra fields', () => {
		const oversized = emailProof()
		oversized.emailProof.source.rawEmailBase64 =
			'a'.repeat(EMAIL_PROOF_LIMIT + 1)
		assert.throws(() => snapshotEmailProof(oversized))
		assert.throws(() => snapshotEmailProof({
			...emailProof(),
			emailProof: {
				...emailProof().emailProof,
				source: { kind: 'future-zk', rawEmailBase64: 'YQ==' },
			},
		}))
		assert.throws(() => snapshotEmailProof({ ...emailProof(), witnesses: [] }))
		assert.throws(() => snapshotEmailProof({
			...emailProof(),
			proofType: undefined,
		}))
	})

	it('rejects the pre-rename authenticatedGmailAddress field', () => {
		const { emailProof: email, ...rest } = emailProof()
		const { authenticatedAddress, ...legacy } = email
		assert.throws(() => snapshotEmailProof({
			...rest,
			emailProof: {
				...legacy,
				authenticatedGmailAddress: authenticatedAddress,
			},
		}))
	})
})

describe('validateEmailRequest', () => {
	it('requires a known provider', () => {
		const request = emailRequest()
		assert.equal(validateEmailRequest(request).provider, 'gmail')
		const { provider: _provider, ...withoutProvider } = request
		assert.ok(_provider)
		assert.throws(() => validateEmailRequest(withoutProvider))
		assert.throws(() => validateEmailRequest({ ...request, provider: 'imap' }))
	})

	it('rejects context keys that could forge proof or session fields', () => {
		const request = emailRequest()
		assert.doesNotThrow(() => validateEmailRequest({
			...request,
			context: { transaction: 'private-order' },
		}))
		const forbidden = [
			'isAiProof',
			'isPortalProof',
			'providerHash',
			'proofType',
			'verificationMethod',
			'emailProof',
			'reclaimSessionId',
			'attestationNonce',
			'extractedParameters',
		]
		for(const key of forbidden) {
			assert.throws(
				() => validateEmailRequest({ ...request, context: { [key]: true } }),
				Error,
				key,
			)
		}
	})
})

describe('email redirect fields', () => {
	const sessionId = '3f2b8c1e-5a47-4d9e-8f10-2c6a9b7d4e11'
	const base = emailRequest()
	const withRedirects = () => ({
		...base,
		redirectUrl: 'https://builder.example/share/abc?x=1',
		cancelRedirectUrl: 'https://builder.example/share/abc?result=failed',
		builder: { sessionId, verificationClientId: sessionId },
	})
	const hash = (v: unknown) => createHash('sha256')
		.update(canonicalJson(v))
		.digest('hex')

	it('accepts the fields and keeps the request hash stable', () => {
		const accepted = validateEmailRequest(withRedirects())
		assert.equal(accepted.redirectUrl, 'https://builder.example/share/abc?x=1')
		assert.equal(accepted.builder?.sessionId, sessionId)
		assert.equal(hash(accepted), hash(validateEmailRequest(withRedirects())))
		// the fields are signed: changing one changes the hash
		assert.notEqual(
			hash(accepted),
			hash({ ...accepted, redirectUrl: 'https://other.example/' }),
		)
	})

	it('rejects unsafe redirect URLs', () => {
		const bad = [
			'https://user:pw@builder.example/x',
			'javascript:alert(1)',
			'http://builder.example/x',
			'https://builder.example/x#frag',
			'not a url',
		]
		for(const url of bad) {
			assert.throws(
				() => validateEmailRequest({ ...withRedirects(), redirectUrl: url }),
				/INVALID_EMAIL_REDIRECT/,
			)
			assert.throws(
				() => validateEmailRequest({
					...withRedirects(),
					cancelRedirectUrl: url,
				}),
				/INVALID_EMAIL_REDIRECT/,
			)
		}
	})

	it('allows loopback http only when local is allowed', () => {
		const request = {
			...withRedirects(),
			redirectUrl: 'http://localhost:3000/x',
		}
		assert.throws(
			() => validateEmailRequest(request),
			/INVALID_EMAIL_REDIRECT/,
		)
		assert.equal(
			validateEmailRequest(request, true).redirectUrl,
			'http://localhost:3000/x',
		)
		assert.equal(
			redirectEndpoint('http://127.0.0.1:1/a?b=c', true),
			'http://127.0.0.1:1/a?b=c',
		)
	})

	it('rejects redirect URLs longer than 2048 characters', () => {
		const long = `https://builder.example/${'a'.repeat(2048)}`
		assert.throws(() => redirectEndpoint(long), /INVALID_EMAIL_REDIRECT/)
		assert.throws(() => validateEmailRequest({
			...withRedirects(),
			redirectUrl: long,
		}))
	})

	it('rejects redirect URLs that are not in canonical href form', () => {
		for(const url of ['https://builder.example', 'https://Builder.example/']) {
			assert.equal(redirectEndpoint(url), 'https://builder.example/')
			assert.throws(
				() => validateEmailRequest({ ...withRedirects(), redirectUrl: url }),
				/INVALID_EMAIL_REDIRECT/,
			)
		}
	})

	it('requires builder.sessionId to be a UUID', () => {
		assert.throws(() => validateEmailRequest({
			...withRedirects(),
			builder: { sessionId: 'not-a-uuid' },
		}))
		assert.throws(() => validateEmailRequest({
			...withRedirects(),
			builder: { sessionId, extra: 1 },
		}))
	})
})
