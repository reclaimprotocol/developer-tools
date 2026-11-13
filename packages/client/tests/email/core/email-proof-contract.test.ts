/* eslint-disable @stylistic/max-len -- ported from the email core's test suite; kept close to upstream so the two can be compared */
import {
	EMAIL_PROOF_LIMIT,
	normalizeEmailPolicy,
	snapshotEmailProof,
	validateEmailRequest,
} from '../../../src/email/core/protocol.ts'
import { describe, expect, test, vi } from './vitest-compat.ts'
const hash = 'a'.repeat(64),
	address = '0x' + '1'.repeat(40)
function proof() {
	return {
		proofType: 'email-v1',
		identifier: '0x' + hash,
		claimData: {
			provider: 'email',
			parameters: '{}',
			context: '{}',
			owner: address,
			timestampS: 1000,
			identifier: '0x' + hash,
			epoch: 1,
		},
		signatures: ['0x' + '1'.repeat(130)],
		issuer: { type: 'reclaim-portal', address },
		extractedParameterValues: { value: '1' },
		emailProof: {
			version: 1,
			source: { kind: 'raw-rfc822-v1', rawEmailBase64: 'YQ==' },
			rawEmailSha256: hash,
			authenticatedAddress: 'a@example.com',
			policyVersion: 'email-dkim-v5',
			textPolicyVersion: 'email-text-v1',
			acceptedDkimSignature: {
				headerIndex: 0,
				signingDomain: 'example.com',
				selector: 'fixture',
				signatureSha256: hash,
				headerCanonicalization: 'relaxed',
				bodyCanonicalization: 'relaxed',
			},
			contentScope: 'body-only',
			sourceManifest: [{ id: 'body:0', kind: 'body', textSha256: hash }],
			aiContentCheck: {
				outcome: 'pass',
				promptVersion: 'email-content-v10',
				model: 'synthetic',
				inputSha256: hash,
				reviewedSourceIds: ['body:0'],
			},
			evidence: {
				value: {
					sourceId: 'body:0',
					sourceSha256: hash,
					quoteStart: 0,
					quoteEnd: 1,
					quote: '1',
					valueStart: 0,
					valueEnd: 1,
					transform: 'verbatim',
				},
			},
		},
	}
}

describe('bounded email proof transport', () => {
	test('returns a defensive copy and never invokes input accessors', () => {
		const input = proof(),
			copied = snapshotEmailProof(input)
		input.extractedParameterValues.value = '999'
		expect(copied.extractedParameterValues.value).toBe('1')
		const getter = vi.fn(() => 'email-v1')
		Object.defineProperty(input, 'proofType', { enumerable: true, get: getter })
		expect(() => snapshotEmailProof(input)).toThrow()
		expect(getter).not.toHaveBeenCalled()
	})
	test('rejects oversized traversal, unknown source kinds and extra fields', () => {
		const input = proof()
		input.emailProof.source.rawEmailBase64 = 'a'.repeat(EMAIL_PROOF_LIMIT + 1)
		expect(() => snapshotEmailProof(input)).toThrow()
		const other = proof()
		other.emailProof.source.kind = 'future-zk'
		expect(() => snapshotEmailProof(other)).toThrow()
		expect(() => snapshotEmailProof({ ...proof(), witnesses: [] })).toThrow()
		expect(() => snapshotEmailProof({ ...proof(), proofType: undefined }),
		).toThrow()
	})
})
test('email caller context cannot inject legacy bypass or session/attestation fields', () => {
	const sessionId = '1'.repeat(48),
		createdAt = Date.now()
	// Contract change in this copy: the request names its email provider.
	const request = {
		method: 'email',
		version: 1,
		appId: address,
		provider: 'gmail',
		sessionId,
		nonce: '2'.repeat(48),
		createdAt,
		expiresAt: createdAt + 600000,
		policy: normalizeEmailPolicy({
			sender: 'regex:a@example[.]com',
			allowedDkimSigningDomains: ['regex:example[.]com'],
			params: [{ name: 'value', instructions: 'Find the value.' }],
		}),
		callbackUrl: `https://api.example.com/api/email/requests/${sessionId}/callback`,
		cancelCallbackUrl: `https://api.example.com/api/email/requests/${sessionId}/error-callback`,
		jsonProofResponse: true,
		emailApiUrl: 'https://api.example.com',
		emailPortalUrl: 'https://portal.example.com/email',
	}
	expect(() => validateEmailRequest({
		...request,
		context: { transaction: 'private-order' },
	}),
	).not.toThrow()
	for(const key of [
		'isAiProof',
		'isPortalProof',
		'providerHash',
		'proofType',
		'verificationMethod',
		'emailProof',
		'reclaimSessionId',
		'attestationNonce',
		'extractedParameters',
	]) {
		expect(() => validateEmailRequest({ ...request, context: { [key]: true } }),
		).toThrow()
	}
})
