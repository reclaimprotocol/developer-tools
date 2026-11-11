import type { components } from './types/openapi.gen.ts'
import {
	hashRequirementsFromSpecs,
	type ProofRequestSpec,
} from './proof-hash.ts'
import type { ReclaimRequestProof } from './proof-types.ts'

type RequestSelection = components['schemas']['RequestSelection']
type RequestSelectionTemplate =
	components['schemas']['RequestSelectionTemplate']

/** Resolved Builder provider recipe returned for a verification session. */
export interface BuilderProofRecipe {
	providerId: string
	resolvedVersion: string
	initialUrl: string
	requests: RequestSelection[]
	allowedJsRequests?: RequestSelectionTemplate[]
}

/**
 * Derive the exact hash requirements consumed by `verifyRequestProof` from a
 * resolved Builder recipe. Builder's fixed requests are required once each.
 */
export function proofHashesFromBuilderRecipe(
	recipe: BuilderProofRecipe,
	proofs: ReclaimRequestProof[],
) {
	return hashRequirementsFromSpecs(
		recipe.requests.map((request) => toRequestSpec(
			request,
			{ required: true, multiple: false },
		)),
		(recipe.allowedJsRequests ?? []).map(
			(request) => toRequestSpec(request, {
				required: request.required,
				multiple: request.multiple,
				templateParams: request.templateParams,
				templateParamsMode: request.templateParamsMode,
			}),
		),
		proofs,
	)
}

function toRequestSpec(
	request: RequestSelection | RequestSelectionTemplate,
	flags: Pick<
		ProofRequestSpec,
		'required' | 'multiple' | 'templateParams' | 'templateParamsMode'
	>,
): ProofRequestSpec {
	return {
		url: request.url,
		urlType: request.url.includes('{{') ? 'TEMPLATE' : 'CONSTANT',
		method: request.method,
		bodySniff: {
			enabled: request.requestBodyTemplate !== undefined,
			template: request.requestBodyTemplate ?? '',
		},
		responseMatches: (request.responseMatches ?? []).map((match) => ({
			type: match.type,
			value: match.value,
			invert: undefined,
			isOptional: match.isOptional,
		})),
		responseRedactions: (request.responseRedactions ?? []).map((redaction) => ({
			...(redaction.hash ? { hash: redaction.hash } : {}),
			jsonPath: redaction.jsonPath ?? '',
			regex: redaction.regex ?? '',
			xPath: redaction.xPath ?? '',
		})),
		...flags,
	}
}
