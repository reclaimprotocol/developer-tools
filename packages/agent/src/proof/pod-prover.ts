/**
 * PopcornPodProver — run the zkTLS proof inside a Popcorn browser session's
 * OWN TEE pod instead of the in-process attestor SDK (`runAttestorProof`).
 * POSTs the recipe + captured secrets to the pod's `/reclaim/prove` (the same
 * attestor TEE+MPC protocol) and re-shapes the response into the shared
 * {@link ProofResult}, so every caller consumes proof results identically
 * regardless of which path produced them.
 *
 * This is the pod's OWN api for creating a proof from a live session — used
 * by both the app's server-driven verification runner and the MCP's
 * `run_proof_via_pod` tool. Proving here (rather than locally) matters
 * specifically when the session is country-routed: Popcorn allocated the
 * browser with an exit country, and this is the SAME enclave holding that
 * browser's TLS session, so the proof reaches the target from the identical
 * exit IP the browser used — a local attestor SDK proof runs from the
 * app/agent's OWN network instead.
 *
 * Contract (verified against ../popcorn-images oapi.go + ../reclaim-tee):
 *   POST {apiUrl}/reclaim/prove  body { provider_params_json, config_json? }
 *   provider_params_json = JSON of { name, params, secretParams, context? }
 *   → 200 { session_id, claim, signature } (ReclaimProveResult, snake_case):
 *     claim has provider/parameters/owner/timestamp_s/context/identifier/epoch;
 *     signature has attestor_address + claim_signature(b64) +
 *     result_signature(b64). A proof failure/timeout is a 500 whose `message`
 *     carries the reason.
 *
 * The pod API is unauthenticated (gateway/session is the trust boundary); call
 * it over the same internal host used for CDP. Consumers verify
 * `claim_signature` with the legacy SDK's `verifyProof`, so this hands back an
 * {@link AttestorClaim} that the app places in the exact `Proof` shape.
 * `result_signature` is unused by consumers.
 */
import { bytesToHex } from '@noble/hashes/utils.js'
import type { ProviderParams } from '@reclaimprotocol/attestor-core'
import type { AttestorClaim, ProofResult } from './attestor.ts'

/** Attestor HTTP provider params — the recipe the agent synthesis produces. */
export type HttpParams = ProviderParams<'http'>

/** Captured secrets for the replay, exactly as `/reclaim/prove` wants them. */
export interface HttpSecretParams {
	cookieStr?: string
	authorisationHeader?: string
	headers?: Record<string, string>
	paramValues?: Record<string, string>
}

/**
 * The pod's `/reclaim/prove` 200 body (ReclaimProveResult, snake_case; fields
 * optional because we validate). Note `timestamp_s` and the whole `signature`
 * object are snake_case; matching them is exactly what fixes the false
 * "no claim/signature".
 */
interface ReclaimProveResponse {
	session_id?: string
	claim?: {
		provider?: string
		parameters?: string
		owner?: string
		timestamp_s?: number
		context?: string
		identifier?: string
		epoch?: number
	}
	signature?: {
		attestor_address?: string
		claim_signature?: string
		result_signature?: string
	}
}

export interface PopcornProveOptions {
	/** Pod API base (the session's `apiUrl`). */
	apiUrl: string
	params: HttpParams
	secretParams: HttpSecretParams
	/** Session context, stringified into the claim context if given. */
	context?: Record<string, unknown>
	/** Base64 JSON authorization forwarded by reclaim-tee to the attestor. */
	authRequest?: string
	fetchImpl?: typeof fetch
}

export interface ValidateExtractionResult {
	valid: boolean
	extractedValue?: string
	error?: string
	steps?: string[]
}

/**
 * The cloud "replay": validate that a drafted recipe's selectors extract the
 * expected value from a captured response, inside the TEE — `POST {apiUrl}
 * /reclaim/validate-extraction`. Reuses the prover's own redaction engine, so
 * a pass means the selectors won't diverge at proof time. No proof/secrets.
 */
export async function popcornValidateExtraction(opts: {
	apiUrl: string
	responseBody: string
	expectedValue: string
	xPath?: string
	jsonPath?: string
	regex?: string
	fetchImpl?: typeof fetch
}): Promise<ValidateExtractionResult> {
	const doFetch = opts.fetchImpl ?? fetch
	const base = opts.apiUrl.replace(/\/$/, '')
	try {
		const res = await doFetch(`${base}/reclaim/validate-extraction`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				responseBody: opts.responseBody,
				expectedValue: opts.expectedValue,
				...(opts.xPath ? { xPath: opts.xPath } : {}),
				...(opts.jsonPath ? { jsonPath: opts.jsonPath } : {}),
				...(opts.regex ? { regex: opts.regex } : {}),
			}),
		})
		if(!res.ok) {
			const detail = await res.text().catch(() => '')
			return { valid: false, error: `${res.status}: ${detail.slice(0, 300)}` }
		}

		const body = (await res.json()) as ValidateExtractionResult
		return body
	} catch(err) {
		const error = err instanceof Error ? err.message : String(err)
		return { valid: false, error }
	}
}

/** Decode standard base64 (Go `base64.StdEncoding` from Popcorn) to bytes. */
function b64ToBytes(b64: string): Uint8Array {
	return new Uint8Array(Buffer.from(b64, 'base64'))
}

/**
 * Prove a single request through the Popcorn TEE. Returns the shared
 * {@link ProofResult}; on any failure `verified` is false and `error` carries
 * the reason (never throws for an expected proof failure).
 */
export async function popcornProve(
	opts: PopcornProveOptions,
): Promise<ProofResult> {
	const { apiUrl, params, secretParams, context, authRequest } = opts
	const doFetch = opts.fetchImpl ?? fetch
	const base = apiUrl.replace(/\/$/, '')

	const providerParamsJson = JSON.stringify({
		name: 'http',
		params,
		secretParams,
		...(context ? { context: JSON.stringify(context) } : {}),
		...(authRequest ? { authRequest } : {}),
	})
	const fail = (error: string): ProofResult => ({
		proof: undefined,
		extractedValue: '',
		extractedParameters: {},
		verified: false,
		error,
	})

	let resp: ReclaimProveResponse
	let raw = ''
	try {
		const res = await doFetch(`${base}/reclaim/prove`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ provider_params_json: providerParamsJson }),
		})
		// Read the body as text first: a proof failure/timeout is a 500 whose
		// `message` we want to surface verbatim, and on an unexpected 200 shape we
		// echo the raw body instead of a blind "no claim/signature".
		raw = await res.text().catch(() => '')
		if(!res.ok) {
			return fail(`/reclaim/prove ${res.status}: ${raw.slice(0, 300)}`)
		}

		resp = JSON.parse(raw) as ReclaimProveResponse
	} catch(err) {
		return fail(err instanceof Error ? err.message : String(err))
	}

	const claim = resp.claim
	const sig = resp.signature
	if(!claim || !sig?.attestor_address || !sig?.claim_signature) {
		return fail(
			'popcorn /reclaim/prove returned no claim/signature: '
			+ raw.slice(0, 300),
		)
	}

	// claim.context is the JSON string carrying { extractedParameters, ... } —
	// the same place the in-process path reads them from.
	let extractedParameters: Record<string, string> = {}
	if(typeof claim.context === 'string') {
		try {
			const ctx = JSON.parse(claim.context) as {
				extractedParameters?: Record<string, string>
			}
			extractedParameters = ctx.extractedParameters ?? {}
		} catch{
			// leave empty if context isn't valid JSON
		}
	}

	const attestorClaim: AttestorClaim = {
		claim: {
			provider: claim.provider ?? '',
			parameters: claim.parameters ?? '',
			owner: claim.owner ?? '',
			timestampS: claim.timestamp_s ?? 0,
			context: claim.context ?? '',
			identifier: claim.identifier ?? '',
			epoch: claim.epoch ?? 0,
		},
		attestorAddress: sig.attestor_address,
		// Consumer-side verification expects hex; Popcorn signs in base64.
		claimSignature: '0x' + bytesToHex(b64ToBytes(sig.claim_signature)),
	}

	return {
		proof: resp,
		verified: true,
		extractedParameters,
		extractedValue: Object.values(extractedParameters)[0] ?? '',
		...(claim.identifier ? { identifier: claim.identifier } : {}),
		...(claim.owner ? { owner: claim.owner } : {}),
		attestorClaim,
	}
}
