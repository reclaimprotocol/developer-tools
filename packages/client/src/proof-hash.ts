import { keccak_256 } from '@noble/hashes/sha3.js'
import { canonicalJson as canonical } from './canonical.ts'
import { bytesToHex } from './encoding.ts'
import type { HashRequirement, ReclaimRequestProof } from './proof-types.ts'

export interface HttpProofParams {
	url: string
	method: string
	body?: string
	responseMatches: Array<{
		type?: string
		value?: string
		invert?: boolean
		isOptional?: boolean
	}>
	responseRedactions: Array<{
		xPath?: string
		jsonPath?: string
		regex?: string
		hash?: string
	}>
}

export interface ProofRequestSpec extends HttpProofParams {
	urlType: string
	bodySniff: { enabled: boolean, template: string }
	required?: boolean
	multiple?: boolean
	templateParams?: string[]
	templateParamsMode?: 'separate' | 'merge'
}

/** Exact canonical HTTP-provider hashes, including optional matches. */
export function hashProofClaimParams(params: HttpProofParams): string[] {
	return canonicalProofParams(params).map((serialized) => (
		'0x' + bytesToHex(keccak_256(new TextEncoder().encode(serialized)))
	))
}

export function getHashFromProof(
	proof: ReclaimRequestProof,
	hasNoPii = false,
): string[] {
	if(hasNoPii) {
		const context = JSON.parse(
			proof.claimData.context,
		) as Record<string, unknown>
		if(typeof context.providerHash !== 'string' || !context.providerHash) {
			throw new Error('Provider hash must be present in proof context')
		}

		return [context.providerHash]
	}

	const parsed: unknown = JSON.parse(proof.claimData.parameters)
	if(!isHttpProofParams(parsed)) {
		throw new Error('Proof has no HTTP provider params to hash')
	}

	return hashProofClaimParams(parsed)
}

export function hashRequestSpec(request: ProofRequestSpec): HashRequirement {
	return {
		value: hashProofClaimParams({
			...request,
			body: request.bodySniff.enabled ? request.bodySniff.template : '',
		}),
		required: request.required,
		multiple: request.multiple,
	}
}

export function hashRequirementsFromSpecs(
	requestData: ProofRequestSpec[],
	allowedInjectedRequestData: ProofRequestSpec[],
	proofs: ReclaimRequestProof[],
): HashRequirement[] {
	const templates = expandTemplates(
		allowedInjectedRequestData,
		templateParametersFromProofs(proofs),
	)
	return [...requestData, ...templates].map(hashRequestSpec)
}

export function assertValidProofHashes(
	proofs: ReclaimRequestProof[],
	requirements: Array<string | HashRequirement>,
	hasNoPii = false,
) {
	const unmatched = new Map(proofs.map((proof, index) => (
		[index, getHashFromProof(proof, hasNoPii)]
	)))
	for(const raw of requirements) {
		const requirement = typeof raw === 'string' ? { value: raw } : raw
		const expected = (Array.isArray(requirement.value)
			? requirement.value
			: [requirement.value]).map(normalized)
		let found = false
		for(const [index, hashes] of unmatched) {
			if(!hashes.map(normalized).some((hash) => expected.includes(hash))) {
				continue
			}

			unmatched.delete(index)
			if(found && requirement.multiple === false) {
				throw new Error(
					`Proof by hash '${expected.join(',')}' is not allowed `
						+ 'to appear more than once',
				)
			}

			found = true
		}

		if(!found && requirement.required !== false) {
			throw new Error(
				`Proof by required hash '${expected.join(',')}' was not found`,
			)
		}
	}

	if(unmatched.size) {
		throw new Error(`${unmatched.size} extra proof(s) could not be validated`)
	}
}

function canonicalProofParams(params: HttpProofParams): string[] {
	const count = params.responseMatches.length
	const values: string[] = []
	for(let mask = 0; mask < 2 ** count; mask++) {
		let valid = true
		const matches: Array<Record<string, unknown>> = []
		const redactions: Array<Record<string, unknown>> = []
		for(let index = 0; index < count; index++) {
			const match = params.responseMatches[index]
			const redaction = params.responseRedactions[index]
			if((mask & (1 << index)) === 0) {
				if(match && !match.isOptional) {
					valid = false
				}

				continue
			}

			if(match) {
				matches.push({
					value: match.value ?? '',
					type: match.type ?? 'contains',
					invert: match.invert || undefined,
				})
			}

			if(redaction) {
				redactions.push({
					xPath: redaction.xPath ?? '',
					jsonPath: redaction.jsonPath ?? '',
					regex: redaction.regex ?? '',
					hash: normalizedRedactionHash(redaction.hash),
				})
			}
		}

		if(valid && matches.length) {
			values.push(canonical({
				url: params.url ?? '',
				method: params.method ?? 'GET',
				body: params.body ?? '',
				responseMatches: matches,
				responseRedactions: redactions,
			}))
		}
	}

	return values.length ? values : [canonical({
		url: params.url ?? '',
		method: params.method ?? 'GET',
		body: params.body ?? '',
		responseMatches: [],
		responseRedactions: [],
	})]
}

function expandTemplates(
	templates: ProofRequestSpec[],
	parameters: Record<string, string[]>,
): ProofRequestSpec[] {
	const result: ProofRequestSpec[] = []
	for(const template of templates) {
		const names = template.templateParams ?? []
		if(!names.length) {
			result.push(template)
			continue
		}

		const present = names.filter((name) => parameters[name]?.length)
		if(present.length !== names.length) {
			if(template.required === false && !present.length) {
				continue
			}

			throw new Error('Not all template variables are present')
		}

		const length = parameters[names[0]].length
		if(!names.every((name) => parameters[name].length === length)) {
			throw new Error('Not all template variables have same length')
		}

		const expanded = Array.from({ length }, (_, index) => substitute(
			template,
			Object.fromEntries(names.map((name) => [name, parameters[name][index]])),
		))
		if(template.templateParamsMode !== 'merge') {
			result.push(...expanded)
			continue
		}

		result.push({
			...template,
			responseMatches: expanded.flatMap((item) => item.responseMatches),
			responseRedactions: expanded.flatMap((item) => item.responseRedactions),
		})
	}

	return result
}

function substitute(
	template: ProofRequestSpec,
	parameters: Record<string, string>,
): ProofRequestSpec {
	const replace = (value: string) => Object.entries(parameters).reduce(
		(result, [name, replacement]) => (
			result.split(`\${${name}}`).join(replacement)
		),
		value,
	)
	return {
		...template,
		responseMatches: template.responseMatches.map((match) => ({
			...match,
			value: replace(match.value ?? ''),
		})),
		responseRedactions: template.responseRedactions.map((redaction) => ({
			...redaction,
			xPath: replace(redaction.xPath ?? ''),
			jsonPath: replace(redaction.jsonPath ?? ''),
			regex: replace(redaction.regex ?? ''),
		})),
	}
}

function templateParametersFromProofs(proofs: ReclaimRequestProof[]) {
	const combined: Record<string, unknown> = {}
	for(const proof of proofs) {
		for(const raw of [proof.claimData.parameters, proof.claimData.context]) {
			try {
				const parsed = JSON.parse(raw) as Record<string, unknown>
				Object.assign(combined, parsed.paramValues, parsed.extractedParameters)
			} catch{
				// A proof without template parameters is valid.
			}
		}
	}

	const result: Record<string, string[]> = {}
	for(const [name, raw] of Object.entries(combined)) {
		let value = raw
		if(typeof value === 'string') {
			try {
				value = JSON.parse(value)
			} catch{ /* plain string */ }
		}

		if(Array.isArray(value) && value.length) {
			result[name] = value.map(String)
		}
	}

	return result
}

function isHttpProofParams(value: unknown): value is HttpProofParams {
	if(!value || typeof value !== 'object' || Array.isArray(value)) {
		return false
	}

	const params = value as Record<string, unknown>
	return typeof params.url === 'string'
		&& typeof params.method === 'string'
		&& ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(params.method)
		&& (
			params.body === null
			|| params.body === undefined
			|| typeof params.body === 'string'
		)
		&& Array.isArray(params.responseMatches)
		&& params.responseMatches.length > 0
		&& Array.isArray(params.responseRedactions)
}

function normalized(value: string) {
	return value.toLowerCase().trim()
}

/**
 * All OPRF transports prove the same provider-level intent: the selected
 * value is hidden behind an OPRF. Verification Clients may use the transport
 * they implement, so transport spelling must not change the provider hash.
 */
function normalizedRedactionHash(value: string | undefined) {
	return value === 'oprf' || value === 'oprf-mpc' || value === 'oprf-raw'
		? '_oprf'
		: value || undefined
}
