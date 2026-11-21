/**
 * `@reclaimprotocol/client/email`: verify email proofs that Reclaim Portal
 * issues. Server-only; needs Node.js 22.19 or later. The package root and
 * `/api` never load this module.
 */
export {
	emailError,
	type EmailProofOutcome,
	type EmailVerificationFailureReason,
	type EmailVerificationMode,
	normalizeEmailIssuers,
	verifyEmailProof,
	type VerifyEmailProofOptions,
} from './verify.ts'
export type { EmailProofV1 } from './core/contracts.ts'
export {
	EMAIL_PROVIDERS,
	type EmailProvider,
	type EmailRequest,
} from './core/protocol.ts'
