import { keccak_256 } from '@noble/hashes/sha3.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	builderTeeBindingPayload,
	createBuilderTeeBinding,
	createLegacyTeeNonceContext,
	deriveLegacySignatureTeeNonce,
	deriveLegacyTeeNonce,
	eip191Digest,
	LEGACY_TEE_ATTESTATION_VERSION,
	legacyApplicationIdFromPrivateKey,
	secp,
} from '../src/index.ts'
import { addressFromUncompressedPubkey } from '../src/secp.ts'

const PRIVATE_KEY = '0x0123456789abcdef0123456789abcdef'
	+ '0123456789abcdef0123456789abcdef'
const SESSION_ID = '7f0faf0f-6c94-4afd-b4c6-7e1136725fdf'
const TIMESTAMP = '1774346557104'

test('TEE nonce context exactly matches the legacy SDK', () => {
	const applicationId = legacyApplicationIdFromPrivateKey(PRIVATE_KEY)
	assert.equal(applicationId, '0xFCAd0B19bB29D4674531d6f115237E16AfCE377c')

	const context = createLegacyTeeNonceContext({
		organizationVerificationPrivateKey: PRIVATE_KEY,
		sessionId: SESSION_ID,
		timestamp: TIMESTAMP,
	})
	assert.deepEqual(context.attestationNonceData, {
		applicationId,
		sessionId: SESSION_ID,
		timestamp: TIMESTAMP,
		attestationVersion: LEGACY_TEE_ATTESTATION_VERSION,
	})
	assert.equal(
		context.attestationNonce,
		'a683bb8f3464615e40f2c1a976b20f000325a4ff95ed6475f5acd4a34b28c0d3',
	)
	assert.match(context.attestationNonce, /^[a-f0-9]{64}$/)

	// Legacy nonce serialization intentionally preserves application-ID casing.
	assert.notEqual(
		deriveLegacyTeeNonce(PRIVATE_KEY, {
			applicationId: applicationId.toLowerCase(),
			sessionId: SESSION_ID,
			timestamp: TIMESTAMP,
		}),
		context.attestationNonce,
	)
})

test('Builder TEE-binding payload is deterministic and EIP-191 signed', () => {
	const binding = createBuilderTeeBinding({
		organizationId: 'e09e599e-f3cc-4c1e-83c7-b75096a6a0c5',
		organizationVerificationPrivateKey: PRIVATE_KEY,
		sessionId: SESSION_ID,
		timestamp: TIMESTAMP,
	})
	assert.equal(binding.payload, builderTeeBindingPayload(binding))
	assert.equal(
		binding.payload,
		'RECLAIM_BUILDER_TEE_BINDING_V1'
			+ ':e09e599e-f3cc-4c1e-83c7-b75096a6a0c5'
			+ `:${SESSION_ID}:${binding.attestationNonceData.applicationId}`
			+ `:${TIMESTAMP}:v3:${binding.attestationNonce}`,
	)
	assert.equal(
		recoverSigner(binding.payload, binding.signature),
		binding.attestationNonceData.applicationId.toLowerCase(),
	)
})

test('older signature TEE nonce recovers the application address', () => {
	const applicationId = legacyApplicationIdFromPrivateKey(PRIVATE_KEY)
	const data = {
		applicationId,
		sessionId: SESSION_ID,
		timestamp: TIMESTAMP,
	}
	const nonce = deriveLegacySignatureTeeNonce(PRIVATE_KEY, data)
	assert.match(nonce, /^0x[a-f0-9]{130}$/)
	assert.equal(
		recoverSignerBytes(
			keccak_256(new TextEncoder().encode(
				`${applicationId}:${SESSION_ID}:${TIMESTAMP}`,
			)),
			nonce,
		),
		applicationId.toLowerCase(),
	)
	assert.equal(createLegacyTeeNonceContext({
		organizationVerificationPrivateKey: PRIVATE_KEY,
		sessionId: SESSION_ID,
		timestamp: TIMESTAMP,
		nonceMode: 'signature',
	}).attestationNonce, nonce)
})

function recoverSigner(message: string, signature: string): string {
	return recoverSignerBytes(new TextEncoder().encode(message), signature)
}

function recoverSignerBytes(message: Uint8Array, signature: string): string {
	const raw = signature.slice(2)
	const recovery = Number.parseInt(raw.slice(-2), 16)
	const recovered = new Uint8Array(65)
	recovered[0] = recovery
	recovered.set(Uint8Array.from(
		{ length: 64 },
		(_, index) => Number.parseInt(raw.slice(index * 2, index * 2 + 2), 16),
	), 1)
	const publicKey = secp.recoverPublicKey(recovered, eip191Digest(message), {
		prehash: false,
	})
	return addressFromUncompressedPubkey(
		secp.Point.fromBytes(publicKey).toBytes(false),
	)
}
