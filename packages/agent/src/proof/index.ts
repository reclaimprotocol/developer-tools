// Proof primitives shared with the app's verification runner: the attestor
// param/claim plumbing, the ZK-file bootstrap, and the agent's own
// `runAttestorProof`. Exposed as `@reclaimprotocol/agent/proof`.
export type {
	AttestorClaim,
	AttestorLogEntry,
	ProofResult,
	RunAttestorProofOptions,
} from './attestor.ts'
export { runAttestorProof, tailLogs, warnsAndErrors } from './attestor.ts'
export {
	createAttestorAuthentication,
	type AttestorAuthentication,
} from './attestor-auth.ts'
export {
	buildHttpParams,
	ensureAttestorCrypto,
	type ParsedClaim,
	parseClaim,
	resolveAttestorUrl,
} from './proof-core.ts'
export {
	type HttpParams,
	type HttpSecretParams,
	type PopcornProveOptions,
	popcornProve,
	popcornValidateExtraction,
	type ValidateExtractionResult,
} from './pod-prover.ts'
export { ensureZkFiles } from './zk-files.ts'
// Re-exported attestor-core claim primitive so the agent is the single
// integration point with @reclaimprotocol/attestor-core across the builder.
export { createClaimOnAttestor } from '@reclaimprotocol/attestor-core'
