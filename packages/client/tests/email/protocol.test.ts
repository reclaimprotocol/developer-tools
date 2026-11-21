// Ported from the email core's email-protocol and email-proof-contract tests.
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import {
	canonicalJson,
	EMAIL_PROOF_LIMIT,
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
