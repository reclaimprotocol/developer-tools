import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import * as secp from '@noble/secp256k1'

export type EthKeypair = {
	address: string
	privateKey: string
	/** Uncompressed secp256k1 public key (`0x04` + 128 hex). Used to derive the
	 *  ETH address, to verify ES256K JWS signatures (published via JWKS as
	 *  `x`/`y`), and — for an org's encryption key — to ECIES-encrypt results
	 *  (see ./enckeys.ts, ./result.ts). */
	publicKey: string
}

/** Bytes of CSPRNG seed `@noble`'s `randomSecretKey` expects (it reduces a
 *  ≥48-byte seed into a valid secp256k1 scalar). */
const SECRET_KEY_SEED_LEN = 48

/**
 * Fresh CSPRNG bytes from the Web Crypto API. We read `crypto`
 * (`getRandomValues`) — the WHATWG global present in browsers and Node ≥ 20
 * alike — and SEED `@noble`'s key generation from it, rather than letting
 * `@noble` dereference `globalThis.crypto` itself: its access is unguarded
 * (`(globalThis?.crypto).getRandomValues(...)`) and throws an opaque
 * TypeError wherever the global is absent.
 */
function randomSeed(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(SECRET_KEY_SEED_LEN))
}

/**
 * Generate a fresh secp256k1 key-pair and derive its lowercase
 * Ethereum address (keccak-256 of the uncompressed pubkey minus the
 * `0x04` prefix, last 20 bytes).
 *
 * Lives in the client SDK so every consumer — the MCP `issue_credentials`
 * tool, scripts, future SDK callers — mints credentials the same way.
 * The private key is returned to the caller and MUST stay local; only
 * the derived address is ever sent to the server. The public key is an
 * intermediate value used to compute the address and is not retained.
 */
export function generateKeypair(): EthKeypair {
	const priv = secp.utils.randomSecretKey(randomSeed())
	const pub = secp.getPublicKey(priv, false)
	return {
		address: addressFromPubBytes(pub),
		privateKey: '0x' + bytesToHex(priv),
		publicKey: '0x' + bytesToHex(pub),
	}
}

/**
 * Recover the address from a hex-encoded private key. Used when
 * importing a key the user already holds.
 */
export function deriveFromPrivateKey(privateKey: string): EthKeypair {
	const hex = privateKey.replace(/^0x/, '')
	const priv = hexToBytes(hex)
	const pub = secp.getPublicKey(priv, false)
	return {
		address: addressFromPubBytes(pub),
		privateKey: '0x' + hex,
		publicKey: '0x' + bytesToHex(pub),
	}
}

/**
 * Derive the lowercase Ethereum address that owns an uncompressed secp256k1
 * public key (`0x04` + 128 hex) — keccak-256 of the key minus the `0x04`
 * prefix byte, last 20 bytes. The holder of the matching private key controls
 * this address; used to scope a callback subscription to its key's owner
 * without ever needing the private key.
 */
export function addressFromPublicKey(publicKey: string): string {
	return addressFromPubBytes(hexToBytes(publicKey.replace(/^0x/, '')))
}

/** keccak-256 of the uncompressed pubkey minus its `0x04` prefix byte,
 *  last 20 bytes — the Ethereum address derivation, lowercase (no checksum). */
function addressFromPubBytes(pub: Uint8Array): string {
	return '0x' + bytesToHex(keccak_256(pub.slice(1))).slice(-40)
}
