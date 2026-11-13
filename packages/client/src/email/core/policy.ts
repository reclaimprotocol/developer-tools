import { createHash } from 'node:crypto'
import type { NormalizedEmailPolicy, TrustedEmailBinding } from './contracts.ts'
import {
	canonicalJson,
	copyNormalizedPolicy,
	freeze,
	plainCopy,
} from './policy-data.ts'
import { trustedEmailBindingSchema } from './schemas.ts'
import { normalizeEmailMailbox } from './sender.ts'
export {
	canonicalJson,
	copyNormalizedPolicy,
	freeze,
	plainCopy,
	normalizeEmailPolicy,
} from './policy-data.ts'
export function sha256(value: string | Uint8Array): string {
	return createHash('sha256').update(value).digest('hex')
}

export function hashEmailPolicy(policy: NormalizedEmailPolicy): string {
	return sha256(canonicalJson(copyNormalizedPolicy(policy)))
}

export function copyBinding(
	input: TrustedEmailBinding,
	policy: NormalizedEmailPolicy,
): TrustedEmailBinding {
	const parsed = trustedEmailBindingSchema.safeParse(plainCopy(input))
	if(!parsed.success) {
		throw new Error('INVALID_EMAIL_BINDING')
	}

	const binding = parsed.data
	if(
		binding.policyHash !== hashEmailPolicy(policy) ||
		normalizeEmailMailbox(binding.accountAddress) !== binding.accountAddress ||
		binding.expiresAt <= Date.now()
	) {
		throw new Error('INVALID_EMAIL_BINDING')
	}

	return freeze(binding)
}
