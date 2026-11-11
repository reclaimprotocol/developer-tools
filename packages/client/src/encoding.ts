/**
 * Byte / hex / base64url encoders shared across the verification crypto paths
 * (result, jwks, attestor-proof). `hexToBytes` tolerates an optional `0x`
 * prefix, matching how ETH keys/addresses are passed around.
 *
 * base64url uses the `atob`/`btoa` globals + `TextEncoder` rather than Node's
 * `Buffer` so the same code runs in the browser (the in-page keypair
 * generator) — `Buffer` is undefined there. Both globals exist in Node ≥ 16
 * and every browser.
 */
export function hexToBytes(hex: string): Uint8Array {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex
	const out = new Uint8Array(clean.length / 2)
	for(let i = 0; i < out.length; i++) {
		out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
	}

	return out
}

export function bytesToHex(bytes: Uint8Array): string {
	let out = ''
	for(const b of bytes) {
		out += b.toString(16).padStart(2, '0')
	}

	return out
}

/** Decode a base64url string (with or without padding) to bytes. */
export function base64urlToBytes(s: string): Uint8Array {
	const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
	const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
	const bin = atob(b64 + pad)
	const out = new Uint8Array(bin.length)
	for(let i = 0; i < bin.length; i++) {
		out[i] = bin.charCodeAt(i)
	}

	return out
}

/** Encode bytes (or a UTF-8 string) as unpadded base64url. */
export function b64url(input: Uint8Array | string): string {
	const bytes = typeof input === 'string'
		? new TextEncoder().encode(input)
		: input
	let bin = ''
	for(const b of bytes) {
		bin += String.fromCharCode(b)
	}

	return btoa(bin)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '')
}

/** `value` without trailing `/`s. A loop, not `/\/+$/`: that regex backtracks
 *  quadratically on a long run of slashes followed by anything else, and
 *  some callers get attacker-supplied input (a JWS header's `iss`). */
export function stripTrailingSlashes(value: string): string {
	let end = value.length
	while(end > 0 && value.charCodeAt(end - 1) === 0x2f) {
		end--
	}

	return value.slice(0, end)
}
