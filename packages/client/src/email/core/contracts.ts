/* eslint-disable @stylistic/max-len */
export type { EmailProvider } from './providers.ts'
export type EmailContentScope =
	| 'body-and-attachments'
	| 'body-only'
	| 'attachments-only'
/** Name is an output identifier only; instructions define the requested information. */
export interface EmailParameterInput {
	readonly name: string
	readonly instructions: string
	readonly isOptional?: boolean
}
export interface EmailParameter extends EmailParameterInput {
	readonly isOptional: boolean
}
export interface EmailPolicyInput {
	sender: string
	params: readonly EmailParameterInput[]
	instructions?: string
	contentScope?: EmailContentScope
	allowedDkimSigningDomains?: readonly string[]
	expectedRecipient?: string
	minEmailDateS?: number
	maxEmailDateS?: number
}
export type EmailPolicyVersion = 'email-dkim-v5'
export type NormalizedEmailPolicy = NormalizedEmailPolicyFields & {
	readonly version: EmailPolicyVersion
}
interface NormalizedEmailPolicyFields {
	readonly textVersion: 'email-text-v1'
	readonly sender: string
	readonly params: readonly EmailParameter[]
	readonly instructions: string
	readonly contentScope: EmailContentScope
	readonly allowedDkimSigningDomains: readonly string[]
	readonly expectedRecipient?: string
	readonly minEmailDateS?: number
	readonly maxEmailDateS?: number
}
/** Trusted server input. Portal must establish account ownership before calling the core. */
export interface TrustedEmailBinding {
	readonly appId: string
	readonly sessionId: string
	readonly requestHash: string
	readonly policyHash: string
	readonly accountId: string
	readonly accountAddress: string
	readonly messageId: string
	readonly attemptId: string
	readonly expiresAt: number // Unix milliseconds, separate from the signed email date.
}
export interface EmailSource {
	readonly id: string
	readonly kind: 'body' | 'attachment'
	readonly text: string
	readonly textSha256: string
	readonly attachmentSha256?: string
	readonly pageRanges?: readonly { page: number, start: number, end: number }[]
}
export interface EmailAiInput {
	readonly params: readonly EmailParameter[]
	readonly instructions: string
	readonly contentScope: EmailContentScope
	readonly sources: readonly EmailSource[]
}
export interface SourceInventoryEntry {
	readonly id: string
	readonly kind: 'body' | 'attachment'
	readonly mimeType: string
	readonly inScope: boolean
	readonly empty: boolean
	readonly decodedBytes: number
	readonly filename?: string
	readonly exclusionReason?:
		| 'ATTACHMENT_FORMAT_UNSUPPORTED'
		| 'ATTACHMENT_TEXT_TOO_LARGE'
	readonly attachmentSha256?: string
	readonly textSha256?: string
}
export interface SelectedDkimSignature {
	readonly headerIndex: number
	readonly signingDomain: string
	readonly selector: string
	readonly signatureSha256: string
	readonly headerSha256: string
	readonly headerCanonicalization: 'simple' | 'relaxed'
	readonly bodyCanonicalization: 'simple' | 'relaxed'
}
export interface DkimStatus {
	readonly headerIndex: number
	readonly result: string
	readonly testing: boolean
}
export interface ApprovedEmailSummary {
	readonly rawEmailSha256: string
	readonly from: string
	readonly to: readonly string[]
	readonly fromDisplay: string
	readonly toDisplay: string
	readonly date: string
	readonly timestampS: number
	readonly signature: SelectedDkimSignature
	readonly dkim: readonly DkimStatus[]
	readonly inventory: readonly SourceInventoryEntry[]
	readonly sourceManifest: readonly Omit<EmailSource, 'text' | 'pageRanges'>[]
	readonly contentScope: EmailContentScope
	readonly textVersion: 'email-text-v1'
}
// Runtime identity is checked independently of this compile-time brand.
declare const approvedBrand: unique symbol
export interface ApprovedEmailContent {
	readonly [approvedBrand]: true
}
export interface LiteralEvidence {
	sourceId: string
	sourceSha256: string
	attachmentSha256?: string
	page?: number
	quoteStart: number
	quoteEnd: number
	quote: string
	valueStart: number
	valueEnd: number
}
export interface FieldEvidence extends LiteralEvidence {
	/** Separately authenticated currency label for a combined monetary value. */
	currency?: LiteralEvidence
	transform:
		| 'verbatim'
		| 'trim'
		| 'number'
		| 'count'
		| 'currency'
		| 'currency-code'
		| 'money'
		| 'date'
}
export type AiContentCheckResult =
	| {
		outcome: 'pass'
		reviewedSourceIds: string[]
		fields: Record<string, { value: string, evidence: FieldEvidence }>
	}
	| { outcome: 'fail' | 'insufficient', reason: string }
declare const checkedBrand: unique symbol
export interface CheckedEmailResult {
	readonly [checkedBrand]: true
}
export interface EmailAnalysisMetadata {
	readonly inputSha256: string
	readonly model: string
	readonly promptVersion: 'email-content-v10'
}
export interface CheckedEmailSummary {
	readonly fields: Readonly<
		Record<
			string,
			{ readonly value: string, readonly evidence: Readonly<FieldEvidence> }
		>
	>
	readonly omittedOptional: readonly string[]
	readonly sourceManifest: ApprovedEmailSummary['sourceManifest']
	readonly rawEmailSha256: string
	readonly analysis: EmailAnalysisMetadata
}
export interface RawEmailSourceV1 {
	kind: 'raw-rfc822-v1'
	rawEmailBase64: string
}
/** Signed email envelope; source verification dispatches independently of common claim/value access. */
export interface EmailProofV1 {
	proofType: 'email-v1'
	identifier: string
	claimData: {
		provider: 'email'
		parameters: string
		context: string
		owner: string
		timestampS: number
		identifier: string
		epoch: 1
	}
	signatures: [string]
	issuer: { type: 'reclaim-portal', address: string }
	extractedParameterValues: Record<string, string>
	emailProof: {
		version: 1
		source: RawEmailSourceV1
		rawEmailSha256: string
		authenticatedAddress: string
		policyVersion: EmailPolicyVersion
		textPolicyVersion: 'email-text-v1'
		acceptedDkimSignature: Omit<SelectedDkimSignature, 'headerSha256'>
		contentScope: EmailContentScope
		sourceManifest: readonly Omit<EmailSource, 'text' | 'pageRanges'>[]
		aiContentCheck: {
			outcome: 'pass'
			promptVersion: 'email-content-v10'
			model: string
			inputSha256: string
			reviewedSourceIds: string[]
		}
		evidence: Record<string, FieldEvidence>
	}
}
