/**
 * secp256k1 (Ethereum) encryption-key helpers for ECIES result delivery.
 *
 * The org's encryption key is its **Ethereum public key** (secp256k1). The
 * Builder ECIES-encrypts the signed JWS to it (see ./result.ts) and
 * the Consumer decrypts with the matching eth **private key**. Eth-native `0x`
 * hex is used everywhere at the edges (the format MetaMask/ethers/wallets
 * emit); the wire/DB store the public key as a secp256k1 JWK
 * (`{kty:'EC',crv:'secp256k1',x,y}`), matching the signing JWKS shape in
 * ./jwks.ts.
 *
 * No PEM, no DER, no WebCrypto — `@noble/secp256k1` handles hex in every
 * runtime.
 */
import { b64url, hexToBytes } from './encoding.ts'
import { type Jwk, jwkToUncompressedPublicKey } from './jwks.ts'
import {
	addressFromPublicKey,
	deriveFromPrivateKey,
	generateKeypair,
} from './keypair.ts'

/** The Consumer's eth private key as `0x`+64 hex (a 32-byte secp256k1
 *  scalar). */
export type DecryptionKeyInput = string
/** The raw 32-byte private scalar — what `eciesjs.decrypt` consumes. */
export type DecryptionKey = Uint8Array

const ETH_PRIVATE_HEX = /^0x[0-9a-fA-F]{64}$/
const UNCOMPRESSED_PUBKEY_HEX = /^0x04[0-9a-fA-F]{128}$/

/**
 * Validate and load an eth private key (`0x`+64 hex) into the raw scalar bytes
 * `eciesjs.decrypt` needs. Pass the hex content — never a path or env-var name.
 */
export function loadDecryptionKey(input: DecryptionKeyInput): DecryptionKey {
	const v = input.trim().replace(/^['"]|['"]$/g, '')
	const hex = v.startsWith('0x') ? v : '0x' + v
	if(!ETH_PRIVATE_HEX.test(hex)) {
		throw new Error(
			'not a valid Ethereum private key (expected a 32-byte / 0x+64-hex '
				+ 'scalar)',
		)
	}

	return hexToBytes(hex)
}

/**
 * Convert an uncompressed secp256k1 public key (`0x04` + 128 hex) to the public
 * JWK the API stores and Builder encrypts to — so callers only
 * ever handle eth-native hex, never a JWK. Mirrors the `x`/`y` coordinate split
 * in `jwksFromPrivateKey` (./jwks.ts).
 */
export function uncompressedPubkeyToJwk(publicKeyHex: string): Jwk {
	const v = publicKeyHex.trim()
	const hex = v.startsWith('0x') ? v : '0x' + v
	if(!UNCOMPRESSED_PUBKEY_HEX.test(hex)) {
		throw new Error(
			'not a valid uncompressed secp256k1 public key '
				+ '(expected `0x04` + 128 hex)',
		)
	}

	const bytes = hexToBytes(hex) // 65 bytes: 0x04 ‖ X ‖ Y
	return {
		kty: 'EC',
		crv: 'secp256k1',
		x: b64url(bytes.subarray(1, 33)),
		y: b64url(bytes.subarray(33, 65)),
	}
}

/** Lowercase 0x ETH address that owns a secp256k1 public JWK (the org's
 *  identity address). */
export function pubkeyJwkToEthAddress(jwk: Jwk): string {
	return addressFromPublicKey(jwkToUncompressedPublicKey(jwk))
}

/** A freshly generated org encryption keypair, in every form callers need:
 *  the eth `0x`-hex private key (kept by the Consumer to decrypt), the
 *  uncompressed public key hex, the public JWK (sent to the API / stored), and
 *  the derived eth address. */
export interface GeneratedEthKeypair {
	privateKeyHex: string
	publicKeyHex: string
	publicJwk: Jwk
	ethAddress: string
}

/** Mint a fresh secp256k1 keypair for org encryption — the in-browser dashboard
 *  generator, the SDK, and tests all use this so every keypair is shaped the
 *  same way. The private key MUST stay local; only the public JWK is sent. */
export function generateEthKeypair(): GeneratedEthKeypair {
	const { privateKey, publicKey, address } = generateKeypair()
	return {
		privateKeyHex: privateKey,
		publicKeyHex: publicKey,
		publicJwk: uncompressedPubkeyToJwk(publicKey),
		ethAddress: address,
	}
}

/** Derive the same `GeneratedEthKeypair` shape from a private key the user
 *  already holds (`0x`+64 hex), so they can BYO a key instead of generating
 *  one. Validates the format and throws otherwise. The private key stays
 *  local — only the derived public key/address are ever surfaced. */
export function ethKeypairFromPrivateKey(input: string): GeneratedEthKeypair {
	const v = input.trim().replace(/^['"]|['"]$/g, '')
	const hex = v.startsWith('0x') ? v : '0x' + v
	if(!ETH_PRIVATE_HEX.test(hex)) {
		throw new Error(
			'not a valid Ethereum private key (expected a 32-byte / 0x+64-hex '
				+ 'scalar)',
		)
	}

	const { privateKey, publicKey, address } = deriveFromPrivateKey(hex)
	return {
		privateKeyHex: privateKey,
		publicKeyHex: publicKey,
		publicJwk: uncompressedPubkeyToJwk(publicKey),
		ethAddress: address,
	}
}
