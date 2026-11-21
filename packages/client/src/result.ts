/**
 * Consumer-side handling of a delivered callback. Two entry points:
 *  - {@link verifyResult}: the offline primitive — decrypt + decode + optional
 *    ES256K signature check (caller-supplied key) + `reclaimSessionId` nonce.
 *  - {@link verifyResultFull}: the recommended server-side verification —
 *    resolves Builder's trusted issuer, discovers Builder's key
 *    via JWKS, checks
 *    `reclaimSessionId`/`aud` and any legacy `exp`, and passes every exact
 *    proof to the in-package `verifyRequestProof` verifier.
 *
 * See docs/verification-session.md → "Verification by Consumer".
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { decrypt as eciesDecrypt, encrypt as eciesEncrypt } from 'eciesjs'
import type { EmailProofV1 } from './email/core/contracts.ts'
import type { EmailProvider, EmailRequest } from './email/core/protocol.ts'
import type { EmailVerificationMode } from './email/verify.ts'
import type { components } from './types/openapi.gen.ts'
import type { DecryptionKey } from './enckeys.ts'
import {
	b64url,
	base64urlToBytes,
	hexToBytes,
	stripTrailingSlashes,
} from './encoding.ts'
import { isTransientError } from './errors.ts'
import {
	fetchReclaimJwks,
	type Jwk,
	jwkToUncompressedPublicKey,
	selectVerificationResultKey,
} from './jwks.ts'
import { getHashFromProof } from './proof-hash.ts'
import {
	type BuilderProofRecipe,
	proofHashesFromBuilderRecipe,
} from './proof-recipe.ts'
import type { TrustedData } from './proof-types.ts'
import {
	type ProofHashRequirement,
	type ReclaimRequestProof,
	verifyRequestProof,
	type VerifyRequestProofOptions,
} from './request-proof.ts'
import { addressFromUncompressedPubkey, secp } from './secp.ts'

/** Longest `iss` worth comparing. Real issuers are short origins. */
const MAX_ISSUER_LENGTH = 2048

export interface Jws {
	payload: string
	signatures: {
		protected: string
		header?: Record<string, unknown>
		signature: string
	}[]
}

export interface VerifyResultOptions {
	/** Uncompressed ETH public key (`0x04`+128 hex) of the signer; when given,
	 *  the JWS signature is verified. Omit to only decode + check the nonce. */
	signerPublicKey?: string
	/** The `reclaimSessionId` the consumer expects (the session id they got
	 *  back at creation). When given, mismatch fails verification. */
	reclaimSessionId?: string
}

export interface VerifyResultOutcome {
	payload: Record<string, unknown>
	reclaimSessionId?: string
}

/**
 * ECIES-encrypt `plaintext` for the holder of `publicJwk` (the org's secp256k1
 * **eth** public JWK, `{kty:'EC', crv:'secp256k1', x, y}`) — `eciesjs` defaults
 * (secp256k1 + AES-256-GCM). Used by the first-party Verification Client to
 * encrypt the signed JWS for the Consumer before submitting it to the Builder
 * (which only relays the ciphertext). Consumers never call this — they only
 * {@link decryptCallback}.
 *
 * `plaintext` is bytes (for example, `new
 * TextEncoder().encode(JSON.stringify(jws))`); returns the ciphertext as a
 * base64url string (single token, never starts with `{`, so {@link
 * decryptCallback} can tell it apart from a plaintext JWS JSON).
 */
export async function encryptForEthPublicKey(
	publicJwk: Jwk,
	plaintext: Uint8Array,
): Promise<string> {
	// Uncompressed `0x04`‖X‖Y bytes — what eciesjs accepts as the recipient key.
	const pubBytes = hexToBytes(jwkToUncompressedPublicKey(publicJwk))
	return b64url(eciesEncrypt(pubBytes, plaintext))
}

/**
 * What a consumer's callback endpoint receives — the Builder POSTs the JSON
 * `VerificationResultDelivery` envelope: plaintext `sessionId`/`event`/
 * `timestamp` routing hints. For terminal events `data` is an ECIES ciphertext
 * (base64url) wrapping the signed JWS (or the plaintext JWS JSON when the org
 * has no key / `canEncryptResult` is off). The envelope is unauthenticated;
 * trust only the decrypted+verified JWS.
 *
 * Derived from the generated spec type so it can't drift; the hint fields
 * are relaxed to optional — decryption only needs `data`.
 */
export type DeliveryEnvelope = Partial<
	components['schemas']['VerificationResultDelivery']
> &
	Pick<components['schemas']['VerificationResultDelivery'], 'data'>

/** Anything a callback handler may have on hand: the parsed envelope, its
 *  JSON text, its raw body bytes — or a bare compact JWE / JWS string. */
export type CallbackBody =
	| DeliveryEnvelope
	| string
	| Uint8Array
	| ArrayBuffer

/** Normalize any {@link CallbackBody} to the terminal-result `data` string —
 *  either an ECIES ciphertext (base64url) or the plaintext JWS JSON (`{…}`).
 *  The envelope object/text wraps it in `.data`; raw bytes are decoded to text
 *  first. */
function payloadFrom(body: CallbackBody): string {
	if(typeof body === 'string') {
		const s = body.trim()
		// A JSON envelope/JWS starts with '{'; anything else is the bare `data`
		// (compact JWE). An envelope's `data` is extracted; a bare JWS is returned.
		if(s.startsWith('{')) {
			const parsed = JSON.parse(s) as DeliveryEnvelope | Jws
			if(typeof (parsed as DeliveryEnvelope).data === 'string') {
				return (parsed as DeliveryEnvelope).data
			}

			return s
		}

		return s
	}

	if(body instanceof ArrayBuffer) {
		return payloadFrom(new TextDecoder().decode(new Uint8Array(body)))
	}

	if(body instanceof Uint8Array) {
		return payloadFrom(new TextDecoder().decode(body))
	}

	return body.data
}

/**
 * Decrypt a delivered terminal callback to the signed JWS. `data` is either an
 * ECIES ciphertext (base64url, decrypted with the eth `privateKey` scalar) or —
 * when the org has no key / `canEncryptResult` is off — the plaintext JWS JSON.
 * A JSON JWS starts with `{`; anything else is the ECIES ciphertext.
 *
 * `privateKey` may be absent (plaintext delivery); an encrypted delivery with
 * no key throws a clear error.
 */
export async function decryptCallback(
	privateKey: DecryptionKey | undefined,
	body: CallbackBody,
): Promise<Jws> {
	const data = payloadFrom(body)
	const trimmed = data.trim()

	// Plaintext delivery: `data` is the JWS JSON directly.
	if(trimmed.startsWith('{')) {
		return JSON.parse(trimmed) as Jws
	}

	// Otherwise it's an ECIES ciphertext (base64url).
	if(!privateKey) {
		throw new Error(
			'received an encrypted (ECIES) delivery but no org ETH private key was '
				+ 'provided — pass the 0x-hex private key: '
				+ 'results.receive(body, { orgEthPrivateKey }) or '
				+ 'decrypt(body, orgEthPrivateKey)',
		)
	}

	const plaintext = eciesDecrypt(privateKey, base64urlToBytes(trimmed))
	return JSON.parse(new TextDecoder().decode(plaintext)) as Jws
}

/**
 * Sign a verification result as a flattened JWS (JOSE ES256K = ECDSA/secp256k1
 * over SHA-256 of the `<protected>.<payload>` signing input — a single hash).
 * `kid` is the signer's ETH address (published via JWKS); `iss` is the issuer
 * URL. Used by Builder to sign results before encrypting them.
 */
export function signResultJws(
	privateKeyHex: string,
	payload: Record<string, unknown>,
	iss: string,
): Jws {
	const priv = hexToBytes(privateKeyHex)
	const protectedHeader = b64url(
		JSON.stringify({
			alg: 'ES256K',
			kid: addressFromUncompressedPubkey(secp.getPublicKey(priv, false)),
			typ: 'JWS',
			iss,
		}),
	)
	const payloadB64 = b64url(JSON.stringify(payload))
	const signingInput = new TextEncoder().encode(
		`${protectedHeader}.${payloadB64}`,
	)
	// Standard ES256K: a single SHA-256 of the signing input. `prehash:false`
	// stops @noble hashing the digest again, so any JOSE tool can verify it.
	const sig = secp.sign(sha256(signingInput), priv, { prehash: false })
	return {
		payload: payloadB64,
		signatures: [{ protected: protectedHeader, signature: b64url(sig) }],
	}
}

/** Decode the JWS payload (base64url JSON). */
export function decodeJwsPayload(jws: Jws): Record<string, unknown> {
	return JSON.parse(
		new TextDecoder().decode(base64urlToBytes(jws.payload)),
	) as Record<string, unknown>
}

/**
 * Verify a JWS signature (JOSE ES256K = ECDSA/secp256k1 over SHA-256 of the
 * `<protected>.<payload>` signing input) with an uncompressed public key.
 */
export function verifyJwsSignature(jws: Jws, signerPublicKey: string): boolean {
	const pub = hexToBytes(signerPublicKey)
	return jws.signatures.some((s) => {
		try {
			const header = JSON.parse(
				new TextDecoder().decode(base64urlToBytes(s.protected)),
			) as Record<string, unknown>
			if(header.alg !== 'ES256K') {
				return false
			}

			const signingInput = new TextEncoder().encode(
				`${s.protected}.${jws.payload}`
			)
			const digest = sha256(signingInput)
			const sig = base64urlToBytes(s.signature)
			// digest is the single SHA-256 of the signing input — don't let
			// @noble hash it again (standard ES256K).
			return secp.verify(sig, digest, pub, { prehash: false })
		} catch{
			return false
		}
	})
}

export interface VerifyResultFullOptions {
	/** The `reclaimSessionId` the consumer expects (mismatch fails). */
	reclaimSessionId?: string
	/** Optional organization ETH private key used to verify legacy TEE binding.
	 *  Callers must provide it for each verification; it isn't retained. */
	orgEthPrivateKey?: string
	/** The consumer's `orgId`; the result's `aud` must match it. */
	expectedAud?: string
	/** Allowlist of trusted attestor ETH addresses (lowercased compared). */
	attestorAddresses?: string[]
	/** Explicitly trusted Builder issuers. */
	trustedIssuers?: string[]
	/** Explicit trusted Builder JWKS URL. */
	jwksUrl?: string
	/**
	 * Proof validation options applied to all proofs.
	 * `requireSessionBinding` defaults to true when an expected session is set.
	 */
	proofValidation?: VerifyRequestProofOptions
	/** Per-provider overrides for sessions containing different providers. */
	proofValidationByProviderId?: Record<string, VerifyRequestProofOptions>
	/** Hash requirements, for the common simple case. */
	hashes?: ProofHashRequirement[]
	/** Resolved Builder recipes, used to derive strict proof hashes offline. */
	proofRecipes?: BuilderProofRecipe[]
	/** Resolve a Builder session and its immutable, resolved recipes. */
	resolveSession?: (
		sessionId: string,
	) => Promise<{ recipes: BuilderProofRecipe[] }>
		| { recipes: BuilderProofRecipe[] }
	/** Override Builder's signer key instead of JWKS discovery.
	 *  The header `iss` is otherwise used only after trust checks. */
	signerPublicKey?: string
	/** Injectable fetch (for JWKS); defaults to global `fetch`. */
	fetchImpl?: typeof fetch
	/** Override "now" (Unix seconds) when checking a legacy result's `exp`. */
	now?: number
	/**
	 * Accept a legacy Builder result that contains an expired `exp` claim.
	 * New Builder results don't include `exp`; use this only while consuming
	 * older stored results whose signatures and proofs must remain verifiable.
	 */
	ignoreExpiration?: boolean
	/**
	 * How to verify email proofs in an AI-session result. `signature`
	 * (default) checks the Portal signature, the signed request binding, and
	 * the email digests. `full` also re-runs DKIM and re-checks the evidence;
	 * it needs Linux, Bubblewrap 0.12 or later, and the client's optional
	 * email peer dependencies, and it fails rather than falling back.
	 */
	emailVerification?: EmailVerificationMode
	/**
	 * Trusted Reclaim Portal email signer addresses, added to the
	 * `x-reclaim-email-issuers` list in Builder's JWKS.
	 */
	emailIssuers?: string[]
	/**
	 * Accept email proofs even though `hashes`, `proofRecipes`, or
	 * `proofValidation.hashes`/`providerId` pin which proofs are acceptable.
	 * Those pins only describe Reclaim proofs, so by default an email entry
	 * fails with `email-not-allowed` when any of them is set.
	 */
	allowEmailProofs?: boolean
}

export interface ResultProofOutcome {
	/** Which provider this proof belongs to (results grouped per provider). */
	providerId?: string
	/** Exact immutable provider version used to validate this proof. */
	resolvedVersion?: string
	requestId?: string
	/** Exact proof carried by the Builder-signed result. */
	proof?: ReclaimRequestProof
	proofValid: boolean
	reason?: string
	/** On failure: true when a temporary condition caused it, such as a
	 *  network error while resolving the provider. */
	transient?: boolean
	/** @deprecated Use `attestorAddresses`; retained for compatibility. */
	attestorAddress?: string
	/** Every attestor address declared by the proof. */
	attestorAddresses?: string[]
	/** Provider hashes derived from this exact proof. */
	proofHashes?: string[]
	/** True when the claimant/session TEE attestation was requested and
	 * verified. */
	isTeeAttestationVerified?: boolean
	/** True when the attestor TEE attestation was requested and at least one
	 *  witness's `attestation_report` verified. False when the check ran but no
	 *  witness carried a report — the common production shape, where the
	 *  attestor address and claim signature are still verified. Undefined when
	 *  the check didn't run. */
	isAttestorTeeAttestationVerified?: boolean
	/** Trusted only when `proofValid` is true. */
	data?: TrustedData
	/** Provider-supplied data. It isn't cryptographically validated. */
	publicData?: unknown
	/** `email` for an email proof from an AI session. */
	method?: 'email'
	/** Exact email proof carried by the Builder-signed result. */
	emailProof?: EmailProofV1
	emailProvider?: EmailProvider
	/** Sender rule from the email request that the email matched. */
	sender?: string
	/** Domain of the DKIM signature that authenticated the email. */
	dkimSigner?: string
	/** Mailbox the user signed in with. */
	authenticatedAddress?: string
	/** Values extracted from the email. Trusted only when `proofValid`. */
	extractedParameters?: Record<string, string>
	/** Which email verification ran. */
	emailCheck?: EmailVerificationMode
}

export interface VerifyResultFullOutcome extends VerifyResultOutcome {
	proofs?: ResultProofOutcome[]
}

export interface ResultVerificationFailure extends VerifyResultFullOutcome {
	reason: string
	/** True when a temporary condition caused the failure. Set by the
	 *  verifier; read it as {@link ResultVerificationError.retryable}. */
	retryable?: boolean
}

/**
 * Thrown by {@link verifyResult} / {@link verifyResultFull} (and therefore
 * `reclaim.results.verify`/`receive`) when a result fails verification. Carries
 * the full invalid outcome so callers can inspect it in a `catch`.
 *
 * In a callback handler, answer 2xx when `retryable` is `false` (Builder
 * retrying the same delivery can't help) and 5xx when it's `true`:
 *
 *   try {
 *     const { result } = await reclaim.results.receive(body, {
 *       orgEthPrivateKey,
 *     })
 *     // result is verified — use result.payload
 *   } catch (err) {
 *     if (err instanceof ResultVerificationError) {
 *       // for example, 'expired', { payload, … }
 *       console.error(err.reason, err.outcome)
 *       res.sendStatus(err.retryable ? 503 : 200)
 *     }
 *   }
 */
export class ResultVerificationError extends Error {
	/** Machine-readable failure reason — `'bad-signature'`, `'expired'`,
	 *  `'reclaimSessionId-mismatch'`, `'aud-mismatch'`, `'invalid-proof'`, … */
	readonly reason: string
	/** The full (invalid) outcome: `payload`, `reclaimSessionId`, and per-proof
	 *  detail (`proofs`) when verification got that far. */
	readonly outcome: ResultVerificationFailure
	/**
	 * Whether a retry can succeed. `true` only for a temporary condition on
	 * the verifier's side: Builder's JWKS or recipe couldn't be fetched
	 * (network error, timeout, 5xx, 429). `false` when the result itself is
	 * wrong (signature, issuer, audience, session, expiry, invalid proof), so
	 * redelivering the same body fails the same way. Respond 5xx to a
	 * callback only when `true`.
	 */
	readonly retryable: boolean

	constructor(outcome: ResultVerificationFailure) {
		super(`result verification failed: ${outcome.reason}`)
		this.name = 'ResultVerificationError'
		this.reason = outcome.reason
		this.outcome = outcome
		this.retryable = outcome.retryable ?? false
	}
}

/**
 * Full consumer verification: resolves a configured Builder issuer before
 * using JWKS (header `iss`/`kid`), verifies the top-level JWS, checks
 * `reclaimSessionId`/`aud` and any legacy `exp`, then verifies each exact
 * proof.
 * Network access (JWKS and optional provider resolution) makes this async.
 * Use {@link verifyResult} for the offline primitive.
 */
export async function verifyResultFull(
	jws: Jws,
	opts: VerifyResultFullOptions = {},
): Promise<VerifyResultFullOutcome> {
	const payload = decodeJwsPayload(jws)
	const reclaimSessionId = payload.reclaimSessionId as string | undefined
	let jwksAttestorAddresses: string[] = []
	let jwksAttestorImageDigests: string[] = []
	let jwksEmailIssuers: string[] = []
	/** Throw with the full invalid outcome — verification never *returns* an
	 *  invalid result. */
	const fail = (
		reason: string,
		extra: Partial<ResultVerificationFailure> = {},
	): never => {
		throw new ResultVerificationError({
			reason,
			payload,
			reclaimSessionId,
			...extra,
		})
	}

	// 1. Resolve Builder's signer key. Never use the signed header's `iss` as a
	// network destination until it has matched an explicitly trusted issuer.
	let signerPublicKey = opts.signerPublicKey
	let header: Record<string, unknown> = {}
	const sig0 = jws.signatures[0]
	if(sig0) {
		try {
			header = JSON.parse(
				new TextDecoder().decode(base64urlToBytes(sig0.protected)),
			)
		} catch{
			return fail('bad-header')
		}
	}

	if(!signerPublicKey) {
		const configuredIssuers = resolveTrustedIssuers(opts)

		if(!configuredIssuers.length) {
			return fail('issuer-not-configured')
		}

		const iss = String(header.iss ?? '')
		if(!iss) {
			return fail('no-issuer')
		}

		// Read before the signature is checked, so it is attacker-supplied: a
		// real issuer is a short origin, never kilobytes.
		if(iss.length > MAX_ISSUER_LENGTH) {
			return fail('issuer-not-trusted')
		}

		const trustedIssuer = configuredIssuers.find((candidate) => (
			normalizeIssuer(candidate) === normalizeIssuer(iss)
		))
		if(!trustedIssuer) {
			return fail('issuer-not-trusted')
		}

		let keys: Jwk[]
		try {
			const registry = await fetchReclaimJwks(
				opts.jwksUrl
					?? `${stripTrailingSlashes(trustedIssuer)}/.well-known/jwks.json`,
				opts.fetchImpl,
			)
			keys = registry.keys
			jwksAttestorAddresses = registry['x-reclaim-attestors'] ?? []
			jwksAttestorImageDigests =
				registry['x-reclaim-attestor-image-digests'] ?? []
			jwksEmailIssuers = registry['x-reclaim-email-issuers'] ?? []
		} catch(error) {
			return fail('jwks-fetch-failed', {
				retryable: isTransientError(error),
			})
		}

		const jwk = selectVerificationResultKey(
			keys,
			String(header.kid ?? ''),
		)
		if(!jwk) {
			return fail('signer-key-not-found')
		}

		signerPublicKey = jwkToUncompressedPublicKey(jwk)
	}

	if(header.alg !== 'ES256K') {
		return fail('unsupported-algorithm')
	}

	if(!sig0 || !verifyJwsSignature({
		payload: jws.payload,
		signatures: [sig0],
	}, signerPublicKey)) {
		return fail('bad-signature')
	}

	if(
		typeof payload.iss === 'string'
		&& typeof header.iss === 'string'
		&& normalizeIssuer(payload.iss) !== normalizeIssuer(header.iss)
	) {
		return fail('issuer-mismatch')
	}

	// 2. Session binding, audience, and optional legacy result expiry.
	const expectedResultSessionId = opts.reclaimSessionId
	if(expectedResultSessionId && reclaimSessionId !== expectedResultSessionId) {
		return fail('reclaimSessionId-mismatch')
	}

	if(opts.expectedAud && payload.aud !== opts.expectedAud) {
		return fail('aud-mismatch')
	}

	const now = opts.now ?? Math.floor(Date.now() / 1000)
	if(
		!opts.ignoreExpiration
		&& typeof payload.exp === 'number'
		&& payload.exp < now
	) {
		return fail('expired')
	}

	// 3. Verify every exact proof carried by the signed result. The outer
	// envelope groups proofs by provider, but it never changes the proof shape.
	const providerResults = Array.isArray(payload.results)
		? (payload.results as Record<string, unknown>[])
		: []
	const proofs: ResultProofOutcome[] = []
	const proofGroups: {
		providerId?: string
		providerVersion?: string
		proof: ReclaimRequestProof
		outcomeIndex: number
	}[] = []
	const emailEntries: {
		proof: unknown
		email: EmailEntryNames
		request: EmailRequest
		outcomeIndex: number
	}[] = []
	const emailPinned = !opts.allowEmailProofs && pinsProofContent(opts)
	for(const prov of providerResults) {
		const providerId =
			typeof prov.provider_id === 'string' ? prov.provider_id : undefined
		const providerVersion = typeof prov.resolved_version === 'string'
			? prov.resolved_version
			: undefined
		const requests = Array.isArray(prov.requests)
			? (prov.requests as Record<string, unknown>[])
			: []
		for(const r of requests) {
			const requestId =
				typeof r.request_id === 'string' ? r.request_id : undefined
			if(isEmailEntry(r)) {
				const email = emailEntryOf(r.email)
				const outcome: ResultProofOutcome = {
					providerId,
					resolvedVersion: providerVersion,
					requestId,
					method: 'email',
					proofValid: false,
				}
				proofs.push(outcome)
				if(emailPinned) {
					// The caller pinned which proofs are acceptable, and an email
					// proof can't match a Reclaim proof pin.
					outcome.reason = 'email-not-allowed'
				} else if(!email) {
					// Builder always sends the email request. Without it nothing
					// binds the proof to this app and session, so fail closed.
					outcome.reason = 'email-proof-invalid'
				} else {
					emailEntries.push({
						proof: r.proof,
						email,
						request: email.request,
						outcomeIndex: proofs.length - 1,
					})
				}

				continue
			}

			if(!isReclaimRequestProof(r.proof)) {
				proofs.push({
					providerId,
					resolvedVersion: providerVersion,
					requestId,
					proofValid: false,
					reason: 'proof-missing',
				})
				continue
			}

			proofs.push({
				providerId,
				resolvedVersion: providerVersion,
				requestId,
				proof: r.proof,
				proofValid: true,
				attestorAddress: r.proof.witnesses[0]?.id,
				attestorAddresses: r.proof.witnesses.map(({ id }) => id),
			})
			proofGroups.push({
				providerId,
				providerVersion,
				proof: r.proof,
				outcomeIndex: proofs.length - 1,
			})
		}
	}

	const verificationStatus = getVerificationStatus(payload)
	if(
		verificationStatus === 'success'
		&& !proofGroups.length
		&& !proofs.some((p) => p.method === 'email')
	) {
		return fail('proof-missing', { proofs })
	}

	if(proofGroups.length) {
		const expectedSessionId = expectedResultSessionId
		const hasTeeBoundProof = proofGroups.some(({ proof }) => (
			proofHasTeeBinding(proof)
		))
		const configuredProofValidation = {
			...opts.proofValidation,
			...(opts.orgEthPrivateKey && hasTeeBoundProof
				? {
					teeAttestation: {
						appSecret: opts.orgEthPrivateKey,
					},
				}
				: {}),
		}
		const attestorAddresses = [...new Set([
			...(configuredProofValidation?.attestorAddresses ?? []),
			...(opts.attestorAddresses ?? []),
			...jwksAttestorAddresses,
		])]
		const configuredAttestorTee =
			configuredProofValidation?.attestorTeeAttestation
		const configuredImageDigests =
			configuredAttestorTee?.expectedImageDigests
		let expectedImageDigests = jwksAttestorImageDigests
		if(configuredImageDigests?.length && jwksAttestorImageDigests.length) {
			const registry = new Set(jwksAttestorImageDigests)
			expectedImageDigests = [...new Set(configuredImageDigests
				.map((digest) => digest.trim().toLowerCase())
				.filter((digest) => registry.has(digest)))]
			if(!expectedImageDigests.length) {
				return fail('attestor-image-trust-mismatch', { proofs })
			}
		} else if(configuredImageDigests?.length) {
			expectedImageDigests = configuredImageDigests
		}

		// A caller-configured check requires a `claimAttestation` on every
		// witness. Registry digests alone only pin the attestor reports that
		// are present, as `@reclaimprotocol/js-sdk` does by default — a portal
		// TEE proof without a bound nonce carries no envelope.
		const attestorTeeAttestation = configuredAttestorTee
			&& expectedImageDigests.length
			? { ...configuredAttestorTee, expectedImageDigests }
			: configuredAttestorTee
		const commonValidation = {
			...configuredProofValidation,
			...(opts.hashes ? { hashes: opts.hashes } : {}),
			...(attestorAddresses.length
				? { attestorAddresses }
				: {}),
			...(attestorTeeAttestation
				? { attestorTeeAttestation }
				: {}),
			...(expectedImageDigests.length
				? { attestorImageDigests: expectedImageDigests }
				: {}),
			...(expectedSessionId
				? {
					expectedSessionId,
					requireSessionBinding:
						configuredProofValidation?.requireSessionBinding ?? true,
				}
				: {}),
		}
		if(hasContentValidation(commonValidation)) {
			await verifyRequestProofGroup(proofGroups, commonValidation)
		} else if(isProviderlessAiResult(payload, providerResults)) {
			// AI sessions have no provider or recipe, so there is no content to
			// match. Attestor trust, proof signatures, and session binding still
			// apply through `commonValidation`.
			await verifyRequestProofGroup(proofGroups, {
				...commonValidation,
				dangerouslyDisableContentValidation: true,
			})
		} else {
			await verifyByResolvedRecipes(commonValidation, expectedSessionId)
		}
	}

	if(emailEntries.length) {
		await verifyEmailEntries()
	}

	if(!proofs.every((p) => p.proofValid)) {
		// Retry only when every failure is transient; one genuinely invalid
		// proof makes redelivery pointless.
		return fail('invalid-proof', {
			proofs,
			retryable: proofs.every((p) => p.proofValid || p.transient),
		})
	}

	return { payload, reclaimSessionId, proofs }

	async function verifyRequestProofGroup(
		group: typeof proofGroups,
		validation: VerifyRequestProofOptions,
	) {
		const requestProofOutcome = await verifyRequestProof(
			group.map(({ proof }) => proof),
			validation,
		)
		if(requestProofOutcome.valid) {
			for(const [index, item] of group.entries()) {
				const outcome = proofs[item.outcomeIndex]
				const hashes = resultProofHashes(
					item.proof,
					validation.hasNoPii,
				)
				if(hashes) {
					outcome.proofHashes = hashes
				}

				if(requestProofOutcome.isTeeAttestationVerified !== undefined) {
					outcome.isTeeAttestationVerified =
						requestProofOutcome.isTeeAttestationVerified
				}

				if(requestProofOutcome.isAttestorTeeAttestationVerified !== undefined) {
					outcome.isAttestorTeeAttestationVerified =
						requestProofOutcome.isAttestorTeeAttestationVerified
				}

				outcome.data = requestProofOutcome.data?.[index]
				outcome.publicData = requestProofOutcome.publicData?.[index]
			}

			return
		}

		for(const { outcomeIndex } of group) {
			proofs[outcomeIndex].proofValid = false
			proofs[outcomeIndex].reason = requestProofOutcome.reason
			proofs[outcomeIndex].transient = requestProofOutcome.transient
		}
	}

	async function verifyByResolvedRecipes(
		common: VerifyRequestProofOptions,
		expectedSessionId: string | undefined,
	) {
		let recipes = opts.proofRecipes
		if(!recipes && expectedSessionId && opts.resolveSession) {
			try {
				const resolved = await opts.resolveSession(expectedSessionId)
				recipes = resolved.recipes
			} catch(error) {
				return fail('session-resolution-failed', {
					proofs,
					retryable: isTransientError(error),
				})
			}
		}

		const groups = Map.groupBy(proofGroups, proofGroupKey)
		if(recipes && !recipeGroupsMatch(recipes, groups)) {
			markInvalid(proofGroups, 'recipe-mismatch')
			return fail('invalid-proof', { proofs })
		}

		for(const group of groups.values()) {
			await verifyResolvedGroup(group, recipes, common)
		}
	}

	async function verifyResolvedGroup(
		group: typeof proofGroups,
		recipes: BuilderProofRecipe[] | undefined,
		common: VerifyRequestProofOptions,
	) {
		const providerId = group[0]?.providerId
		const providerVersion = group[0]?.providerVersion
		const providerValidation = providerId
			? opts.proofValidationByProviderId?.[providerId]
			: undefined
		const recipe = recipes?.find((candidate) => (
			candidate.providerId === providerId
			&& candidate.resolvedVersion === providerVersion
		))
		let hashes: ProofHashRequirement[] | undefined
		if(recipe) {
			try {
				hashes = proofHashesFromBuilderRecipe(
					recipe,
					group.map(({ proof }) => proof),
				)
			} catch{
				markInvalid(group, 'recipe-hash-failed')
				return
			}
		}

		const validation = {
			...common,
			...(recipe
				? { hashes }
				: providerId
					? { providerId, providerVersion }
					: {}),
			...providerValidation,
			...(common.expectedSessionId
				? {
					sessionId: common.sessionId,
					expectedSessionId: common.expectedSessionId,
					requireSessionBinding: common.requireSessionBinding,
				}
				: {}),
		}
		await verifyRequestProofGroup(group, validation)
	}

	async function verifyEmailEntries() {
		// Loaded only for email results, so other results never load the
		// email verifier.
		const { normalizeEmailIssuers, verifyEmailProof } = await import(
			'./email/index.ts'
		)
		const { snapshotEmailProof } = await import('./email/core/protocol.ts')
		// Throws on a malformed `emailIssuers` entry: a configuration error,
		// not a bad result.
		const trustedIssuers = normalizeEmailIssuers([
			...opts.emailIssuers ?? [],
			...jwksEmailIssuers,
		])
		// Email proofs expire an hour after Portal issues them, but a Builder
		// result stays verifiable. Builder verified each proof before it signed
		// `iat`, so check expiry at that time unless the caller sets `now`.
		const emailNow = opts.now
			?? (typeof payload.iat === 'number' ? payload.iat : undefined)
		for(const { proof, email, request, outcomeIndex } of emailEntries) {
			const outcome = proofs[outcomeIndex]
			try {
				const verified = await verifyEmailProof(proof, {
					trustedIssuers,
					mode: opts.emailVerification ?? 'signature',
					request,
					now: emailNow,
				})
				if(
					email.provider !== verified.emailProvider
					|| email.sender !== verified.sender
					|| email.dkimSigner !== verified.dkimSigner
				) {
					outcome.reason = 'email-proof-invalid'
					continue
				}

				outcome.proofValid = true
				outcome.emailProof = snapshotEmailProof(proof)
				outcome.emailProvider = verified.emailProvider
				outcome.sender = verified.sender
				outcome.dkimSigner = verified.dkimSigner
				outcome.authenticatedAddress = verified.authenticatedAddress
				outcome.extractedParameters = verified.extractedParameters
				outcome.emailCheck = verified.emailCheck
			} catch(error) {
				outcome.reason = emailFailureReason(error)
				// The host can't run `full` mode yet; once it can, a redelivery
				// of the same result can succeed.
				outcome.transient =
					outcome.reason === 'email-full-verification-unavailable'
			}
		}
	}

	function markInvalid(group: typeof proofGroups, reason: string) {
		for(const { outcomeIndex } of group) {
			proofs[outcomeIndex].proofValid = false
			proofs[outcomeIndex].reason = reason
		}
	}
}

/** Whether a proof declares the session TEE nonce that the org key verifies. */
function proofHasTeeBinding(proof: ReclaimRequestProof) {
	// A `confidential-space` witness carries the attestation itself, so the
	// proof is TEE-bound even before the context is read. Triggering on it too
	// means a proof that ships the evidence can't skip the check by omitting
	// `attestationNonce` — `verifyTeeAttestation` needs that nonce and fails
	// loudly without it, which is the right outcome.
	const hasTeeWitness = (proof.witnesses ?? []).some((witness) => (
		witness.claimAttestation?.type === 'confidential-space'
		&& !!witness.claimAttestation.tee_attestation
	))
	if(hasTeeWitness) {
		return true
	}

	try {
		const context = JSON.parse(proof.claimData.context)
		return context && typeof context === 'object'
			&& typeof context.attestationNonce === 'string'
			&& context.attestationNonce.length > 0
	} catch{
		return false
	}
}

function resultProofHashes(
	proof: ReclaimRequestProof,
	hasNoPii: true | undefined,
) {
	try {
		return getHashFromProof(proof, hasNoPii)
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

/**
 * Whether a result comes from an AI session: the session declares no
 * providers, and no `results` entry names a provider or version. Any other
 * shape, including a mix of both kinds of entries, takes the recipe path.
 */
function isProviderlessAiResult(
	payload: Record<string, unknown>,
	entries: Record<string, unknown>[],
) {
	const session = payload.verification_session
	if(!session || typeof session !== 'object' || Array.isArray(session)) {
		return false
	}

	const { providers } = session as Record<string, unknown>
	return Array.isArray(providers)
		&& providers.length === 0
		&& entries.length > 0
		&& entries.every((entry) => (
			entry.provider_id === undefined
			&& entry.resolved_version === undefined
		))
}

function proofGroupKey(group: {
	providerId?: string
	providerVersion?: string
}) {
	return `${group.providerId ?? ''}\u0000${group.providerVersion ?? ''}`
}

function recipeGroupsMatch(
	recipes: BuilderProofRecipe[],
	groups: ReadonlyMap<string, unknown>,
) {
	const expected = new Set(recipes.map((recipe) => (
		`${recipe.providerId}\u0000${recipe.resolvedVersion}`
	)))
	return expected.size === groups.size
		&& [...groups.keys()].every((key) => expected.has(key))
}

/** An AI-session entry carrying a Reclaim Portal email proof. */
function isEmailEntry(entry: Record<string, unknown>) {
	return entry.method === 'email'
		|| (
			!!entry.proof
			&& typeof entry.proof === 'object'
			&& 'proofType' in entry.proof
			&& entry.proof.proofType === 'email-v1'
		)
}

interface EmailEntryNames {
	provider: unknown
	sender: unknown
	dkimSigner: unknown
	request: EmailRequest
}

/** The entry's `email` object, when it carries the email request. */
function emailEntryOf(email: unknown): EmailEntryNames | undefined {
	if(
		!email
		|| typeof email !== 'object'
		|| !('request' in email)
		|| !email.request
		|| typeof email.request !== 'object'
	) {
		return undefined
	}

	return {
		provider: 'provider' in email ? email.provider : undefined,
		sender: 'sender' in email ? email.sender : undefined,
		dkimSigner: 'dkimSigner' in email ? email.dkimSigner : undefined,
		// `verifyEmailProof` validates the request's shape before using it.
		request: email.request as EmailRequest,
	}
}

/** Whether the caller pinned which Reclaim proofs are acceptable. */
function pinsProofContent(opts: VerifyResultFullOptions) {
	return Boolean(
		opts.hashes?.length
		|| opts.proofRecipes?.length
		|| opts.proofValidation?.hashes?.length
		|| opts.proofValidation?.providerId,
	)
}

const EMAIL_FAILURE_REASONS = new Set([
	'email-issuer-not-trusted',
	'email-proof-invalid',
	'email-full-verification-unavailable',
])

function emailFailureReason(error: unknown) {
	const reason = error && typeof error === 'object' && 'reason' in error
		? error.reason
		: undefined
	return typeof reason === 'string' && EMAIL_FAILURE_REASONS.has(reason)
		? reason
		: 'email-proof-invalid'
}

function isReclaimRequestProof(value: unknown): value is ReclaimRequestProof {
	if(!value || typeof value !== 'object' || Array.isArray(value)) {
		return false
	}

	const proof = value as Record<string, unknown>
	return typeof proof.identifier === 'string'
		&& !!proof.claimData
		&& typeof proof.claimData === 'object'
		&& Array.isArray(proof.signatures)
		&& Array.isArray(proof.witnesses)
		&& 'extractedParameterValues' in proof
}

function getVerificationStatus(payload: Record<string, unknown>) {
	const session = payload.verification_session
	if(!session || typeof session !== 'object' || Array.isArray(session)) {
		return undefined
	}

	const status = (session as Record<string, unknown>).status
	return typeof status === 'string' ? status : undefined
}

function normalizeIssuer(issuer: string): string {
	return stripTrailingSlashes(issuer.trim()).toLowerCase()
}

function resolveTrustedIssuers(opts: VerifyResultFullOptions): string[] {
	return [...new Set((opts.trustedIssuers ?? []).map(normalizeIssuer))]
}

/** Decrypt-and-verify in one step. */
export function verifyResult(
	jws: Jws,
	opts: VerifyResultOptions = {},
): VerifyResultOutcome {
	const payload = decodeJwsPayload(jws)
	const reclaimSessionId = payload.reclaimSessionId as string | undefined

	if(opts.signerPublicKey && !verifyJwsSignature(jws, opts.signerPublicKey)) {
		throw new ResultVerificationError({
			reason: 'bad-signature', payload, reclaimSessionId,
		})
	}

	if(
		opts.reclaimSessionId &&
		reclaimSessionId !== opts.reclaimSessionId
	) {
		throw new ResultVerificationError({
			reason: 'reclaimSessionId-mismatch',
			payload,
			reclaimSessionId,
		})
	}

	return { payload, reclaimSessionId }
}
