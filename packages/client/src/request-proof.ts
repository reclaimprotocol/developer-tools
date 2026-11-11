import { createSignDataForClaim } from '@reclaimprotocol/attestor-core'
import { recoverEip191Address } from './eip191.ts'
import { isTransientFailure, networkStep } from './errors.ts'
import { fetchReclaimJwks, trustedAttestorAddresses } from './jwks.ts'
import { assertValidProofHashes, getHashFromProof } from './proof-hash.ts'
import type {
	HashRequirement,
	ReclaimRequestProof,
	TrustedData,
} from './proof-types.ts'
import {
	type AttestorTeeAttestationConfig,
	runAttestorTeeVerification,
} from './verify-attestor-tee.ts'
import { runTeeVerification, type TeeAttestationConfig } from './verify-tee.ts'

export type { ReclaimRequestProof } from './proof-types.ts'

/** A proof hash requirement accepted by `verifyRequestProof`. */
export type ProofHashRequirement = string | HashRequirement

export interface ResolvedSessionProofValidation {
	hashes?: ProofHashRequirement[]
	providerId?: string
	providerVersion?: string
	allowedTags?: string[]
}

/** Exact provider requirements returned by a caller-controlled resolver. */
export interface ResolvedProviderProofValidation {
	hashes: ProofHashRequirement[]
}

/** Field names match the request spec a provider recipe declares, so a
 *  caller configuring verification reads the same vocabulary it authored. */
export interface VerifyRequestProofOptions {
	hashes?: ProofHashRequirement[]
	providerId?: string
	providerVersion?: string
	allowedTags?: string[]
	dangerouslyDisableContentValidation?: true
	/** Read `providerHash` from context, while still verifying signatures. */
	hasNoPii?: true
	teeAttestation?: TeeAttestationConfig
	/** Require every witness to carry a `claimAttestation`, and verify any
	 *  `attestation_report` against `expectedImageDigests`. */
	attestorTeeAttestation?: AttestorTeeAttestationConfig
	/** Explicit trusted attestor ETH addresses. */
	attestorAddresses?: string[]
	/** Trusted attestor image digests, like `x-reclaim-attestor-image-digests`.
	 *  Pin any `attestation_report` a witness carries without requiring one,
	 *  matching `@reclaimprotocol/js-sdk`'s default. */
	attestorImageDigests?: string[]
	/** Trusted Builder JWKS registry containing attestor-purpose keys. */
	attestorJwksUrl?: string
	fetchImpl?: typeof fetch
	/** Builder session id. Requires a resolver without hashes or a provider. */
	sessionId?: string
	resolveSession?: (
		sessionId: string,
		proofs: ReclaimRequestProof[],
	) => Promise<ResolvedSessionProofValidation>
		| ResolvedSessionProofValidation
	/** Resolve an exact provider without coupling this verifier to HTTP. */
	resolveProvider?: (
		providerId: string,
		providerVersion: string | undefined,
		allowedTags: string[] | undefined,
		proofs: ReclaimRequestProof[],
	) => Promise<ResolvedProviderProofValidation[]>
		| ResolvedProviderProofValidation[]
	expectedSessionId?: string
	requireSessionBinding?: boolean
	expectedContext?: Record<string, unknown>
}

export interface ReclaimRequestProofOutcome {
	valid: boolean
	reason?: string
	/** On failure: true when a temporary condition caused it, such as a
	 *  network error while resolving the session or provider. A retry can
	 *  succeed. */
	transient?: boolean
	proofHashes?: string[]
	isTeeAttestationVerified?: boolean
	/** True when at least one witness's `attestation_report` verified; false
	 *  when the check ran and no witness carried one. */
	isAttestorTeeAttestationVerified?: boolean
	data?: TrustedData[]
	publicData?: unknown[]
}

/** Return the provider hashes encoded in an exact request proof. */
export function proofHashes(proof: ReclaimRequestProof): string[] {
	return getHashFromProof(proof)
}

/**
 * Verify exact request proofs without depending on `@reclaimprotocol/js-sdk`.
 * The signed claim is never renamed or reconstructed.
 */
export async function verifyRequestProof(
	proofOrProofs: ReclaimRequestProof | ReclaimRequestProof[],
	config: VerifyRequestProofOptions,
): Promise<ReclaimRequestProofOutcome> {
	const proofs = Array.isArray(proofOrProofs) ? proofOrProofs : [proofOrProofs]
	if(!proofs.length) {
		return { valid: false, reason: 'no-proofs' }
	}

	try {
		const effective = await resolveValidation(config, proofs)
		assertSessionAndContext(proofs, effective)
		const trust = await resolveAttestorTrust(effective)
		assertVerifiedSignatures(proofs, trust.addresses)
		await assertContent(proofs, effective)

		let isTeeAttestationVerified: boolean | undefined
		if(effective.teeAttestation) {
			await runTeeVerification(proofs, effective.teeAttestation)
			isTeeAttestationVerified = true
		}

		let isAttestorTeeAttestationVerified: boolean | undefined
		const attestorTeeAttestation = resolveAttestorTeeAttestation(
			effective.attestorTeeAttestation,
			trust.imageDigests,
		)
		if(attestorTeeAttestation) {
			// Only a caller-configured check requires an envelope on every
			// witness; registry digests alone pin the reports that exist.
			// `verified` counts witnesses whose attestation report was checked.
			// A proof whose witnesses carry no report still passes the address
			// and signature bindings, but nothing was attested — say so rather
			// than reporting a TEE attestation that never happened.
			const summary = await runAttestorTeeVerification(
				proofs,
				attestorTeeAttestation,
				{ requireClaimAttestation: !!effective.attestorTeeAttestation },
			)
			isAttestorTeeAttestationVerified = summary.verified > 0
		}

		return {
			valid: true,
			proofHashes: collectProofHashes(proofs, effective.hasNoPii),
			isTeeAttestationVerified,
			isAttestorTeeAttestationVerified,
			data: proofs.map(trustedData),
			publicData: proofs.map((proof) => proof.publicData ?? {}),
		}
	} catch(error) {
		return {
			valid: false,
			reason: failureReason(error),
			transient: isTransientFailure(error),
		}
	}
}

async function resolveValidation(
	config: VerifyRequestProofOptions,
	proofs: ReclaimRequestProof[],
) {
	let effective = config
	const { sessionId, resolveSession } = config
	if(sessionId && !hasContentValidation(config)) {
		if(!resolveSession) {
			throw new Error('session-resolver-required')
		}

		effective = {
			...config,
			...await networkStep(() => resolveSession(sessionId, proofs)),
		}
	}

	return effective
}

async function resolveAttestorTrust(config: VerifyRequestProofOptions) {
	const addresses = config.attestorAddresses?.map(normalized) ?? []
	const imageDigests = config.attestorImageDigests?.map(normalized) ?? []
	const { attestorJwksUrl, fetchImpl } = config
	if(attestorJwksUrl) {
		const registry = await networkStep(() => (
			fetchReclaimJwks(attestorJwksUrl, fetchImpl)
		))
		addresses.push(
			...(registry['x-reclaim-attestors'] ?? []),
			...trustedAttestorAddresses(registry.keys),
		)
		imageDigests.push(
			...(registry['x-reclaim-attestor-image-digests'] ?? []),
		)
	}

	const unique = [...new Set(addresses)]
	if(!unique.length) {
		throw new Error('attestor-trust-required')
	}

	return {
		addresses: unique,
		imageDigests: [...new Set(imageDigests)],
	}
}

function resolveAttestorTeeAttestation(
	configured: AttestorTeeAttestationConfig | undefined,
	registryImageDigests: string[],
): AttestorTeeAttestationConfig | undefined {
	if(!registryImageDigests.length) {
		return configured
	}

	const configuredDigests = configured?.expectedImageDigests
	if(configuredDigests?.length) {
		const registry = new Set(registryImageDigests)
		const expectedImageDigests = [...new Set(configuredDigests
			.map((digest) => digest.trim().toLowerCase())
			.filter((digest) => registry.has(digest)))]
		if(!expectedImageDigests.length) {
			throw new Error('attestor-image-trust-mismatch')
		}

		return { ...configured, expectedImageDigests }
	}

	return {
		...configured,
		expectedImageDigests: registryImageDigests,
	}
}

function assertVerifiedSignatures(
	proofs: ReclaimRequestProof[],
	trustedAttestors: string[],
) {
	for(const proof of proofs) {
		if(!proof.signatures?.length || !proof.witnesses?.length) {
			throw new Error('proof-signature-missing')
		}

		const signData = createSignDataForClaim(proof.claimData)
		const signers = proof.signatures.map((signature) => (
			normalized(recoverEip191Address(signData, signature))
		))
		const witnesses = proof.witnesses.map(({ id }) => normalized(id))
		if(witnesses.some((witness) => !trustedAttestors.includes(witness))) {
			throw new Error('attestor-not-allowed')
		}

		if(!signers.some((signer) => trustedAttestors.includes(signer))) {
			throw new Error('attestor-not-allowed')
		}

		if(!signers.every((signer) => witnesses.includes(signer))) {
			throw new Error('witness-signature-mismatch')
		}
	}
}

async function assertContent(
	proofs: ReclaimRequestProof[],
	config: VerifyRequestProofOptions,
) {
	if(config.dangerouslyDisableContentValidation) {
		return
	}

	if(config.hashes) {
		assertValidProofHashes(proofs, config.hashes, config.hasNoPii)
		return
	}

	const { providerId, providerVersion, allowedTags, resolveProvider } = config
	if(providerId) {
		if(!resolveProvider) {
			throw new Error('provider-resolver-required')
		}

		const candidates = await networkStep(() => (
			resolveProvider(providerId, providerVersion, allowedTags, proofs)
		))
		if(!candidates.length) {
			throw new Error('provider-not-found')
		}

		let lastError: unknown
		for(const candidate of candidates) {
			try {
				assertValidProofHashes(proofs, candidate.hashes, config.hasNoPii)
				return
			} catch(error) {
				lastError = error
			}
		}

		throw lastError
	}

	throw new Error('proof-validation-required')
}

function assertSessionAndContext(
	proofs: ReclaimRequestProof[],
	config: VerifyRequestProofOptions,
) {
	const expectedSessionId = config.sessionId ?? config.expectedSessionId
	for(const proof of proofs) {
		if(expectedSessionId) {
			const ids = sessionIds(proof)
			if(ids.some((id) => id !== expectedSessionId)) {
				throw new Error('session-mismatch')
			}

			if((config.sessionId || config.requireSessionBinding) && !ids.length) {
				throw new Error('session-missing')
			}
		}

		if(!contextMatches(proof, config.expectedContext)) {
			throw new Error('context-mismatch')
		}
	}
}

function trustedData(proof: ReclaimRequestProof): TrustedData {
	const context = contextFrom(proof)
	const extractedParameters = isRecord(context.extractedParameters)
		? Object.fromEntries(Object.entries(context.extractedParameters).map(
			([key, value]) => [key, String(value)],
		))
		: {}
	delete context.extractedParameters
	return { context, extractedParameters }
}

function collectProofHashes(
	proofs: ReclaimRequestProof[],
	hasNoPii: true | undefined,
): string[] | undefined {
	try {
		return proofs.flatMap((proof) => getHashFromProof(proof, hasNoPii))
	} catch{
		return undefined
	}
}

function hasContentValidation(config: VerifyRequestProofOptions): boolean {
	return Boolean(
		config.hashes
		|| config.providerId
		|| config.dangerouslyDisableContentValidation,
	)
}

function failureReason(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error)
	const lower = message.toLowerCase()
	if(
		lower.includes('multiple')
		|| lower.includes('duplicate')
		|| lower.includes('more than once')
	) {
		return 'duplicate-proof-hash'
	}

	return message || 'proof-not-verified'
}

function normalized(value: string): string {
	return value.trim().toLowerCase()
}

function contextFrom(proof: ReclaimRequestProof): Record<string, unknown> {
	const raw = proof.claimData.context
	if(!raw) {
		return {}
	}

	try {
		const context: unknown = JSON.parse(raw)
		return isRecord(context) ? { ...context } : {}
	} catch{
		return {}
	}
}

function sessionIds(proof: ReclaimRequestProof): string[] {
	const context = contextFrom(proof)
	const ids = [context.reclaimSessionId]
	try {
		const parameters = JSON.parse(
			proof.claimData.parameters,
		) as Record<string, unknown>
		ids.push(parameters.proxySessionId, parameters.sessionId)
	} catch{
		// A non-HTTP claim is valid when session binding wasn't requested.
	}

	return ids.filter(
		(value): value is string => (
			typeof value === 'string' && value.length > 0
		),
	)
}

function contextMatches(
	proof: ReclaimRequestProof,
	expected?: Record<string, unknown>,
): boolean {
	if(!expected) {
		return true
	}

	const context = contextFrom(proof)
	return Object.entries(expected).every(([key, value]) => (
		JSON.stringify(context[key]) === JSON.stringify(value)
	))
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
