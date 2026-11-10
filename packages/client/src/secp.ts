/**
 * Shared `@noble/secp256k1` instance with the v3 hash hooks wired once
 * (sign + recover need SHA-256 / HMAC-SHA256). Import `secp` from here — never
 * set `secp.hashes` ad-hoc — so the hooks are guaranteed initialized before any
 * sign/verify/recover call, regardless of import order.
 */
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import * as secp from '@noble/secp256k1'
import { bytesToHex } from './encoding.ts'

secp.hashes.sha256 = sha256
secp.hashes.hmacSha256 = (key: Uint8Array, msg: Uint8Array) => {
	return hmac(sha256, key, msg)
}

export { secp }

/** Lowercase 0x ETH address from an uncompressed (65-byte) public key:
 *  keccak256 of the 64-byte X‖Y (drop the 0x04 prefix), last 20 bytes. */
export function addressFromUncompressedPubkey(pub: Uint8Array): string {
	return '0x' + bytesToHex(keccak_256(pub.slice(1))).slice(-40)
}
