/* eslint-disable @stylistic/max-len */
/** Lightweight, browser-safe protocol. No verifier, worker, Google client or configuration imports. */
import { visit } from 'jsonc-parser'
import { z } from 'zod'
import type { NormalizedEmailPolicy } from './contracts.ts'
import {
	canonicalJson as jcs,
	copyNormalizedPolicy,
	plainCopy,
} from './policy-data.ts'
import { type EmailProvider, emailProviderSchema } from './providers.ts'
import { normalizedEmailPolicySchema } from './schemas.ts'
export {
	EMAIL_PROVIDERS,
	type EmailProvider,
	emailProviderSchema,
} from './providers.ts'
export { plainCopy, normalizeEmailPolicy } from './policy-data.ts'
export {
	parseEmailSender,
	matchesEmailSender,
	matchesEmailDomain,
} from './sender.ts'
export function canonicalJson(value: unknown): string {
	return jcs(value, -4)
}

export const EMAIL_REQUEST_TTL_MS = 600_000
export const EMAIL_REQUEST_LIMIT = 65_536
export {
	emailProofSchema,
	emailProofParametersSchema,
	snapshotEmailProof,
	EMAIL_PROOF_LIMIT,
	EMAIL_RESULT_TTL_S,
} from './proof-contract.ts'
const forbidden = new Set(['__proto__', 'constructor', 'prototype'])
export function strictJson(text: string, limit = EMAIL_REQUEST_LIMIT): unknown {
	if(
		typeof text !== 'string' ||
		new TextEncoder().encode(text).length > limit
	) {
		throw new Error('INVALID_EMAIL_JSON')
	}

	const objects: (Set<string> | null)[] = []
	const begin = (keys: Set<string> | null) => {
		objects.push(keys)
		if(objects.length > 20) {
			throw new Error('INVALID_EMAIL_JSON')
		}
	}

	visit(
		text,
		{
			onObjectBegin: () => begin(new Set()),
			onArrayBegin: () => begin(null),
			onObjectEnd: () => {
				objects.pop()
			},
			onArrayEnd: () => {
				objects.pop()
			},
			onObjectProperty: (key) => {
				const keys = objects[objects.length - 1]
				if(!keys || forbidden.has(key) || keys.has(key)) {
					throw new Error('INVALID_EMAIL_JSON')
				}

				keys.add(key)
			},
			onError: () => {
				throw new Error('INVALID_EMAIL_JSON')
			},
		},
		{
			disallowComments: true,
			allowTrailingComma: false,
			allowEmptyContent: false,
		},
	)
	// Also rejects invalid Unicode, non-finite values and depth >16, using the shared guard.
	return plainCopy(JSON.parse(text), -4)
}

export const emailId = z.string().regex(/^[a-f0-9]{32,64}$/)
export const emailDigest = z.string().regex(/^[a-f0-9]{64}$/)
export const capability = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
export function emailEndpoint(value: string, allowLocal = false): string {
	const u = new URL(value)
	if(
		u.username ||
		u.password ||
		u.search ||
		u.hash ||
		(u.protocol !== 'https:' &&
			!(
				allowLocal &&
				u.protocol === 'http:' &&
				['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
			))
	) {
		throw new Error('INVALID_EMAIL_ENDPOINT')
	}

	return u.href.replace(/\/$/, '')
}

const endpoint = z.string().max(2048)
export const emailRequestSchema = z.strictObject({
	method: z.literal('email'),
	version: z.literal(1),
	appId: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
	provider: emailProviderSchema,
	sessionId: emailId,
	nonce: emailId,
	createdAt: z.number().int().positive(),
	expiresAt: z.number().int().positive(),
	policy: normalizedEmailPolicySchema,
	context: z.record(z.string(), z.unknown()).optional(),
	callbackUrl: endpoint,
	cancelCallbackUrl: endpoint,
	jsonProofResponse: z.boolean(),
	emailPortalUrl: endpoint,
	emailApiUrl: endpoint,
})
export interface EmailRequest {
	method: 'email'
	version: 1
	appId: string
	/** Mailbox provider the user reads the email from. */
	provider: EmailProvider
	sessionId: string
	nonce: string
	createdAt: number
	expiresAt: number
	policy: NormalizedEmailPolicy
	context?: Record<string, unknown>
	callbackUrl: string
	cancelCallbackUrl: string
	jsonProofResponse: boolean
	emailPortalUrl: string
	emailApiUrl: string
}
export function callbackUrl(value: string, defaultUrl: string): string {
	const u = new URL(value)
	if(
		u.username ||
		u.password ||
		u.hash ||
		(u.href !== defaultUrl &&
			(u.protocol !== 'https:' || (u.port && u.port !== '443')))
	) {
		throw new Error('INVALID_EMAIL_CALLBACK')
	}

	return u.href
}

export function emailDefaultCallback(
	api: string,
	id: string,
	cancel = false,
): string {
	return `${api}/api/email/requests/${id}/${cancel ? 'error-callback' : 'callback'}`
}

export function validateEmailRequest(
	value: unknown,
	allowLocal = false,
): EmailRequest {
	const r = emailRequestSchema.parse(plainCopy(value, -2))
	copyNormalizedPolicy(r.policy)
	if(r.expiresAt - r.createdAt !== EMAIL_REQUEST_TTL_MS) {
		throw new Error('INVALID_EMAIL_EXPIRY')
	}

	for(const u of [r.emailApiUrl, r.emailPortalUrl]) {
		if(emailEndpoint(u, allowLocal) !== u) {
			throw new Error('INVALID_EMAIL_ENDPOINT')
		}
	}

	if(new URL(r.emailApiUrl).pathname !== '/') {
		throw new Error('INVALID_EMAIL_API_ORIGIN')
	}

	callbackUrl(r.callbackUrl, emailDefaultCallback(r.emailApiUrl, r.sessionId))
	callbackUrl(
		r.cancelCallbackUrl,
		emailDefaultCallback(r.emailApiUrl, r.sessionId, true),
	)
	if(r.context) {
		plainCopy(r.context)
	}

	if(
		r.context &&
		(new TextEncoder().encode(canonicalJson(r.context)).length > 16384 ||
			Object.keys(r.context).some(
				(k) => /attestation|session/i.test(k) ||
					[
						'extractedParameters',
						'isAiProof',
						'isPortalProof',
						'providerHash',
						'proofType',
						'verificationMethod',
						'emailProof',
					].includes(k),
			))
	) {
		throw new Error('INVALID_EMAIL_CONTEXT')
	}

	if(new TextEncoder().encode(canonicalJson(r)).length > EMAIL_REQUEST_LIMIT) {
		throw new Error('EMAIL_REQUEST_TOO_LARGE')
	}

	return r
}

export const signedEmailRequestSchema = z.strictObject({
	request: emailRequestSchema,
	signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
	previousHash: emailDigest.optional(),
})
export function emailSignaturePayload(
	request: EmailRequest,
	previousHash?: string,
): string {
	return canonicalJson(
		previousHash === undefined
			? { operation: 'reclaim.email.init.v1', request }
			: { operation: 'reclaim.email.update.v1', previousHash, request },
	)
}

export const emailDescriptorSchema = z.strictObject({
	version: z.literal(2),
	method: z.literal('email'),
	request: emailRequestSchema,
	requestHash: emailDigest,
	launchCapability: capability,
	statusCapability: capability,
})
export interface EmailSessionJSON {
	version: 2
	method: 'email'
	request: EmailRequest
	requestHash: string
	launchCapability: string
	statusCapability: string
}
export const emailCreateResponseSchema = z.strictObject({
	requestHash: emailDigest,
	launchCapability: capability,
	statusCapability: capability,
})
export const emailStatusSchema = z.strictObject({
	method: z.literal('email'),
	sessionId: emailId,
	requestHash: emailDigest,
	status: z.enum([
		'created',
		'launched',
		'connected',
		'checking',
		'authenticated',
		'analyzing',
		'review',
		'submitting',
		'submitted',
		'failed',
		'cancelled',
	]),
	expiresAt: z.number().int(),
	code: z
		.string()
		.regex(/^[A-Z_]{1,80}$/)
		.optional(),
	resultExpiresAt: z.number().int().optional(),
	proofs: z.array(z.unknown()).length(1).optional(),
})
