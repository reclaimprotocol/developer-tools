export const EMAIL_ATTACHMENT_POLICY_VERSION = 2
export type * from './contracts.ts'
export {
	buildCheckedEmailExtension,
	verifyEmailProofSource,
} from './proof-source.ts'
export { EMAIL_CHECK_EVENTS_VERSION } from './check-events.ts'
export type {
	EmailCheckEvent,
	EmailCheckObserver,
	EmailCheckStep,
} from './check-events.ts'
export {
	validateAiContentCheck,
	inspectCheckedEmail,
	transformEmailValue,
	EmailContentCheckError,
} from './ai-check.ts'
export {
	normalizeEmailPolicy,
	hashEmailPolicy,
	canonicalJson,
} from './policy.ts'
export {
	parseEmailSender,
	matchesEmailSender,
	matchesEmailDomain,
	normalizeEmailDomainPattern,
	normalizeEmailMailbox,
} from './sender.ts'
export {
	approveEmailSnapshot,
	EmailApprovalError,
	projectApprovedEmail,
	inspectApprovedEmail,
	copyApprovedRawEmail,
	releaseApprovedEmail,
} from './approval.ts'
