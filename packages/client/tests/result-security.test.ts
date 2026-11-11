import { bytesToHex } from '@noble/hashes/utils.js'
import {
	createSignDataForClaim,
	getIdentifierFromClaimInfo,
	SelectedServiceSignature,
} from '@reclaimprotocol/attestor-core'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stripTrailingSlashes } from '../src/encoding.ts'
import type { ReclaimRequestProof } from '../src/index.ts'
import {
	b64url,
	generateKeypair,
	hashProofClaimParams,
	proofHashesFromBuilderRecipe,
	ResultVerificationError,
	signResultJws,
	verifyRequestProof,
	verifyResultFull,
} from '../src/index.ts'
import { jwksFromPrivateKey } from '../src/jwks.ts'

const ATTESTOR_PRIVATE_KEY =
	'0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const ATTESTOR_ADDRESS = SelectedServiceSignature.getAddress(
	SelectedServiceSignature.getPublicKey(ATTESTOR_PRIVATE_KEY),
)

test('proof hashing matches canonical golden vectors', () => {
	assert.deepEqual(hashProofClaimParams({
		url: 'https://example.com/api',
		method: 'POST',
		body: '{"x":1}',
		responseMatches: [
			{ type: 'regex', value: 'one', isOptional: false },
			{ type: 'contains', value: 'two', isOptional: true },
		],
		responseRedactions: [
			{ regex: 'one' },
			{ xPath: '//two', hash: 'oprf' },
		],
	}), [
		'0x76f728ff4737ed2ac58e9a184f8e7be020bf9f9e3f8039f6b2efcee668603816',
		'0x3c3c9ac6ef9cb8f0f9b48a7d2dae6ced3845aff8179dbc902975ef32edc690b2',
	])
})

test('proof hashing treats every OPRF transport as _oprf', () => {
	const input = {
		url: 'https://example.com/api',
		method: 'GET',
		responseMatches: [{ type: 'contains', value: 'account' }],
		responseRedactions: [{ jsonPath: '$.account', hash: 'oprf' }],
	}
	const expected = hashProofClaimParams(input)
	assert.deepEqual(hashProofClaimParams({
		...input,
		responseRedactions: [{ jsonPath: '$.account', hash: 'oprf-mpc' }],
	}), expected)
	assert.deepEqual(hashProofClaimParams({
		...input,
		responseRedactions: [{ jsonPath: '$.account', hash: 'oprf-raw' }],
	}), expected)
})

async function proof(
	sessionId?: string | null,
	providerHash = '0xprovider',
	parameters = '{}',
): Promise<ReclaimRequestProof> {
	const info = {
		provider: 'http',
		parameters,
		context: JSON.stringify({
			providerHash,
			...(sessionId === null
				? {}
				: { reclaimSessionId: sessionId ?? 'session-1' }),
		}),
	}
	const claimData = {
		...info,
		owner: '0x0000000000000000000000000000000000000001',
		timestampS: 1,
		identifier: getIdentifierFromClaimInfo(info),
		epoch: 1,
	}
	const signature = await SelectedServiceSignature.sign(
		new TextEncoder().encode(createSignDataForClaim(claimData)),
		ATTESTOR_PRIVATE_KEY,
	)
	return {
		identifier: claimData.identifier,
		claimData,
		signatures: ['0x' + bytesToHex(signature)],
		witnesses: [{ id: ATTESTOR_ADDRESS, url: '' }],
		extractedParameterValues: {},
	}
}

test('verifyRequestProof validates signed HTTP content hashes', async() => {
	const parameters = {
		url: 'https://example.com/me',
		method: 'GET',
		body: '',
		responseMatches: [{ type: 'contains', value: '"id":' }],
		responseRedactions: [{ jsonPath: '$.id' }],
	}
	const [hash] = hashProofClaimParams(parameters)
	const exactProof = await proof(
		undefined,
		'unused',
		JSON.stringify(parameters),
	)
	const valid = await verifyRequestProof(exactProof, {
		hashes: [hash],
		attestorAddresses: [ATTESTOR_ADDRESS],
	})
	assert.equal(valid.valid, true, valid.reason)

	const wrong = await verifyRequestProof(exactProof, {
		hashes: ['0x' + '0'.repeat(64)],
		attestorAddresses: [ATTESTOR_ADDRESS],
	})
	assert.equal(wrong.valid, false)
})

test(
	'request proof hashes preserve required, optional, and duplicate semantics',
	async() => {
		const one = await verifyRequestProof(await proof(), {
			hasNoPii: true,
			attestorAddresses: [ATTESTOR_ADDRESS],
			hashes: [
				{ value: '0xprovider', multiple: false },
				{ value: '0xoptional', required: false },
			],
		})
		assert.equal(one.valid, true, one.reason)

		const duplicate = await verifyRequestProof([await proof(), await proof()], {
			hasNoPii: true,
			attestorAddresses: [ATTESTOR_ADDRESS],
			hashes: [{ value: '0xprovider', multiple: false }],
		})
		assert.equal(duplicate.valid, false)
		assert.equal(duplicate.reason, 'duplicate-proof-hash')
	})

test('verifyResultFull resolves Builder recipes by session id', async() => {
	const vc = generateKeypair()
	const recipe = {
		providerId: 'provider-1',
		resolvedVersion: '1.2.3',
		initialUrl: 'https://example.com',
		requests: [{
			url: 'https://example.com/api/me',
			method: 'GET' as const,
			credentials: 'include' as const,
			responseMatches: [{
				type: 'contains' as const,
				value: '"id":',
				isOptional: false,
			}],
			responseRedactions: [{ jsonPath: '$.id' }],
		}],
	}
	const [requirement] = proofHashesFromBuilderRecipe(recipe, [await proof()])
	assert.ok(requirement)
	const providerHash = typeof requirement === 'string'
		? requirement
		: Array.isArray(requirement.value)
			? requirement.value[0]
			: requirement.value
	const baseProof = await proof(undefined, providerHash)
	const exactProof = {
		...baseProof,
		witnesses: baseProof.witnesses.map((witness, index) => ({
			...witness,
			claimAttestation: {
				type: 'embedded-attestor' as const,
				attestor_address: witness.id,
				claim_signature: baseProof.signatures[index] ?? '',
				attestation_report: 'legacy-attestation-report',
			},
		})),
		extractedParameterValues: { account: 'alice' },
		publicData: { plan: 'pro' },
		taskId: 42,
		teeAttestation: '{"legacy":true}',
	}
	const jws = signResultJws(vc.privateKey, {
		reclaimSessionId: 'session-1',
		results: [{
			provider_id: recipe.providerId,
			resolved_version: recipe.resolvedVersion,
			requests: [{ request_id: 'request-1', proof: exactProof }],
		}],
	}, 'https://trusted.example')
	let resolutions = 0
	const result = await verifyResultFull(jws, {
		signerPublicKey: vc.publicKey,
		reclaimSessionId: 'session-1',
		proofValidation: {
			hasNoPii: true,
			attestorAddresses: [ATTESTOR_ADDRESS],
		},
		resolveSession: () => {
			resolutions++
			return { recipes: [recipe] }
		},
	})
	assert.equal(result.reclaimSessionId, 'session-1')
	assert.equal(resolutions, 1)
	assert.deepEqual(result.proofs, [{
		providerId: recipe.providerId,
		resolvedVersion: recipe.resolvedVersion,
		requestId: 'request-1',
		proof: exactProof,
		proofValid: true,
		attestorAddress: ATTESTOR_ADDRESS,
		attestorAddresses: [ATTESTOR_ADDRESS],
		proofHashes: [providerHash],
		data: {
			context: {
				providerHash,
				reclaimSessionId: 'session-1',
			},
			extractedParameters: {},
		},
		publicData: { plan: 'pro' },
	}])
})

test(
	'verifyResultFull requires each proof to bind the expected session',
	async() => {
		const vc = generateKeypair()
		const jws = signResultJws(vc.privateKey, {
			reclaimSessionId: 'session-1',
			results: [{
				provider_id: 'provider-1',
				resolved_version: '1.2.3',
				requests: [{ proof: await proof(null) }],
			}],
		}, 'https://trusted.example')
		const options = {
			signerPublicKey: vc.publicKey,
			reclaimSessionId: 'session-1',
			hashes: ['0xprovider'],
			proofValidation: {
				hasNoPii: true as const,
				attestorAddresses: [ATTESTOR_ADDRESS],
			},
		}

		await assert.rejects(
			() => verifyResultFull(jws, options),
			(error: unknown) => {
				assert.ok(error instanceof ResultVerificationError)
				assert.equal(error.reason, 'invalid-proof')
				assert.equal(error.outcome.proofs?.[0]?.reason, 'session-missing')
				return true
			},
		)

		const legacyCompatible = await verifyResultFull(jws, {
			...options,
			proofValidation: {
				...options.proofValidation,
				requireSessionBinding: false,
			},
		})
		assert.equal(legacyCompatible.reclaimSessionId, 'session-1')
	},
)

test(
	'proof validation checks the attestor allowlist and session binding',
	async() => {
		const denied = await verifyRequestProof(await proof(), {
			attestorAddresses: ['0xother'],
			hashes: ['0xprovider'],
			hasNoPii: true,
		})
		assert.equal(denied.reason, 'attestor-not-allowed')

		const mismatch = await verifyRequestProof(await proof('other-session'), {
			expectedSessionId: 'session-1',
			requireSessionBinding: true,
			attestorAddresses: [ATTESTOR_ADDRESS],
			hashes: ['0xprovider'],
			hasNoPii: true,
		})
		assert.equal(mismatch.reason, 'session-mismatch')
	})

test(
	'verifyResultFull never fetches the header issuer before trust resolution',
	async() => {
		const vc = generateKeypair()
		const jws = signResultJws(vc.privateKey, {
			reclaimSessionId: 'session-1',
			verification_session: {
				verification_client_id: 'vc-1',
			},
			results: [],
		}, 'https://attacker.example')
		let fetches = 0
		const fetchImpl = (async() => {
			fetches++
			return new Response(JSON.stringify(jwksFromPrivateKey(vc.privateKey)))
		}) as typeof fetch

		await assert.rejects(
			() => verifyResultFull(jws, {
				trustedIssuers: ['https://trusted.example'],
				fetchImpl,
			}),
			(err: unknown) => err instanceof ResultVerificationError
			&& err.reason === 'issuer-not-trusted',
		)
		assert.equal(fetches, 0)
	},
)

test('verifyResultFull requires the selected signature to use ES256K',
	async() => {
		const vc = generateKeypair()
		const jws = signResultJws(vc.privateKey, {
			reclaimSessionId: 'session-1',
			results: [],
		}, 'https://trusted.example')
		jws.signatures[0].protected = b64url(JSON.stringify({
			alg: 'none',
			kid: vc.address,
			iss: 'https://trusted.example',
		}))

		await assert.rejects(
			() => verifyResultFull(jws, { signerPublicKey: vc.publicKey }),
			(error: unknown) => error instanceof ResultVerificationError
				&& error.reason === 'unsupported-algorithm',
		)
	},
)

test('verifyResultFull verifies the signature whose header it selected',
	async() => {
		const vc = generateKeypair()
		const jws = signResultJws(vc.privateKey, {
			reclaimSessionId: 'session-1',
			results: [],
		}, 'https://trusted.example')
		jws.signatures.unshift({
			protected: b64url(JSON.stringify({
				alg: 'ES256K',
				kid: vc.address,
				iss: 'https://trusted.example',
			})),
			signature: b64url(new Uint8Array(64)),
		})

		await assert.rejects(
			() => verifyResultFull(jws, { signerPublicKey: vc.publicKey }),
			(error: unknown) => error instanceof ResultVerificationError
				&& error.reason === 'bad-signature',
		)
	},
)

test(
	'verifyResultFull accepts the configured Builder issuer and JWKS URL',
	async() => {
		const vc = generateKeypair()
		const issuer = 'https://trusted.example'
		const jwksUrl = 'https://keys.example/verification-client.json'
		const jws = signResultJws(vc.privateKey, {
			reclaimSessionId: 'session-1',
			verification_session: {
				verification_client_id: 'vc-1',
			},
			results: [],
		}, issuer)
		const fetchImpl = (async(input) => {
			assert.equal(String(input), jwksUrl)
			return new Response(
				JSON.stringify(jwksFromPrivateKey(vc.privateKey)),
				{ headers: { 'Content-Type': 'application/json' } },
			)
		}) as typeof fetch

		const result = await verifyResultFull(jws, {
			trustedIssuers: [issuer],
			jwksUrl,
			fetchImpl,
		})
		assert.equal(result.reclaimSessionId, 'session-1')
	})

test('verifyResultFull can ignore an expired legacy result', async() => {
	const vc = generateKeypair()
	const jws = signResultJws(vc.privateKey, {
		exp: 100,
		reclaimSessionId: 'session-1',
		results: [],
	}, 'https://trusted.example')
	await assert.rejects(
		() => verifyResultFull(jws, {
			signerPublicKey: vc.publicKey,
			now: 101,
		}),
		(error: unknown) => error instanceof ResultVerificationError
			&& error.reason === 'expired',
	)
	const result = await verifyResultFull(jws, {
		signerPublicKey: vc.publicKey,
		now: 101,
		ignoreExpiration: true,
	})
	assert.equal(result.reclaimSessionId, 'session-1')
})

test('verifyRequestProof resolves attestors from the Builder JWKS', async() => {
	const exactProof = await proof()
	const jwksUrl = 'https://builder.example/.well-known/jwks.json'
	const result = await verifyRequestProof(exactProof, {
		hashes: ['0xprovider'],
		hasNoPii: true,
		attestorJwksUrl: jwksUrl,
		fetchImpl: (async(input) => {
			assert.equal(String(input), jwksUrl)
			return new Response(JSON.stringify({
				keys: [],
				'x-reclaim-attestors': [ATTESTOR_ADDRESS],
			}))
		}),
	})
	assert.equal(result.valid, true, result.reason)
})

test('verifyRequestProof trusts the Builder JWKS by default', async() => {
	const result = await verifyRequestProof(await proof(), {
		hashes: ['0xprovider'],
		hasNoPii: true,
		fetchImpl: (async(input) => {
			assert.equal(
				String(input),
				'https://build.reclaimprotocol.org/.well-known/jwks.json',
			)
			return new Response(JSON.stringify({
				keys: [],
				'x-reclaim-attestors': [ATTESTOR_ADDRESS],
			}))
		}),
	})
	assert.equal(result.valid, true, result.reason)
})

test('verifyRequestProof with only attestorAddresses fetches nothing',
	async() => {
		const result = await verifyRequestProof(await proof(), {
			hashes: ['0xprovider'],
			hasNoPii: true,
			attestorAddresses: [ATTESTOR_ADDRESS],
			fetchImpl: (async() => assert.fail('no JWKS fetch expected')),
		})
		assert.equal(result.valid, true, result.reason)
	})

test('verifyResultFull reuses the result JWKS attestor registry', async() => {
	const vc = generateKeypair()
	const exactProof = await proof()
	const issuer = 'https://builder.example'
	const jws = signResultJws(vc.privateKey, {
		reclaimSessionId: 'session-1',
		verification_session: {
			verification_client_id: 'vc-1',
		},
		results: [{
			provider_id: 'provider-1',
			resolved_version: '1.0.0',
			requests: [{ proof: exactProof }],
		}],
	}, issuer)
	const result = await verifyResultFull(jws, {
		trustedIssuers: [issuer],
		hashes: ['0xprovider'],
		proofValidation: { hasNoPii: true },
		fetchImpl: (async() => new Response(JSON.stringify({
			...jwksFromPrivateKey(vc.privateKey),
			'x-reclaim-attestors': [ATTESTOR_ADDRESS],
		}))),
	})
	assert.equal(result.reclaimSessionId, 'session-1')
})

test('JWKS image digests alone accept a witness with no claimAttestation',
	async() => {
	// A portal TEE proof without a bound nonce carries a bare `{ id, url }`
	// witness. `@reclaimprotocol/js-sdk` accepts it by default on signer trust,
	// so a registry digest alone must not demand an envelope.
		const vc = generateKeypair()
		const issuer = 'https://builder.example'
		const jws = signResultJws(vc.privateKey, {
			reclaimSessionId: 'session-1',
			verification_session: { verification_client_id: 'vc-1' },
			results: [{
				provider_id: 'provider-1',
				resolved_version: '1.0.0',
				requests: [{ proof: await proof() }],
			}],
		}, issuer)

		const result = await verifyResultFull(jws, {
			trustedIssuers: [issuer],
			hashes: ['0xprovider'],
			proofValidation: { hasNoPii: true },
			fetchImpl: (async() => new Response(JSON.stringify({
				...jwksFromPrivateKey(vc.privateKey),
				'x-reclaim-attestors': [ATTESTOR_ADDRESS],
				'x-reclaim-attestor-image-digests': [
					`sha256:${'1'.repeat(64)}`,
				],
			}))),
		})

		const outcome = result.proofs?.[0]
		assert.equal(outcome?.proofValid, true, outcome?.reason)
		assert.equal(outcome?.isAttestorTeeAttestationVerified, false)
	})

test('a configured attestor TEE check requires claimAttestation', async() => {
	const vc = generateKeypair()
	const issuer = 'https://builder.example'
	const digest = `sha256:${'1'.repeat(64)}`
	const jws = signResultJws(vc.privateKey, {
		reclaimSessionId: 'session-1',
		verification_session: {
			verification_client_id: 'vc-1',
		},
		results: [{
			provider_id: 'provider-1',
			resolved_version: '1.0.0',
			requests: [{ proof: await proof() }],
		}],
	}, issuer)

	await assert.rejects(
		() => verifyResultFull(jws, {
			trustedIssuers: [issuer],
			hashes: ['0xprovider'],
			proofValidation: {
				hasNoPii: true,
				attestorTeeAttestation: { expectedImageDigests: [digest] },
			},
			fetchImpl: (async() => new Response(JSON.stringify({
				...jwksFromPrivateKey(vc.privateKey),
				'x-reclaim-attestors': [ATTESTOR_ADDRESS],
				'x-reclaim-attestor-image-digests': [digest],
			}))),
		}),
		(error: unknown) => {
			assert.ok(error instanceof ResultVerificationError)
			assert.equal(error.reason, 'invalid-proof')
			assert.match(
				error.outcome.proofs?.[0]?.reason ?? '',
				/missing claimAttestation/,
			)
			return true
		},
	)
})

test('JWKS image digests accept a witness with no attestation report',
	async() => {
	// The production shape: both the in-app SDK (reclaim-tee-operator-flutter)
	// and portals return `claimAttestation` with only an attestor address and a
	// claim signature. A non-empty image-digest registry must still verify those
	// bindings without demanding an `attestation_report` that no attestor sends.
		const vc = generateKeypair()
		const issuer = 'https://builder.example'
		const base = await proof()
		const exactProof: ReclaimRequestProof = {
			...base,
			witnesses: base.witnesses.map((witness, index) => ({
				...witness,
				claimAttestation: {
					type: 'embedded-attestor' as const,
					attestor_address: witness.id,
					claim_signature: base.signatures[index] ?? '',
				},
			})),
		}
		const jws = signResultJws(vc.privateKey, {
			reclaimSessionId: 'session-1',
			verification_session: { verification_client_id: 'vc-1' },
			results: [{
				provider_id: 'provider-1',
				resolved_version: '1.0.0',
				requests: [{ proof: exactProof }],
			}],
		}, issuer)

		const result = await verifyResultFull(jws, {
			trustedIssuers: [issuer],
			hashes: ['0xprovider'],
			proofValidation: { hasNoPii: true },
			fetchImpl: (async() => new Response(JSON.stringify({
				...jwksFromPrivateKey(vc.privateKey),
				'x-reclaim-attestors': [ATTESTOR_ADDRESS],
				'x-reclaim-attestor-image-digests': [
					`sha256:${'1'.repeat(64)}`,
				],
			}))),
		})

		assert.equal(result.reclaimSessionId, 'session-1')
		const outcome = result.proofs?.[0]
		assert.equal(outcome?.proofValid, true, outcome?.reason)
		// The check ran; nothing was attested, and the outcome says so rather than
		// claiming a TEE attestation that never happened.
		assert.equal(result.proofs?.[0]?.isAttestorTeeAttestationVerified, false)
	})

test('a witness attestation report that is present must still verify',
	async() => {
		const vc = generateKeypair()
		const issuer = 'https://builder.example'
		const base = await proof()
		const exactProof: ReclaimRequestProof = {
			...base,
			witnesses: base.witnesses.map((witness, index) => ({
				...witness,
				claimAttestation: {
					type: 'embedded-attestor' as const,
					attestor_address: witness.id,
					claim_signature: base.signatures[index] ?? '',
					attestation_report: 'not-a-jwt',
				},
			})),
		}
		const jws = signResultJws(vc.privateKey, {
			reclaimSessionId: 'session-1',
			verification_session: { verification_client_id: 'vc-1' },
			results: [{
				provider_id: 'provider-1',
				resolved_version: '1.0.0',
				requests: [{ proof: exactProof }],
			}],
		}, issuer)

		await assert.rejects(
			() => verifyResultFull(jws, {
				trustedIssuers: [issuer],
				hashes: ['0xprovider'],
				proofValidation: { hasNoPii: true },
				fetchImpl: (async() => new Response(JSON.stringify({
					...jwksFromPrivateKey(vc.privateKey),
					'x-reclaim-attestors': [ATTESTOR_ADDRESS],
					'x-reclaim-attestor-image-digests': [
						`sha256:${'1'.repeat(64)}`,
					],
				}))),
			}),
			(error: unknown) => {
				assert.ok(error instanceof ResultVerificationError)
				assert.equal(error.reason, 'invalid-proof')
				assert.match(
					error.outcome.proofs?.[0]?.reason ?? '',
					/not a JWT/,
				)
				return true
			},
		)
	})

test('a confidential-space witness skips the attestor report checks',
	async() => {
	// Portals in Builder mode: the same witness envelope every client uses, with
	// `type` selecting its evidence. Its runtime is proved by `tee_attestation`
	// and `context.attestationNonce`, not by an attestor `attestation_report`,
	// so the attestor-report path must not demand one.
		const vc = generateKeypair()
		const issuer = 'https://builder.example'
		const base = await proof()
		const exactProof: ReclaimRequestProof = {
			...base,
			witnesses: base.witnesses.map((witness, index) => ({
				...witness,
				url: 'wss://attestor.reclaimprotocol.org:444/ws',
				claimAttestation: {
					type: 'confidential-space' as const,
					attestor_address: witness.id,
					claim_signature: base.signatures[index] ?? '',
					tee_attestation: { tee_provider: 'gcp' },
				},
			})),
		}
		const jws = signResultJws(vc.privateKey, {
			reclaimSessionId: 'session-1',
			verification_session: { verification_client_id: 'vc-1' },
			results: [{
				provider_id: 'provider-1',
				resolved_version: '1.0.0',
				requests: [{ proof: exactProof }],
			}],
		}, issuer)

		const result = await verifyResultFull(jws, {
			trustedIssuers: [issuer],
			hashes: ['0xprovider'],
			proofValidation: { hasNoPii: true },
			fetchImpl: (async() => new Response(JSON.stringify({
				...jwksFromPrivateKey(vc.privateKey),
				'x-reclaim-attestors': [ATTESTOR_ADDRESS],
				'x-reclaim-attestor-image-digests': [
					`sha256:${'1'.repeat(64)}`,
				],
			}))),
		})

		const outcome = result.proofs?.[0]
		assert.equal(outcome?.proofValid, true, outcome?.reason)
		assert.equal(result.proofs?.[0]?.isAttestorTeeAttestationVerified, false)
	})

test('an embedded-attestor witness still verifies a report it carries',
	async() => {
		const vc = generateKeypair()
		const issuer = 'https://builder.example'
		const base = await proof()
		const exactProof: ReclaimRequestProof = {
			...base,
			witnesses: base.witnesses.map((witness, index) => ({
				...witness,
				claimAttestation: {
					type: 'embedded-attestor' as const,
					attestor_address: witness.id,
					claim_signature: base.signatures[index] ?? '',
					attestation_report: 'not-a-jwt',
				},
			})),
		}
		const jws = signResultJws(vc.privateKey, {
			reclaimSessionId: 'session-1',
			verification_session: { verification_client_id: 'vc-1' },
			results: [{
				provider_id: 'provider-1',
				resolved_version: '1.0.0',
				requests: [{ proof: exactProof }],
			}],
		}, issuer)

		await assert.rejects(
			() => verifyResultFull(jws, {
				trustedIssuers: [issuer],
				hashes: ['0xprovider'],
				proofValidation: { hasNoPii: true },
				fetchImpl: (async() => new Response(JSON.stringify({
					...jwksFromPrivateKey(vc.privateKey),
					'x-reclaim-attestors': [ATTESTOR_ADDRESS],
					'x-reclaim-attestor-image-digests': [
						`sha256:${'1'.repeat(64)}`,
					],
				}))),
			}),
			(error: unknown) => error instanceof ResultVerificationError
			&& /not a JWT/.test(error.outcome.proofs?.[0]?.reason ?? ''),
		)
	})

test('local image policy can narrow but not broaden JWKS trust', async() => {
	const vc = generateKeypair()
	const issuer = 'https://builder.example'
	const jws = signResultJws(vc.privateKey, {
		reclaimSessionId: 'session-1',
		verification_session: { verification_client_id: 'vc-1' },
		results: [{
			provider_id: 'provider-1',
			resolved_version: '1.0.0',
			requests: [{ proof: await proof() }],
		}],
	}, issuer)

	await assert.rejects(
		() => verifyResultFull(jws, {
			trustedIssuers: [issuer],
			hashes: ['0xprovider'],
			proofValidation: {
				hasNoPii: true,
				attestorTeeAttestation: {
					expectedImageDigests: [`sha256:${'2'.repeat(64)}`],
				},
			},
			fetchImpl: (async() => new Response(JSON.stringify({
				...jwksFromPrivateKey(vc.privateKey),
				'x-reclaim-attestors': [ATTESTOR_ADDRESS],
				'x-reclaim-attestor-image-digests': [
					`sha256:${'1'.repeat(64)}`,
				],
			}))),
		}),
		(error: unknown) => error instanceof ResultVerificationError
			&& error.reason === 'attestor-image-trust-mismatch',
	)
})

test('verifyResultFull rejects a kid that does not match its JWK', async() => {
	const vc = generateKeypair()
	const other = generateKeypair()
	const issuer = 'https://trusted.example'
	const jws = signResultJws(vc.privateKey, {
		reclaimSessionId: 'session-1',
		verification_session: { verification_client_id: 'vc-1' },
		results: [],
	}, issuer)
	const jwks = jwksFromPrivateKey(other.privateKey, {
		'x-reclaim-purpose': 'verification-result',
	})
	jwks.keys[0].kid = vc.address

	await assert.rejects(
		() => verifyResultFull(jws, {
			trustedIssuers: [issuer],
			fetchImpl: (async() => new Response(JSON.stringify(jwks))),
		}),
		(error: unknown) => error instanceof ResultVerificationError
			&& error.reason === 'signer-key-not-found',
	)
})

test('stripTrailingSlashes trims linearly on a hostile slash run', () => {
	const origin = 'https://a.example'
	assert.equal(stripTrailingSlashes(`${origin}///`), origin)
	assert.equal(stripTrailingSlashes(origin), origin)
	assert.equal(stripTrailingSlashes('///'), '')
	assert.equal(stripTrailingSlashes(''), '')
	// `/\/+$/` takes seconds here; a linear trim takes well under 50ms.
	const hostile = `${'/'.repeat(200_000)}x`
	const started = performance.now()
	assert.equal(stripTrailingSlashes(hostile), hostile)
	assert.ok(performance.now() - started < 50)
})

test('verifyResultFull rejects an oversized issuer unread', async() => {
	const vc = generateKeypair()
	const jws = signResultJws(vc.privateKey, {
		reclaimSessionId: 'session-1',
		verification_session: { verification_client_id: 'vc-1' },
		results: [],
	}, `https://trusted.example${'/'.repeat(100_000)}x`)
	let fetches = 0
	const fetchImpl = (async() => {
		fetches++
		return new Response('{}')
	}) as typeof fetch

	const started = performance.now()
	await assert.rejects(
		() => verifyResultFull(jws, {
			trustedIssuers: ['https://trusted.example'],
			fetchImpl,
		}),
		(err: unknown) => err instanceof ResultVerificationError
			&& err.reason === 'issuer-not-trusted',
	)
	assert.ok(performance.now() - started < 200)
	assert.equal(fetches, 0)
})

test('ResultVerificationError.retryable is true only for temporary failures',
	async() => {
		const vc = generateKeypair()
		const issuer = 'https://builder.example'
		const jws = signResultJws(vc.privateKey, {
			reclaimSessionId: 'session-1',
			results: [{
				provider_id: 'provider-1',
				resolved_version: '1.0.0',
				requests: [{ proof: await proof() }],
			}],
		}, issuer)
		const proofValidation = {
			hasNoPii: true as const,
			attestorAddresses: [ATTESTOR_ADDRESS],
		}
		const failure = async(opts: Parameters<typeof verifyResultFull>[1]) => {
			const error = await verifyResultFull(jws, opts).then(
				() => undefined,
				(err: unknown) => err,
			)
			assert.ok(error instanceof ResultVerificationError)
			return error
		}

		const unavailable = await failure({
			trustedIssuers: [issuer],
			fetchImpl: (async() => new Response('', { status: 503 })),
		})
		assert.deepEqual(
			[unavailable.reason, unavailable.retryable],
			['jwks-fetch-failed', true],
		)

		const unreachable = await failure({
			trustedIssuers: [issuer],
			fetchImpl: (async() => {
				throw new TypeError('fetch failed')
			}),
		})
		assert.equal(unreachable.retryable, true)

		const badSignature = await failure({
			signerPublicKey: generateKeypair().publicKey,
		})
		assert.deepEqual(
			[badSignature.reason, badSignature.retryable],
			['bad-signature', false],
		)

		const invalidProof = await failure({
			signerPublicKey: vc.publicKey,
			hashes: ['0xother'],
			proofValidation,
		})
		assert.deepEqual(
			[invalidProof.reason, invalidProof.retryable],
			['invalid-proof', false],
		)

		const providerDown = await failure({
			signerPublicKey: vc.publicKey,
			proofValidation: {
				...proofValidation,
				providerId: 'provider-1',
				resolveProvider: () => {
					throw new TypeError('fetch failed')
				},
			},
		})
		assert.deepEqual(
			[providerDown.reason, providerDown.retryable],
			['invalid-proof', true],
		)

		const providerMissing = await failure({
			signerPublicKey: vc.publicKey,
			proofValidation: {
				...proofValidation,
				providerId: 'provider-1',
				resolveProvider: () => [],
			},
		})
		assert.equal(providerMissing.retryable, false)

		const sessionDown = await failure({
			signerPublicKey: vc.publicKey,
			reclaimSessionId: 'session-1',
			proofValidation,
			resolveSession: () => {
				throw new TypeError('fetch failed')
			},
		})
		assert.deepEqual(
			[sessionDown.reason, sessionDown.retryable],
			['session-resolution-failed', true],
		)
	})

test('verifyResultFull accepts a provider-less AI session result', async() => {
	const vc = generateKeypair()
	const aiProof = {
		...await proof(),
		extractedParameterValues: { name: 'alice' },
	}
	const sign = (
		session: Record<string, unknown>,
		entries: Record<string, unknown>[],
		key = vc.privateKey,
	) => signResultJws(key, {
		reclaimSessionId: 'session-1',
		verification_session: { status: 'success', ...session },
		results: entries,
	}, 'https://trusted.example')
	const entry = { requests: [{ proof: aiProof }] }
	const options = {
		signerPublicKey: vc.publicKey,
		reclaimSessionId: 'session-1',
		proofValidation: { attestorAddresses: [ATTESTOR_ADDRESS] },
	}
	const rejectsWith = async(
		jws: ReturnType<typeof sign>,
		reason: string,
		opts: typeof options = options,
		proofReason?: string,
	) => {
		await assert.rejects(
			() => verifyResultFull(jws, opts),
			(error: unknown) => {
				assert.ok(error instanceof ResultVerificationError)
				assert.equal(error.reason, reason)
				if(proofReason) {
					assert.equal(error.outcome.proofs?.[0]?.reason, proofReason)
				}

				return true
			},
		)
	}

	const jws = sign({ providers: [] }, [entry])
	const { proofs } = await verifyResultFull(jws, options)
	assert.equal(proofs?.[0]?.proofValid, true)
	assert.equal(proofs?.[0]?.providerId, undefined)
	assert.equal(proofs?.[0]?.data?.context.reclaimSessionId, 'session-1')

	// Builder signature, session, and attestor trust are still enforced.
	await rejectsWith(
		sign({ providers: [] }, [entry], generateKeypair().privateKey),
		'bad-signature',
	)
	await rejectsWith(jws, 'reclaimSessionId-mismatch', {
		...options,
		reclaimSessionId: 'session-2',
	})
	await rejectsWith(jws, 'invalid-proof', {
		...options,
		proofValidation: { attestorAddresses: ['0xother'] },
	}, 'attestor-not-allowed')
	await rejectsWith(sign({ providers: [] }, [{
		requests: [{ proof: await proof('other-session') }],
	}]), 'invalid-proof', options, 'session-mismatch')

	// Only a result with no providers and no provider ids skips recipes.
	await rejectsWith(sign({ providers: [] }, [
		entry,
		{ provider_id: 'provider-1', resolved_version: '1', requests: [] },
	]), 'invalid-proof')
	await rejectsWith(
		sign({ providers: [{ provider_id: 'p', resolved_version: '1' }] }, [
			entry,
		]),
		'invalid-proof',
		options,
		'proof-validation-required',
	)
	await rejectsWith(
		sign({ providers: [] }, [{ ...entry, provider_id: 'provider-1' }]),
		'invalid-proof',
		options,
		'provider-resolver-required',
	)
})
