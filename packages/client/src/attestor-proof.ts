/**
 * Verify a result's nested attestor proof (RFC 7515 JWS, base64url-encoded).
 *
 * The attestor signs the claim with a standard EIP-191 / `personal_sign`
 * signature (`0x19 ‖ "Ethereum Signed Message:\n" ‖ len ‖ data`) over the
 * canonical sign-data — NOT the JOSE signing input. The sign-data (and the
 * claim identifier inside it) comes straight from
 * `@reclaimprotocol/attestor-core`'s `createSignDataForClaim` (which calls
 * `getIdentifierFromClaimInfo`), so this
 * module stays in lockstep with the attestor by construction; it only adds the
 * EIP-191 digest + secp256k1 address recovery and matches the JWS header `kid`.
 */
import { keccak_256 } from '@noble/hashes/sha3.js'
import { createSignDataForClaim } from '@reclaimprotocol/attestor-core'
import { eip191Digest } from './eip191.ts'
import { base64urlToBytes, bytesToHex } from './encoding.ts'
import { secp } from './secp.ts'

function decodeJson(b64url: string): Record<string, unknown> {
	return JSON.parse(new TextDecoder().decode(base64urlToBytes(b64url)))
}

/** The canonical string the attestor signs for a claim — delegated to
 *  attestor-core so the identifier hash + serialization can't drift. The
 *  decoded claim's fields are coerced to attestor-core's `CompleteClaimData`
 *  shape (context is always the JSON string the attestor signs over). */
function createSignData(claim: Record<string, unknown>): string {
	const raw = claim.context
	const context = typeof raw === 'string'
		? raw
		: raw !== null && raw !== undefined
			? JSON.stringify(raw)
			: ''
	return createSignDataForClaim({
		provider: String(claim.provider ?? ''),
		parameters: String(claim.parameters ?? ''),
		context,
		owner: String(claim.owner ?? ''),
		timestampS: Number(claim.timestampS ?? 0),
		epoch: Number(claim.epoch ?? 0),
	})
}

/** Recover the lowercase ETH address from a 65-byte r‖s‖v signature. */
function recoverEthAddress(digest: Uint8Array, sig: Uint8Array): string {
	const v = sig[64]
	const recovery = v >= 27 ? v - 27 : v
	const recovered = new Uint8Array(65)
	recovered[0] = recovery
	recovered.set(sig.subarray(0, 64), 1)
	// digest is already the final keccak hash — don't let noble re-hash it.
	const compressed = secp.recoverPublicKey(recovered, digest, {
		prehash: false,
	})
	const uncompressed = secp.Point.fromBytes(compressed).toBytes(false)
	return '0x' + bytesToHex(keccak_256(uncompressed.slice(1))).slice(-40)
}

export interface NestedProofOutcome {
	valid: boolean
	reason?: string
	/** Recovered attestor ETH address. */
	attestorAddress?: string
	/** Decoded claim data. */
	claim?: Record<string, unknown>
	/** Recovered signers, in nested JWS signature order. */
	attestorAddresses?: string[]
	/** Decoded protected headers, in nested JWS signature order. */
	headers?: Record<string, unknown>[]
	/** The raw nested signatures, in hex form. */
	signatures?: string[]
}

/**
 * Verify a base64url-encoded nested attestor proof JWS: recover the attestor
 * address from the claim signature and require it to match the header `kid`
 * (and, if `attestorAddresses` is given, be in that allowlist).
 */
export function verifyNestedProof(
	proofB64: string,
	opts: { attestorAddresses?: string[] } = {},
): NestedProofOutcome {
	let jws: {
		payload?: string
		signatures?: { protected: string, signature: string }[]
	}
	try {
		jws = JSON.parse(new TextDecoder().decode(base64urlToBytes(proofB64)))
	} catch{
		return { valid: false, reason: 'proof-not-jws' }
	}

	if(!jws.payload || !jws.signatures?.length) {
		return { valid: false, reason: 'proof-malformed' }
	}

	let claim: Record<string, unknown>
	try {
		claim = decodeJson(jws.payload)
	} catch{
		return { valid: false, reason: 'proof-decode-failed' }
	}

	const recoveredAddresses: string[] = []
	const headers: Record<string, unknown>[] = []
	const signatures: string[] = []
	let firstFailure: NestedProofOutcome | undefined
	for(const sig of jws.signatures) {
		let header: Record<string, unknown>
		let recovered: string
		try {
			header = decodeJson(sig.protected)
			recovered = recoverEthAddress(
				eip191Digest(createSignData(claim)),
				base64urlToBytes(sig.signature),
			)
		} catch{
			firstFailure ||= { valid: false, reason: 'recover-failed', claim }
			continue
		}

		const kid = String(header.kid ?? '').toLowerCase()
		if(recovered.toLowerCase() !== kid) {
			firstFailure ||= {
				valid: false,
				reason: 'attestor-signature-mismatch',
				attestorAddress: recovered,
				claim,
			}
			continue
		}

		recoveredAddresses.push(recovered)
		headers.push(header)
		signatures.push('0x' + bytesToHex(base64urlToBytes(sig.signature)))
	}

	if(!recoveredAddresses.length) {
		return {
			...(firstFailure ?? { valid: false, reason: 'recover-failed' }),
			claim,
		}
	}

	if(opts.attestorAddresses) {
		const allow = opts.attestorAddresses.map((a) => a.toLowerCase())
		const allowedIndex = recoveredAddresses.findIndex(
			(a) => allow.includes(a.toLowerCase()),
		)
		if(allowedIndex < 0) {
			return {
				valid: false,
				reason: 'attestor-not-allowed',
				attestorAddress: recoveredAddresses[0],
				attestorAddresses: recoveredAddresses,
				headers,
				signatures,
				claim,
			}
		}
	}

	return {
		valid: true,
		attestorAddress: recoveredAddresses[0],
		attestorAddresses: recoveredAddresses,
		headers,
		signatures,
		claim,
	}
}
