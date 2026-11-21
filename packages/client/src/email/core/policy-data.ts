/* eslint-disable @stylistic/max-len */
import * as jcs from 'canonicalize'
import type { EmailPolicyInput, NormalizedEmailPolicy } from './contracts.ts'
import {
	emailPolicyInputSchema,
	normalizedEmailPolicySchema,
} from './schemas.ts'
import {
	normalizeEmailDomainPattern,
	normalizeEmailMailbox,
	parseEmailSender,
} from './sender.ts'
// Core copy: canonicalize is a CJS default export with no usable type, so
// the cast names its call signature.
const canonicalize = jcs.default as unknown as (
	value: unknown,
) => string | undefined
export function freeze<T>(value: T): T {
	if(value && typeof value === 'object') {
		for(const child of Object.values(value)) {
			freeze(child)
		}

		Object.freeze(value)
	}

	return value
}

/** Read property descriptors before values: never execute accessors at the trust boundary. */
export function plainCopy(value: unknown, depth = 0): unknown {
	if(depth > 16) {
		throw new Error('INVALID_EMAIL_INPUT')
	}

	if(
		typeof value === 'string' &&
		/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
			value,
		)
	) {
		throw new Error('INVALID_EMAIL_INPUT')
	}

	if(
		value === null ||
		typeof value === 'string' ||
		typeof value === 'boolean'
	) {
		return value
	}

	if(typeof value === 'number' && Number.isFinite(value)) {
		return value
	}

	if(
		!value ||
		typeof value !== 'object' ||
		(!Array.isArray(value) &&
			Object.getPrototypeOf(value) !== Object.prototype &&
			Object.getPrototypeOf(value) !== null)
	) {
		throw new Error('INVALID_EMAIL_INPUT')
	}

	const result: Record<string, unknown> = Object.create(null)
	for(const key of Reflect.ownKeys(value)) {
		if(Array.isArray(value) && key === 'length') {
			continue
		}

		if(
			typeof key !== 'string' ||
			/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
				key,
			) ||
			['__proto__', 'constructor', 'prototype'].includes(key)
		) {
			throw new Error('INVALID_EMAIL_INPUT')
		}

		const descriptor = Object.getOwnPropertyDescriptor(value, key)!
		if(!descriptor.enumerable || !('value' in descriptor)) {
			throw new Error('INVALID_EMAIL_INPUT')
		}

		result[key] = plainCopy(descriptor.value, depth + 1)
	}

	if(Array.isArray(value)) {
		if(
			Object.keys(result).length !== value.length ||
			Object.keys(result).some((key, index) => key !== String(index))
		) {
			throw new Error('INVALID_EMAIL_INPUT')
		}

		return Object.values(result)
	}

	return result
}

export function normalizeEmailPolicy(
	input: EmailPolicyInput,
): NormalizedEmailPolicy {
	const parsed = emailPolicyInputSchema.safeParse(plainCopy(input))
	if(!parsed.success) {
		throw new Error('INVALID_EMAIL_POLICY')
	}

	const data = parsed.data
	if(new TextEncoder().encode(JSON.stringify(data)).byteLength > 64 * 1024) {
		throw new Error('INVALID_EMAIL_POLICY')
	}

	const sender = parseEmailSender(data.sender)
	const params = data.params.map((p) => ({
		name: p.name,
		instructions: p.instructions,
		isOptional: p.isOptional ?? false,
	}))
	if(
		new Set(params.map((p) => p.name)).size !== params.length ||
		params.every((p) => p.isOptional)
	) {
		throw new Error('INVALID_EMAIL_PARAMS')
	}

	const instructions = data.instructions ?? ''
	const contentScope = data.contentScope ?? 'body-and-attachments'
	// An arbitrary full-address regex has no safely derivable domain policy.
	// Require the caller's signer list rather than silently allowing every signer.
	if(!data.allowedDkimSigningDomains) {
		throw new Error('EMAIL_REGEX_SIGNERS_REQUIRED')
	}

	const domains = data.allowedDkimSigningDomains
	const allowedDkimSigningDomains = [
		...new Set(domains.map(normalizeEmailDomainPattern)),
	].sort()
	return freeze({
		version: 'email-dkim-v5',
		textVersion: 'email-text-v1',
		sender: sender.sender,
		params,
		instructions,
		contentScope,
		allowedDkimSigningDomains,
		...(data.expectedRecipient !== undefined
			? { expectedRecipient: normalizeEmailMailbox(data.expectedRecipient) }
			: {}),
		...(data.minEmailDateS !== undefined
			? { minEmailDateS: data.minEmailDateS }
			: {}),
		...(data.maxEmailDateS !== undefined
			? { maxEmailDateS: data.maxEmailDateS }
			: {}),
	})
}

export function copyNormalizedPolicy(
	input: NormalizedEmailPolicy,
): NormalizedEmailPolicy {
	const parsed = normalizedEmailPolicySchema.safeParse(plainCopy(input))
	if(!parsed.success) {
		throw new Error('INVALID_EMAIL_POLICY')
	}

	const {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		version: _version,
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		textVersion: _textVersion,
		...policy
	} = parsed.data
	const normalized = normalizeEmailPolicy(policy)
	if(canonicalJson(normalized) !== canonicalJson(input)) {
		throw new Error('EMAIL_POLICY_NOT_NORMALIZED')
	}

	return normalized
}

export function canonicalJson(value: unknown, depth = 0): string {
	const result = canonicalize(plainCopy(value, depth))
	if(result === undefined) {
		throw new Error('INVALID_EMAIL_INPUT')
	}

	return result
}
