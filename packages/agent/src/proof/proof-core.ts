/**
 * Shared attestor-claim plumbing used by both proof callers: the agent's MCP
 * `run_proof` (which resolves the owner key from the credential cache and
 * captures trace logs) and the app's verification runner (which signs with an
 * ephemeral per-session key and builds a nested-proof claim). Only those
 * concerns differ — building the HTTP params, resolving the attestor URL, and
 * parsing the claim response are identical, so they live here.
 */
import type { ProviderParams } from '@reclaimprotocol/attestor-core'
import { setCryptoImplementation } from '@reclaimprotocol/tls'
import { webcryptoCrypto } from '@reclaimprotocol/tls/webcrypto'
import { attestorUrlOverride, FALLBACK_ATTESTOR_URL } from '../consts.ts'
import type { ReclaimProvider } from '../provider/schema.ts'
import { normalizeGeoLocation } from '../provider/schema.ts'

let cryptoInitialized = false

/** One-time crypto backend init for `@reclaimprotocol/tls` (idempotent). The
 *  package ships with an empty `crypto = {}` and defers the backend to the
 *  caller; without this the first proof dies inside the TLS client with
 *  `crypto.randomBytes is not a function`. Shared by every attestor caller —
 *  the agent MCP `run_proof` tool and the app's verification runner. */
export function ensureAttestorCrypto() {
	if(cryptoInitialized) {
		return
	}

	setCryptoImplementation(webcryptoCrypto)
	cryptoInitialized = true
}

/** Resolve the attestor websocket URL: explicit override → env → public
 *  default. Resolved per-call so an env change or per-request override takes
 *  effect without restarting. */
export function resolveAttestorUrl(override?: string): string {
	return (
		override ?? attestorUrlOverride() ?? FALLBACK_ATTESTOR_URL
	)
}

/** Map a provider's recipe straight to the attestor's HTTP
 *  params — never synthesized from captured traffic. */
export function buildHttpParams(
	provider: ReclaimProvider,
): ProviderParams<'http'> {
	// A blank egress is treated as unset: omit it so the local proof uses the
	// tester's own egress rather than shipping a blank or an unresolved template.
	const geoLocation = normalizeGeoLocation(provider.geoLocation)
	return {
		url: provider.url,
		method: provider.method,
		...(provider.headers !== undefined && { headers: provider.headers }),
		...(provider.body !== undefined && { body: provider.body }),
		responseMatches: provider.responseMatches,
		responseRedactions: provider.responseRedactions ?? [],
		...(provider.paramValues !== undefined && {
			paramValues: provider.paramValues,
		}),
		...(provider.writeRedactionMode !== undefined && {
			writeRedactionMode: provider.writeRedactionMode,
		}),
		...(provider.additionalClientOptions !== undefined && {
			additionalClientOptions: provider.additionalClientOptions,
		}),
		...(geoLocation !== undefined && { geoLocation }),
	}
}

export interface ParsedClaim {
	/** ProviderClaimData: provider, parameters, context, owner, identifier, … */
	claimData?: Record<string, unknown>
	extractedParameters: Record<string, string>
	extractedValue: string
	identifier?: string
	owner?: string
}

/** Why the attestor did not sign `claim`, or `undefined` when it did. The
 *  attestor returns rejections (for example, an invalid ZK proof) as a
 *  response with `error` set and no claim signature, not by throwing. */
export function claimRejection(claim: unknown): string | undefined {
	const response = claim as {
		claim?: unknown
		error?: { code?: unknown, message?: unknown }
		signatures?: { claimSignature?: unknown }
	} | null | undefined
	const error = response?.error
	if(error?.message || error?.code) {
		return typeof error.message === 'string' && error.message
			? error.message
			: `attestor error code ${String(error.code)}`
	}

	if(!response?.claim) {
		return 'attestor returned no claim'
	}

	const signature = response.signatures?.claimSignature
	if(!(signature instanceof Uint8Array) || !signature.length) {
		return 'attestor did not sign the claim'
	}

	return undefined
}

/** Pull claimData + decoded `context.extractedParameters` (plus identifier /
 *  owner) out of a `createClaimOnAttestor` result. The full result still
 *  carries signatures the caller may need for nested-proof building. */
export function parseClaim(claim: unknown): ParsedClaim {
	const claimRecord = claim as Record<string, unknown>
	const claimData = claimRecord['claim'] as Record<string, unknown> | undefined

	// claimData.context is a JSON-encoded string carrying
	// { extractedParameters: {...}, providerHash, ... }.
	let context: Record<string, unknown> = {}
	const rawContext = claimData?.['context']
	if(typeof rawContext === 'string') {
		try {
			context = JSON.parse(rawContext) as Record<string, unknown>
		} catch{
			// Leave context empty if it isn't valid JSON.
		}
	}

	const extractedParameters =
		(context['extractedParameters'] as Record<string, string> | undefined) ?? {}

	const parsed: ParsedClaim = {
		extractedParameters,
		extractedValue: Object.values(extractedParameters)[0] ?? '',
	}
	if(claimData) {
		parsed.claimData = claimData
	}

	const identifier = claimData?.['identifier']
	if(typeof identifier === 'string') {
		parsed.identifier = identifier
	}

	const owner = claimData?.['owner']
	if(typeof owner === 'string') {
		parsed.owner = owner
	}

	return parsed
}
