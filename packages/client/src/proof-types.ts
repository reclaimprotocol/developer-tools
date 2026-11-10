/** Exact proof structure for one verified request, carried inside Builder
 *  result envelopes. Every Verification Client — the in-app SDK, the browser
 *  extension, portals, and Builder's own client — emits this shape. */
export interface ReclaimRequestProof {
	identifier: string
	claimData: RequestClaimData
	signatures: string[]
	witnesses: RequestWitness[]
	extractedParameterValues: unknown
	publicData?: unknown
	taskId?: number
	/** Client-specific legacy TEE data. Verification validates a supported
	 * representation only when TEE verification is requested. */
	teeAttestation?: unknown
}

export interface RequestClaimData {
	provider: string
	parameters: string
	owner: string
	timestampS: number
	context: string
	identifier: string
	epoch: number
}

export interface RequestWitness {
	id: string
	url: string
	claimAttestation?: AttestorClaimAttestation
}

/**
 * Which kind of attestation a witness carries.
 *
 * `embedded-attestor` — the in-app SDK and the browser extension. The attestor
 * signs the claim and, on a TEE run, may also return its own
 * `attestation_report`.
 *
 * `confidential-space` — portals. The browser runtime signs the claim inside a
 * GCP Confidential Space and returns `tee_attestation`, bound to the claim
 * through `context.attestationNonce`.
 */
export type ClaimAttestationType = 'embedded-attestor' | 'confidential-space'

export interface AttestorClaimAttestation {
	type: ClaimAttestationType
	attestor_address: string
	claim_signature: string
	/** `embedded-attestor` only, and optional even then: the attestor's own GCP
	 *  Confidential Space attestation (an RS256 JWT). Attestors in production
	 *  sign claims without returning one, so a witness routinely carries only
	 *  the address and the claim signature. */
	attestation_report?: string
	/** `confidential-space` only: the same payload legacy proofs carry in the
	 *  proof's top-level `teeAttestation`, and typed the same way. It comes
	 *  from an external producer and is preserved verbatim, so callers validate
	 *  it at runtime — `verifyTeeAttestation` does — rather than trusting a
	 *  shape the wire does not guarantee. */
	tee_attestation?: unknown
}

export interface TeeAttestation {
	proof_version?: 'v2' | 'v3'
	proofVersion?: 'v2' | 'v3'
	tee_provider: string
	tee_technology: string
	nonce: string
	timestamp: string
	workload: { container_name?: string, image_digest: string }
	verifier: { container_name?: string, image_digest: string }
	attestation: { token: string }
	error?: { code: string, message: string }
}

export interface TrustedData {
	context: Record<string, unknown>
	extractedParameters: Record<string, string>
}

export interface HashRequirement {
	value: string | string[]
	required?: boolean
	multiple?: boolean
}
