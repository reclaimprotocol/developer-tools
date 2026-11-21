/**
 * JWKS (RFC 7517) discovery for verifying result/proof signatures. Signers
 * (Builder, the Attestor) publish their secp256k1 public keys
 * at `<iss>/.well-known/jwks.json` with `kid` = the signer's ETH address.
 */
import {
	b64url,
	base64urlToBytes,
	bytesToHex,
	stripTrailingSlashes,
} from './encoding.ts'
import { addressFromUncompressedPubkey, secp } from './secp.ts'

export interface Jwk {
	kty: string
	crv: string
	x: string
	y: string
	kid?: string
	alg?: string
	use?: string
	key_ops?: string[]
	/** Restricts how Builder consumers may use this key. */
	'x-reclaim-purpose'?: 'verification-result' | 'attestor-proof'
	/** Attestor proofs use EIP-191 rather than JOSE ES256K. */
	'x-reclaim-signature-scheme'?: 'EIP-191'
}

export interface ReclaimJwks {
	keys: Jwk[]
	/** Trusted EIP-191 attestor signer addresses (public-key hashes). */
	'x-reclaim-attestors'?: string[]
	/** Trusted sha256 digests for attestor Confidential Space images. */
	'x-reclaim-attestor-image-digests'?: string[]
	/** Trusted Reclaim Portal email-proof signer addresses. */
	'x-reclaim-email-issuers'?: string[]
}

/**
 * Build the JWK set for an ES256K signing key (Builder's managed
 * result-signing key). `kid` is the key's ETH address; `x`/`y` are the
 * uncompressed public-key coordinates. Empty set when no key is configured.
 */
export function jwksFromPrivateKey(
	privateKeyHex?: string,
	metadata: Pick<Jwk, 'x-reclaim-purpose'> = {},
): { keys: Jwk[] } {
	if(!privateKeyHex) {
		return { keys: [] }
	}

	const priv = privateKeyHex.replace(/^0x/, '')
	const pub = secp.getPublicKey(
		Uint8Array.from(Buffer.from(priv, 'hex')),
		false, // uncompressed: 0x04 ‖ X ‖ Y
	)
	return {
		keys: [
			{
				kty: 'EC',
				crv: 'secp256k1',
				alg: 'ES256K',
				use: 'sig',
				key_ops: ['verify'],
				...metadata,
				kid: addressFromUncompressedPubkey(pub),
				x: b64url(pub.subarray(1, 33)),
				y: b64url(pub.subarray(33, 65)),
			},
		],
	}
}

/** Fetch the JWK set published at `<iss>/.well-known/jwks.json`. */
export async function fetchJwks(
	iss: string,
	fetchImpl: typeof fetch = fetch,
): Promise<Jwk[]> {
	const base = stripTrailingSlashes(iss)
	return fetchJwksUrl(`${base}/.well-known/jwks.json`, fetchImpl)
}

/** Fetch a JWK set from an explicitly trusted registry URL. */
export async function fetchJwksUrl(
	url: string,
	fetchImpl: typeof fetch = fetch,
): Promise<Jwk[]> {
	const jwks = await fetchReclaimJwks(url, fetchImpl)
	return jwks.keys
}

/** Fetch Builder's JWKS plus its namespaced attestor trust registry. */
export async function fetchReclaimJwks(
	url: string,
	fetchImpl: typeof fetch = fetch,
): Promise<ReclaimJwks> {
	assertSecureJwksUrl(url)
	const res = await fetchImpl(url)
	if(!res.ok) {
		// `status` lets callers tell a temporary Builder outage from a bad URL.
		throw Object.assign(
			new Error(`JWKS fetch failed for ${url}: HTTP ${res.status}`),
			{ status: res.status },
		)
	}

	const body = (await res.json()) as Partial<ReclaimJwks>
	return {
		keys: body.keys ?? [],
		'x-reclaim-attestors': validateAttestorAddresses(
			body['x-reclaim-attestors'] ?? [],
		),
		'x-reclaim-attestor-image-digests': validateAttestorImageDigests(
			body['x-reclaim-attestor-image-digests'] ?? [],
		),
		'x-reclaim-email-issuers': validateEmailIssuerAddresses(
			body['x-reclaim-email-issuers'] ?? [],
		),
	}
}

/** Find the key matching `kid` (case-insensitive — kids are ETH addresses). */
export function selectKey(keys: Jwk[], kid: string): Jwk | undefined {
	const want = kid.toLowerCase()
	return keys.find((k) => (k.kid ?? '').toLowerCase() === want)
}

/** Select Builder's result-signing key and validate its JOSE metadata. */
export function selectVerificationResultKey(
	keys: Jwk[],
	kid: string,
): Jwk | undefined {
	return keys.find((key) => (
		(key.kid ?? '').toLowerCase() === kid.toLowerCase()
		&& key.kty === 'EC'
		&& key.crv === 'secp256k1'
		&& (!key.alg || key.alg === 'ES256K')
		&& (!key.use || key.use === 'sig')
		&& (!key.key_ops || key.key_ops.includes('verify'))
		&& key['x-reclaim-purpose'] !== 'attestor-proof'
		&& jwkMatchesKid(key)
	))
}

/** Return ETH addresses from keys explicitly registered for attestor proofs. */
export function trustedAttestorAddresses(keys: Jwk[]): string[] {
	return keys
		.filter((key) => key['x-reclaim-purpose'] === 'attestor-proof')
		.map((key) => {
			if(
				key.kty !== 'EC'
				|| key.crv !== 'secp256k1'
				|| key.use !== 'sig'
				|| key['x-reclaim-signature-scheme'] !== 'EIP-191'
				|| (key.key_ops && !key.key_ops.includes('verify'))
			) {
				throw new Error('invalid attestor JWK metadata')
			}

			const address = addressFromUncompressedPubkey(
				hexPublicKeyBytes(jwkToUncompressedPublicKey(key)),
			).toLowerCase()
			if((key.kid ?? '').toLowerCase() !== address) {
				throw new Error(
					'attestor JWK kid does not match its ETH public key',
				)
			}

			return address
		})
}

/** Validate and normalize the JWKS address-only trust extension. */
export function validateAttestorAddresses(addresses: string[]): string[] {
	return normalizeAddresses(addresses, 'attestor address')
}

/** Validate and normalize the JWKS email-issuer trust extension. */
export function validateEmailIssuerAddresses(addresses: string[]): string[] {
	return normalizeAddresses(addresses, 'email issuer address')
}

function normalizeAddresses(addresses: string[], label: string) {
	return [...new Set(addresses.map((address) => {
		const normalized = address.trim().toLowerCase()
		if(!/^0x[0-9a-f]{40}$/.test(normalized)) {
			throw new Error(`invalid ${label} in JWKS trust registry`)
		}

		return normalized
	}))]
}

/** Validate and normalize sha256 image digests from a JWKS trust extension. */
export function validateAttestorImageDigests(digests: string[]): string[] {
	return [...new Set(digests.map((digest) => {
		const normalized = digest.trim().toLowerCase()
		if(!/^sha256:[0-9a-f]{64}$/.test(normalized)) {
			throw new Error('invalid attestor image digest in JWKS trust registry')
		}

		return normalized
	}))]
}

/**
 * Reconstruct the uncompressed secp256k1 public key (`0x04` + X + Y) from an
 * EC JWK's base64url `x`/`y` coordinates, for signature verification.
 */
export function jwkToUncompressedPublicKey(jwk: Jwk): string {
	const x = base64urlToBytes(jwk.x)
	const y = base64urlToBytes(jwk.y)
	if(x.length !== 32 || y.length !== 32) {
		throw new Error('invalid EC JWK: x/y must be 32 bytes each')
	}

	const out = new Uint8Array(65)
	out[0] = 0x04
	out.set(x, 1)
	out.set(y, 33)
	return '0x' + bytesToHex(out)
}

function jwkMatchesKid(key: Jwk): boolean {
	try {
		const address = addressFromUncompressedPubkey(
			hexPublicKeyBytes(jwkToUncompressedPublicKey(key)),
		)
		return address.toLowerCase() === key.kid?.toLowerCase()
	} catch{
		return false
	}
}

function assertSecureJwksUrl(value: string) {
	const url = new URL(value)
	if(url.protocol === 'https:' || (
		url.protocol === 'http:'
		&& ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
	)) {
		return
	}

	throw new Error('JWKS URL must use HTTPS except on loopback')
}

function hexPublicKeyBytes(value: string) {
	return Uint8Array.from(Buffer.from(value.slice(2), 'hex'))
}
