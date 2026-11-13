/* eslint-disable @stylistic/max-len */
/** Browser-safe envelope validation; no signing keys, DNS or model dependencies. */
import { z } from 'zod'
import type { EmailProofV1 } from './contracts.ts'
import { emailProviderSchema } from './providers.ts'
import { emailContentScopeSchema, fieldEvidenceSchema } from './schemas.ts'

export const EMAIL_PROOF_LIMIT = 12 * 1024 * 1024
export const EMAIL_RESULT_TTL_S = 3600
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const identifier = z.string().regex(/^0x[0-9a-f]{64}$/)
const seconds = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const field = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/)
const sourceId = z.string().regex(/^(body|attachment):\d{1,6}$/)
export const emailProofParametersSchema = z.strictObject({
	proofType: z.literal('email-v1'),
	appId: address,
	sessionId: z.string().regex(/^[a-f0-9]{32,64}$/),
	requestHash: digest,
	requestNonce: z.string().regex(/^[a-f0-9]{32,64}$/),
	sender: z.string().max(320),
	emailProvider: emailProviderSchema,
	sourceKind: z.literal('raw-rfc822-v1'),
	emailProofSha256: digest,
	issuedAtS: seconds,
	expiresAtS: seconds,
	consentVersion: z.literal('full-email-v1'),
})
export const emailProofSchema = z.strictObject({
	proofType: z.literal('email-v1'),
	identifier,
	claimData: z.strictObject({
		provider: z.literal('email'),
		parameters: z.string().max(4096),
		context: z.string().max(65536),
		owner: address,
		timestampS: z.number().int().min(-2208988800).max(253402300799),
		identifier,
		epoch: z.literal(1),
	}),
	signatures: z.tuple([z.string().regex(/^0x[0-9a-fA-F]{130}$/)]),
	issuer: z.strictObject({ type: z.literal('reclaim-portal'), address }),
	extractedParameterValues: z.record(field, z.string().min(1).max(1024)),
	emailProof: z.strictObject({
		version: z.literal(1),
		source: z.strictObject({
			kind: z.literal('raw-rfc822-v1'),
			rawEmailBase64: z.string().min(4).max(11184812),
		}),
		rawEmailSha256: digest,
		authenticatedAddress: z.string().min(1).max(254),
		policyVersion: z.literal('email-dkim-v5'),
		textPolicyVersion: z.literal('email-text-v1'),
		acceptedDkimSignature: z.strictObject({
			headerIndex: z.number().int().min(0).max(10000),
			signingDomain: z.string().min(1).max(255),
			selector: z.string().min(1).max(255),
			signatureSha256: digest,
			headerCanonicalization: z.enum(['simple', 'relaxed']),
			bodyCanonicalization: z.enum(['simple', 'relaxed']),
		}),
		contentScope: emailContentScopeSchema,
		sourceManifest: z
			.array(
				z.strictObject({
					id: sourceId,
					kind: z.enum(['body', 'attachment']),
					textSha256: digest,
					attachmentSha256: digest.optional(),
				}),
			)
			.min(1)
			.max(1000),
		aiContentCheck: z.strictObject({
			outcome: z.literal('pass'),
			promptVersion: z.literal('email-content-v10'),
			model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/),
			inputSha256: digest,
			reviewedSourceIds: z.array(sourceId).min(1).max(1000),
		}),
		evidence: z.record(field, fieldEvidenceSchema),
	}),
})
/** Bound traversal before copying; never invoke accessors/toJSON or retain caller data. */
export function snapshotEmailProof(input: unknown): EmailProofV1 {
	let nodes = 0,
		bytes = 0
	function copy(value: unknown, depth = 0): unknown {
		if(++nodes > 30000 || depth > 16) {
			throw new Error('INVALID_EMAIL_PROOF')
		}

		if(typeof value === 'string') {
			if(value.length > EMAIL_PROOF_LIMIT) {
				throw new Error('INVALID_EMAIL_PROOF')
			}

			bytes += new TextEncoder().encode(value).length
			if(
				bytes > EMAIL_PROOF_LIMIT ||
				/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
					value,
				)
			) {
				throw new Error('INVALID_EMAIL_PROOF')
			}

			return value
		}

		if(
			value === null ||
			typeof value === 'boolean' ||
			(typeof value === 'number' && Number.isFinite(value))
		) {
			return value
		}

		if(
			!value ||
			typeof value !== 'object' ||
			(!Array.isArray(value) &&
				![Object.prototype, null].includes(Object.getPrototypeOf(value)))
		) {
			throw new Error('INVALID_EMAIL_PROOF')
		}

		const out: Record<string, unknown> = Object.create(null)
		for(const key of Reflect.ownKeys(value)) {
			if(Array.isArray(value) && key === 'length') {
				continue
			}

			if(
				typeof key !== 'string' ||
				['__proto__', 'constructor', 'prototype'].includes(key) ||
				key.length > 256
			) {
				throw new Error('INVALID_EMAIL_PROOF')
			}

			const d = Object.getOwnPropertyDescriptor(value, key)!
			if(!d.enumerable || !('value' in d)) {
				throw new Error('INVALID_EMAIL_PROOF')
			}

			out[key] = copy(d.value, depth + 1)
		}

		if(!Array.isArray(value)) {
			return out
		}

		if(
			Object.keys(out).length !== value.length ||
			Object.keys(out).some((k, i) => k !== String(i))
		) {
			throw new Error('INVALID_EMAIL_PROOF')
		}

		return Object.values(out)
	}

	return emailProofSchema.parse(copy(input))
}
