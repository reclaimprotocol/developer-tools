import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { generateEthKeypair, loadDecryptionKey } from '../src/enckeys.ts'
import {
	decryptCallback,
	encryptForEthPublicKey,
	signResultJws,
} from '../src/result.ts'

describe('ECIES result delivery roundtrip', () => {
	it('encrypts a signed JWS to the org eth public JWK and decrypts with the '
		+ 'eth private key', async() => {
		const vc = generateEthKeypair()
		const org = generateEthKeypair()
		const jws = signResultJws(
			vc.privateKeyHex,
			{ reclaimSessionId: 's', results: [] },
			'http://iss.test',
		)

		const ct = await encryptForEthPublicKey(
			org.publicJwk,
			new TextEncoder().encode(JSON.stringify(jws)),
		)
		// ECIES ciphertext is base64url — never a plaintext JWS JSON ('{').
		assert.ok(!ct.startsWith('{'))

		const out = await decryptCallback(loadDecryptionKey(org.privateKeyHex), ct)
		assert.deepEqual(out, jws)
	})

	it('plaintext path returns the JWS JSON verbatim (no key)', async() => {
		const vc = generateEthKeypair()
		const jws = signResultJws(
			vc.privateKeyHex,
			{ reclaimSessionId: 's' },
			'http://iss.test',
		)
		const out = await decryptCallback(undefined, JSON.stringify(jws))
		assert.deepEqual(out, jws)
	})

	it('an encrypted delivery with no key throws a clear error', async() => {
		const org = generateEthKeypair()
		const ct = await encryptForEthPublicKey(
			org.publicJwk,
			new TextEncoder().encode(JSON.stringify({ a: 1 })),
		)
		await assert.rejects(
			() => decryptCallback(undefined, ct),
			/no org ETH private key was provided/,
		)
	})

	it('the wrong eth private key fails to decrypt', async() => {
		const org = generateEthKeypair()
		const other = generateEthKeypair()
		const ct = await encryptForEthPublicKey(
			org.publicJwk,
			new TextEncoder().encode(JSON.stringify({ a: 1 })),
		)
		await assert.rejects(
			() => decryptCallback(loadDecryptionKey(other.privateKeyHex), ct),
		)
	})
})
