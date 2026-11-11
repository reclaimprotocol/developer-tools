export * from './api.ts'
export { USER_AGENT } from './consts.ts'
export {
	addressFromPublicKey,
	deriveFromPrivateKey,
	type EthKeypair,
	generateKeypair,
} from './keypair.ts'
export { canonicalJson } from './canonical.ts'
export {
	b64url,
	base64urlToBytes,
	bytesToHex,
	hexToBytes,
} from './encoding.ts'
export {
	addressFromUncompressedPubkey,
	secp,
} from './secp.ts'
export { eip191Digest, signEip191 } from './eip191.ts'
export {
	type CallbackBody,
	decodeJwsPayload,
	decryptCallback,
	type DeliveryEnvelope,
	encryptForEthPublicKey,
	type Jws,
	ResultVerificationError,
	type ResultProofOutcome,
	signResultJws,
	verifyJwsSignature,
	verifyResult,
	verifyResultFull,
	type VerifyResultFullOptions,
	type VerifyResultFullOutcome,
	type VerifyResultOptions,
	type VerifyResultOutcome,
} from './result.ts'
export {
	type DecryptionKey,
	type DecryptionKeyInput,
	generateEthKeypair,
	type GeneratedEthKeypair,
	loadDecryptionKey,
	pubkeyJwkToEthAddress,
	uncompressedPubkeyToJwk,
} from './enckeys.ts'
export {
	type BindSessionTeeNonceInput,
	type CreateSessionInput,
	type ImportReclaimVerificationConfig,
	type ReclaimConfig,
	type ReclaimFlowFactory,
	ReclaimVerification,
	type ReclaimVerificationState,
	type ReceiveOptions,
	type ReceivedDelivery,
	type SessionFlow,
} from './reclaim.ts'
export {
	fetchJwks,
	fetchJwksUrl,
	fetchReclaimJwks,
	type Jwk,
	jwksFromPrivateKey,
	jwkToUncompressedPublicKey,
	type ReclaimJwks,
	selectKey,
	selectVerificationResultKey,
	trustedAttestorAddresses,
	validateAttestorAddresses,
	validateAttestorImageDigests,
} from './jwks.ts'
export {
	type NestedProofOutcome,
	verifyNestedProof,
} from './attestor-proof.ts'
export {
	type ProofHashRequirement,
	type ReclaimRequestProof,
	type ReclaimRequestProofOutcome,
	type VerifyRequestProofOptions,
	proofHashes,
	verifyRequestProof,
} from './request-proof.ts'
export {
	type BuilderProofRecipe,
	proofHashesFromBuilderRecipe,
} from './proof-recipe.ts'
export {
	getHashFromProof,
	hashProofClaimParams,
	hashRequestSpec,
	type HttpProofParams,
	type ProofRequestSpec,
} from './proof-hash.ts'
export {
	builderTeeBindingPayload,
	BUILDER_TEE_BINDING_DOMAIN,
	createBuilderTeeBinding,
	createLegacyTeeNonceContext,
	deriveLegacySignatureTeeNonce,
	deriveLegacyTeeNonce,
	LEGACY_TEE_ATTESTATION_VERSION,
	LEGACY_TEE_NONCE_DOMAIN,
	legacyApplicationIdFromPrivateKey,
	signBuilderTeeBinding,
	type BuilderTeeBinding,
	type BuilderTeeBindingPayload,
	type LegacyTeeNonceContext,
	type LegacyTeeNonceData,
	type LegacyTeeNonceMode,
} from './tee-binding.ts'
export {
	VerificationClient,
} from './verification-clients.ts'
