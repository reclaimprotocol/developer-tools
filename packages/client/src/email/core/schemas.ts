/* eslint-disable @stylistic/max-len */
/** Browser-safe data schemas. Trust-boundary callers must reject accessors before parsing. */
import { z } from 'zod'
import { normalizeEmailDomainPattern, parseEmailSender } from './sender.ts'

const parameterName = z
	.string()
	.regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/)
	.refine((name) => !['__proto__', 'constructor', 'prototype'].includes(name))
export const emailContentScopeSchema = z.enum([
	'body-and-attachments',
	'body-only',
	'attachments-only',
])
const fieldInstructions = z
	.string()
	.max(10_000)
	.refine((value) => value.trim().length > 0)
export const emailParameterSchema = z.strictObject({
	name: parameterName,
	instructions: fieldInstructions,
	isOptional: z.boolean(),
})
const dateBound = z.number().int().min(-2208988800).max(253402300799)
const policyFields = {
	sender: z.string().min(1).max(320),
	instructions: z.string().max(10_000).optional(),
	contentScope: emailContentScopeSchema.optional(),
	allowedDkimSigningDomains: z
		.array(z.string().min(1).max(255))
		.min(1)
		.max(16)
		.optional(),
	expectedRecipient: z.string().min(1).max(254).optional(),
	minEmailDateS: dateBound.optional(),
	maxEmailDateS: dateBound.optional(),
}
const orderedDates = (p: { minEmailDateS?: number, maxEmailDateS?: number }) => p.minEmailDateS === undefined ||
	p.maxEmailDateS === undefined ||
	p.minEmailDateS <= p.maxEmailDateS
export const emailPolicyInputSchema = z
	.strictObject({
		...policyFields,
		params: z
			.array(
				emailParameterSchema.extend({ isOptional: z.boolean().optional() }),
			)
			.min(1)
			.max(32),
	})
	.refine(orderedDates)
const normalizedFields = {
	...policyFields,
	textVersion: z.literal('email-text-v1'),
	params: z.array(emailParameterSchema).min(1).max(32),
	instructions: z.string().max(10_000),
	contentScope: emailContentScopeSchema,
	allowedDkimSigningDomains: z.array(z.string().min(1).max(255)).min(1).max(16),
}
export const normalizedEmailPolicySchema = z
	.strictObject({
		...normalizedFields,
		version: z.literal('email-dkim-v5'),
	})
	.refine(orderedDates)
	.refine((p) => {
		try {
			parseEmailSender(p.sender)
			for(const domain of p.allowedDkimSigningDomains) {
				normalizeEmailDomainPattern(domain)
			}

			return true
		} catch{
			return false
		}
	})
const identifier = z.string().regex(/^[A-Za-z0-9._:@+-]{1,256}$/)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const sourceId = z.string().regex(/^(body|attachment):\d{1,6}$/)
const offset = z.number().int().min(0).max(100_000)
export const literalEvidenceSchema = z.strictObject({
	sourceId,
	sourceSha256: digest,
	attachmentSha256: digest.optional(),
	page: z.number().int().min(1).max(100).optional(),
	quoteStart: offset,
	quoteEnd: offset,
	quote: z.string().max(2048),
	valueStart: offset,
	valueEnd: offset,
})
export const fieldEvidenceSchema = literalEvidenceSchema.extend({
	currency: literalEvidenceSchema.optional(),
	transform: z.enum([
		'verbatim',
		'trim',
		'number',
		'count',
		'currency',
		'currency-code',
		'money',
		'date',
	]),
})
export const emailAiFieldSchema = z.strictObject({
	value: z.string().max(1024),
	evidence: fieldEvidenceSchema,
})
const aiFailure = z.strictObject({
	outcome: z.enum(['fail', 'insufficient']),
	reason: z.string().min(1).max(2048),
})
export const aiContentCheckSchema = z.union([
	z.strictObject({
		outcome: z.literal('pass'),
		reviewedSourceIds: z.array(sourceId).min(1).max(1000),
		fields: z
			.record(parameterName, emailAiFieldSchema)
			.refine((fields) => Object.keys(fields).length <= 32),
	}),
	aiFailure,
])
export const trustedEmailBindingSchema = z.strictObject({
	appId: identifier,
	sessionId: identifier,
	requestHash: digest,
	policyHash: digest,
	accountId: identifier,
	accountAddress: z.string().min(1).max(254),
	messageId: identifier,
	attemptId: identifier,
	expiresAt: z.number().int().positive(),
})

const format = z.enum([
	'pdf',
	'docx',
	'xlsx',
	'txt',
	'csv',
	'html',
	'json',
	'xml',
])
const workerIdentity = {
	id: z.string().regex(/^(body|attachment):\d{1,6}$/),
	filename: z.string().max(128 * 1024),
}
const pageRange = z.strictObject({
	page: z.number().int().min(1).max(100),
	start: z.number().int().min(0).max(2_000_000),
	end: z.number().int().min(0).max(2_000_000),
})
const workerSuccess = z
	.strictObject({
		...workerIdentity,
		status: z.literal('ok'),
		format,
		encoding: z.string().min(1).max(64).optional(),
		text: z.string().max(2_000_000),
		pageRanges: z.array(pageRange).min(1).max(100).optional(),
	})
	.superRefine((result, ctx) => {
		if(result.pageRanges) {
			let end = 0
			for(const [index, page] of result.pageRanges.entries()) {
				if(
					result.format !== 'pdf' ||
					page.page !== index + 1 ||
					page.start !== end ||
					page.end < page.start ||
					page.end > result.text.length ||
					splitsSurrogate(result.text, page.end)
				) {
					ctx.addIssue({ code: 'custom', message: 'Invalid page coverage' })
				}

				end = page.end
			}

			if(end !== result.text.length) {
				ctx.addIssue({ code: 'custom', message: 'Incomplete page coverage' })
			}
		} else if(result.format === 'pdf') {
			ctx.addIssue({ code: 'custom', message: 'Missing PDF pages' })
		}
	})
function splitsSurrogate(text: string, offset: number): boolean {
	return (
		offset > 0 &&
		/[\uD800-\uDBFF]/.test(text[offset - 1]) &&
		/[\uDC00-\uDFFF]/.test(text[offset] ?? '')
	)
}

const workerFailure = z.strictObject({
	...workerIdentity,
	status: z.literal('error'),
	format: format.optional(),
	code: z.enum([
		'ATTACHMENT_FORMAT_UNSUPPORTED',
		'ATTACHMENT_FORMAT_INVALID',
		'ATTACHMENT_FORMAT_NOT_ALLOWED',
		'ATTACHMENT_TEXT_UNREADABLE',
		'ATTACHMENT_NO_TEXT',
		'ATTACHMENT_ENCRYPTED',
		'ATTACHMENT_TEXT_TOO_LARGE',
		'ATTACHMENT_TEXT_EXTRACTION_FAILED',
	]),
	stage: z.enum(['format', 'text']),
})
export const documentWorkerResultSchema = z.discriminatedUnion('status', [
	workerSuccess,
	workerFailure,
	z.strictObject({ ...workerIdentity, status: z.literal('inspected'), format }),
])
export const documentWorkerResultsSchema = z
	.array(documentWorkerResultSchema)
	.max(1000)
	.superRefine((results, ctx) => {
		if(
			new Set(results.map((r) => r.id)).size !== results.length ||
			results.reduce((n, r) => n + (r.status === 'ok' ? r.text.length : 0), 0) >
				100_000
		) {
			ctx.addIssue({ code: 'custom', message: 'Invalid source coverage' })
		}
	})
