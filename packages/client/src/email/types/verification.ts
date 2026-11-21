export interface VerifiedEmail {
	flowId?: string
	to: string
	from: string
	'date and time': string
	'email body': string
	signingDomain: string
	attachments: VerifiedAttachment[]
	outcome: 'pass'
	checks: VerificationChecks
	matched: boolean | null
	ruleResults: RegexRuleResult[]
}
export interface VerifiedAttachment {
	id: string
	filename: string
	mimeType: string
	size: number
	sha256: string
	inline?: boolean
	format?: AttachmentFormat
	textEncoding?: string
}
export interface RegexPattern {
	pattern: string
	flags?: string
}
export type IdentityMatcher = string | RegexPattern
export interface RegexRule extends RegexPattern {
	target: 'body' | 'attachment'
	filename?: string
}
export const ATTACHMENT_FORMATS = [
	'pdf',
	'docx',
	'xlsx',
	'txt',
	'csv',
	'html',
	'json',
	'xml',
] as const
export type AttachmentFormat = (typeof ATTACHMENT_FORMATS)[number]
export interface VerificationParameters {
	acceptedSigners?: IdentityMatcher[]
	allowedSenders?: IdentityMatcher[]
	regexRules?: RegexRule[]
	expectedAttachmentFormats?: AttachmentFormat[]
}
export type CheckStatus = 'pass' | 'fail' | 'skipped' | 'not_requested'
export interface VerificationChecks {
	verification: 'pass' | 'fail'
	signer: CheckStatus
	formats: CheckStatus
	regexp: CheckStatus
}
export interface RegexRuleResult {
	rule: number
	target: RegexRule['target']
	matched: boolean | null
	attachmentIds?: string[]
	code?: string
}
export interface CannotVerify {
	flowId?: string
	status: 'cannot verify'
	reasons: VerificationIssue[]
	outcome: 'fail'
	checks: VerificationChecks
	matched: boolean | null
	ruleResults: RegexRuleResult[]
}
export interface VerificationIssue {
	code: string
	message: string
	fields?: string[]
	signature?: number
	stage?: 'verification' | 'signer' | 'attachments' | 'regexp'
	rule?: number
}
export type VerificationResult = VerifiedEmail | CannotVerify
export function cannotVerify(...reasons: VerificationIssue[]): CannotVerify {
	return {
		status: 'cannot verify',
		outcome: 'fail',
		checks: {
			verification: 'fail',
			signer: 'skipped',
			formats: 'skipped',
			regexp: 'skipped',
		},
		matched: null,
		ruleResults: [],
		reasons: reasons.map((reason) => ({ stage: 'verification', ...reason })),
	}
}

export interface EmailSummary {
	id: string
	from: string
	to: string
	subject: string
	date: string
}
export interface EmailPreview {
	body: string
	attachments: PreviewAttachment[]
}
export type PreviewAttachment = Pick<
	VerifiedAttachment,
	'id' | 'filename' | 'mimeType' | 'size' | 'sha256' | 'inline'
>
export interface SearchCursor {
	before: number
}
export interface SearchPage {
	messages: EmailSummary[]
	nextCursor: SearchCursor | null
	since: number
}
