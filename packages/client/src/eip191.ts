/**
 * EIP-191 / `personal_sign` primitives shared by the verification paths
 * (attestor-proof recovery) and by callers that need to *produce* a
 * personal_sign signature with a raw eth key (for example, the old-devtools
 * link-app flow) — without pulling in a full wallet library.
 */
import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, hexToBytes } from './encoding.ts'
import { secp } from './secp.ts'

const ENC = new TextEncoder()

/** Standard EIP-191 / personal_sign digest: keccak256 of
 *  `0x19 ‖ "Ethereum Signed Message:\n" ‖ len ‖ data`. */
export function eip191Digest(data: string | Uint8Array): Uint8Array {
	const bytes = typeof data === 'string' ? ENC.encode(data) : data
	const prefix = ENC.encode('\x19Ethereum Signed Message:\n')
	const len = ENC.encode(String(bytes.length))
	const merged = new Uint8Array(prefix.length + len.length + bytes.length)
	merged.set(prefix, 0)
	merged.set(len, prefix.length)
	merged.set(bytes, prefix.length + len.length)
	return keccak_256(merged)
}

/** EIP-191 personal_sign over `message` with a raw 0x-hex eth private key.
 *  Returns the standard 65-byte `r ‖ s ‖ v` hex signature that
 *  `ethers.verifyMessage(message, signature)` accepts — noble's `'recovered'`
 *  format prepends the recovery byte instead, so it's reordered to the end
 *  here (a raw `0`/`1` recovery byte is fine there, no `+27` needed). */
export function signEip191(
	message: string | Uint8Array,
	privateKeyHex: string,
): string {
	const digest = eip191Digest(message)
	const privateKey = hexToBytes(privateKeyHex)
	const recovered = secp.sign(digest, privateKey, {
		prehash: false,
		format: 'recovered',
	}) as Uint8Array
	const recovery = recovered[0]
	const rs = recovered.slice(1)
	return '0x' + bytesToHex(rs) + recovery.toString(16).padStart(2, '0')
}

/** Recover the lowercase Ethereum address from an EIP-191 signature. */
export function recoverEip191Address(
	message: string | Uint8Array,
	signatureHex: string,
): string {
	const signature = hexToBytes(signatureHex)
	if(signature.length !== 65) {
		throw new Error('EIP-191 signature must contain 65 bytes')
	}

	const recovery = signature[64] >= 27
		? signature[64] - 27
		: signature[64]
	const recovered = new Uint8Array(65)
	recovered[0] = recovery
	recovered.set(signature.subarray(0, 64), 1)
	const compressed = secp.recoverPublicKey(
		recovered,
		eip191Digest(message),
		{ prehash: false },
	)
	const uncompressed = secp.Point.fromBytes(compressed).toBytes(false)
	return '0x' + bytesToHex(keccak_256(uncompressed.slice(1))).slice(-40)
}
