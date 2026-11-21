/* eslint-disable @stylistic/max-len */
import {
	emailCurrencyAmount,
	normalizeEmailCurrencyCode,
	normalizeEmailMoney,
} from './ai-currency.ts'
import { normalizeEmailDate } from './ai-date.ts'
import { canonicalEmailNumber } from './ai-decimal.ts'
import {
	copyApprovedRawEmail,
	inspectApprovedEmail,
	projectApprovedEmail,
} from './approval.ts'
import { type EmailCheckObserver, reportEmailCheck } from './check-events.ts'
import type {
	ApprovedEmailContent,
	CheckedEmailResult,
	CheckedEmailSummary,
	EmailAnalysisMetadata,
	EmailSource,
	FieldEvidence,
	LiteralEvidence,
	TrustedEmailBinding,
} from './contracts.ts'
import { canonicalJson, freeze, sha256 } from './policy.ts'
import { plainCopy } from './policy-data.ts'
import { aiContentCheckSchema } from './schemas.ts'

export class EmailContentCheckError extends Error {
	readonly code: string
	readonly detail?: string
	constructor(code: string, detail?: string) {
		super(code)
		this.code = code
		this.detail = detail
		this.name = 'EmailContentCheckError'
	}
}
function reject(code: string, detail?: string): never {
	throw new EmailContentCheckError(code, detail)
}

const asciiTrim = (s: string) => s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
function number(s: string): string {
	return canonicalEmailNumber(s) ?? reject('EMAIL_AI_INVALID_EVIDENCE')
}

// Closed lexical normalization, not free-form language interpretation. Keep
// quantities as strings so arbitrarily large integer literals remain exact.
const countWords = [
	'zero',
	'one',
	'two',
	'three',
	'four',
	'five',
	'six',
	'seven',
	'eight',
	'nine',
	'ten',
	'eleven',
	'twelve',
	'thirteen',
	'fourteen',
	'fifteen',
	'sixteen',
	'seventeen',
	'eighteen',
	'nineteen',
]
const countTens = [
	'twenty',
	'thirty',
	'forty',
	'fifty',
	'sixty',
	'seventy',
	'eighty',
	'ninety',
]
function count(text: string): string {
	const literal = asciiTrim(text).toLowerCase()
	if(/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(literal)) {
		return number(literal)
	}

	if(literal === 'no' || literal === 'none') {
		return '0'
	}

	const small = countWords.indexOf(literal)
	if(small >= 0) {
		return String(small)
	}

	const parts = literal.split(/[ -]/)
	const tens = countTens.indexOf(parts[0])
	const unit = parts.length === 1 ? 0 : countWords.indexOf(parts[1])
	if(
		tens >= 0 &&
		parts.length <= 2 &&
		unit >= 0 &&
		unit <= 9 &&
		(parts.length === 1 || unit > 0)
	) {
		return String((tens + 2) * 10 + unit)
	}

	return reject('EMAIL_AI_INVALID_EVIDENCE', 'COUNT_LITERAL_UNSUPPORTED')
}

function countTokenBoundary(text: string, start: number, end: number): void {
	// A model cannot turn "not" into "no", "someone" into "one", or 12 into 2.
	const token = /[\p{L}\p{N}\p{M}_.,+\-×]/u
	const before = [...text.slice(Math.max(0, start - 2), start)].at(-1) ?? ''
	const after = [...text.slice(end, end + 2)].at(0) ?? ''
	// x/× are quantity markers, not part of the selected integer. Do not accept
	// a numeric continuation such as 2x3 as a stand-alone count token.
	const quantityMarker =
		/^[0-9,]+$/.test(text.slice(start, end)) &&
		/^[xX×](?:[ \t\r\n.,;:!?)]|$)/.test(text.slice(end))
	if(
		(before && token.test(before)) ||
		(after && /[\p{L}\p{N}\p{M}_+\-×]/u.test(after) && !quantityMarker) ||
		(/[.,]/.test(after) && /\d/.test(text[end + 1] ?? ''))
	) {
		reject('EMAIL_AI_INVALID_EVIDENCE', 'COUNT_TOKEN_BOUNDARY')
	}
}

/** Shared, exact string arithmetic. Never calculates, rounds or guesses a locale. */
export function transformEmailValue(
	text: string,
	transform: FieldEvidence['transform'],
	currencyText?: string,
): string {
	if(!text || text.length > 2048) {
		return reject('EMAIL_AI_INVALID_EVIDENCE')
	}

	if(currencyText !== undefined && transform !== 'money') {
		return reject('EMAIL_AI_INVALID_EVIDENCE', 'CURRENCY_EVIDENCE_UNEXPECTED')
	}

	if(transform === 'money') {
		const result = normalizeEmailMoney(text, currencyText)
		if('error' in result) {
			return reject('EMAIL_AI_INVALID_EVIDENCE', result.error)
		}

		return result.value
	}

	if(transform === 'verbatim') {
		return text
	}

	if(transform === 'trim') {
		return asciiTrim(text)
	}

	if(transform === 'number') {
		return number(text)
	}

	if(transform === 'count') {
		return count(text)
	}

	if(transform === 'currency') {
		const result = emailCurrencyAmount(text)
		if('error' in result) {
			return reject('EMAIL_AI_INVALID_EVIDENCE', result.error)
		}

		return number(result.literal)
	}

	if(transform === 'currency-code') {
		const result = normalizeEmailCurrencyCode(text)
		if('error' in result) {
			return reject('EMAIL_AI_INVALID_EVIDENCE', result.error)
		}

		return result.value
	}

	if(transform === 'date') {
		const result = normalizeEmailDate(text)
		if('error' in result) {
			return reject('EMAIL_AI_INVALID_EVIDENCE', result.error)
		}

		return result.value
	}

	return reject('EMAIL_AI_INVALID_EVIDENCE')
}

function authenticatedLiteral(source: EmailSource, e: LiteralEvidence): string {
	if(
		e.sourceSha256 !== source.textSha256 ||
		e.attachmentSha256 !== source.attachmentSha256
	) {
		reject('EMAIL_AI_INVALID_EVIDENCE', 'HASH_MISMATCH')
	}

	if(
		!(
			e.quoteStart <= e.valueStart &&
			e.valueStart < e.valueEnd &&
			e.valueEnd <= e.quoteEnd &&
			e.quoteEnd <= source.text.length
		)
	) {
		reject('EMAIL_AI_INVALID_EVIDENCE', 'SPAN_OUT_OF_BOUNDS')
	}

	if(e.quote !== source.text.slice(e.quoteStart, e.quoteEnd)) {
		reject('EMAIL_AI_INVALID_EVIDENCE', 'QUOTE_MISMATCH')
	}

	if(
		source.pageRanges
			? !source.pageRanges.some(
				(p) => p.page === e.page && e.quoteStart >= p.start && e.quoteEnd <= p.end,
			)
			: e.page !== undefined
	) {
		reject('EMAIL_AI_INVALID_EVIDENCE', 'PAGE_MISMATCH')
	}

	return source.text.slice(e.valueStart, e.valueEnd)
}

function currencyBoundary(
	text: string,
	e: LiteralEvidence,
	fragment: string,
	amount: boolean,
): void {
	const literal = fragment.replace(
		/^[ \t\r\n\u00a0\u202f]+|[ \t\r\n\u00a0\u202f]+$/g,
		'',
	)
	const start = e.valueStart + fragment.indexOf(literal),
		end = start + literal.length
	const before = [...text.slice(0, start)].at(-1) ?? '',
		after = [...text.slice(end)].at(0) ?? ''
	const word = /[\p{L}\p{M}_]/u
	if(
		word.test(before) ||
		word.test(after) ||
		(amount &&
			(/[\p{Nd}+\-]/u.test(before) ||
				/\p{Nd}/u.test(after) ||
				/\p{Nd}[.,٫٬]$/u.test(text.slice(0, start)) ||
				/^[.,٫٬]\p{Nd}/u.test(text.slice(end))))
	) {
		reject('EMAIL_AI_INVALID_EVIDENCE', 'CURRENCY_TOKEN_BOUNDARY')
	}
}

const records = new WeakMap<
	CheckedEmailResult,
	{ approved: ApprovedEmailContent, summary: CheckedEmailSummary }
>()
/** The gateway supplies metadata from the actual invocation, never from the model/browser. */
export function validateAiContentCheck(
	approved: ApprovedEmailContent,
	binding: TrustedEmailBinding,
	candidate: unknown,
	metadata: EmailAnalysisMetadata,
	observer?: EmailCheckObserver,
): CheckedEmailResult {
	const input = projectApprovedEmail(approved, binding)
	const approval = inspectApprovedEmail(approved, binding)
	const meta = plainCopy(metadata) as EmailAnalysisMetadata
	if(
		Object.keys(meta).sort().join(',') !== 'inputSha256,model,promptVersion' ||
		meta.promptVersion !== 'email-content-v10' ||
		typeof meta.model !== 'string' ||
		!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(meta.model) ||
		meta.inputSha256 !== sha256(canonicalJson(input))
	) {
		reject('EMAIL_AI_INPUT_MISMATCH')
	}

	let parsed
	try {
		parsed = aiContentCheckSchema.safeParse(plainCopy(candidate))
	} catch{
		return reject('EMAIL_AI_INVALID_RESPONSE')
	}

	if(!parsed.success) {
		return reject('EMAIL_AI_INVALID_RESPONSE')
	}

	const result = parsed.data
	if(result.outcome !== 'pass') {
		return reject(
			result.outcome === 'fail'
				? 'EMAIL_AI_CONTENT_FAILED'
				: 'EMAIL_AI_INSUFFICIENT',
		)
	}

	const ids = result.reviewedSourceIds
	if(
		ids.length !== input.sources.length ||
		new Set(ids).size !== ids.length ||
		input.sources.some((s) => !ids.includes(s.id))
	) {
		reject('EMAIL_AI_INCOMPLETE_REVIEW')
	}

	if(
		Object.keys(result.fields).some(
			(name) => !input.params.some((p) => p.name === name),
		)
	) {
		reject('EMAIL_AI_UNDECLARED_FIELD')
	}

	const fields: Record<string, { value: string, evidence: FieldEvidence }> =
		Object.create(null)
	const omittedOptional: string[] = []
	for(const parameter of input.params) {
		const field = result.fields[parameter.name]
		try {
			if(!field) {
				reject('EMAIL_AI_MISSING_REQUIRED')
			}

			const { value, evidence: e } = field
			const source = input.sources.find((s) => s.id === e.sourceId)
			if(
				!value.trim() ||
				/^(?:n\/?a|unknown|none|null|undefined|not (?:available|known|provided|applicable))$/i.test(
					value.trim(),
				)
			) {
				reject('EMAIL_AI_INVALID_EVIDENCE', 'PLACEHOLDER_VALUE')
			}

			if(!source) {
				reject('EMAIL_AI_INVALID_EVIDENCE', 'SOURCE_NOT_FOUND')
			}

			const fragment = authenticatedLiteral(source, e)
			let currencyText: string | undefined
			if(e.currency) {
				if(e.transform !== 'money') {
					reject('EMAIL_AI_INVALID_EVIDENCE', 'CURRENCY_EVIDENCE_UNEXPECTED')
				}

				const currencySource = input.sources.find(
					(s) => s.id === e.currency!.sourceId,
				)
				if(!currencySource) {
					reject('EMAIL_AI_INVALID_EVIDENCE', 'CURRENCY_SOURCE_NOT_FOUND')
				}

				currencyText = authenticatedLiteral(currencySource, e.currency)
				currencyBoundary(currencySource.text, e.currency, currencyText, false)
			}

			if(['currency', 'currency-code', 'money'].includes(e.transform)) {
				currencyBoundary(
					source.text,
					e,
					fragment,
					e.transform !== 'currency-code',
				)
			}

			if(
				e.transform === 'date' &&
				(/\d(?:[./-])?$/.test(source.text.slice(0, e.valueStart)) ||
					/^(?:[./-])?\d/.test(source.text.slice(e.valueEnd)))
			) {
				reject('EMAIL_AI_INVALID_EVIDENCE', 'DATE_TOKEN_BOUNDARY')
			}

			if(e.transform === 'count') {
				const trimmed = asciiTrim(fragment)
				if(/^(?:no|none)$/i.test(trimmed) && asciiTrim(e.quote) === trimmed) {
					reject('EMAIL_AI_INVALID_EVIDENCE', 'COUNT_CONTEXT_REQUIRED')
				}

				const offset = fragment.indexOf(trimmed)
				countTokenBoundary(
					source.text,
					e.valueStart + offset,
					e.valueStart + offset + trimmed.length,
				)
			}

			if(transformEmailValue(fragment, e.transform, currencyText) !== value) {
				reject('EMAIL_AI_INVALID_EVIDENCE', 'VALUE_MISMATCH')
			}

			fields[parameter.name] = field
			reportEmailCheck(observer, {
				step: 'evidence_validation',
				status: 'passed',
				details: {
					field: parameter.name,
					sourceId: source.id,
					transform: e.transform,
				},
			})
		} catch(error) {
			reportEmailCheck(observer, {
				step: 'evidence_validation',
				status: parameter.isOptional ? 'omitted' : 'failed',
				code:
					error instanceof EmailContentCheckError
						? error.code
						: 'EMAIL_AI_INVALID_EVIDENCE',
				details: {
					field: parameter.name,
					...(field ? { transform: field.evidence.transform } : {}),
					...(error instanceof EmailContentCheckError && error.detail
						? { check: error.detail }
						: {}),
				},
			})
			if(!parameter.isOptional || !(error instanceof EmailContentCheckError)) {
				throw error
			}

			omittedOptional.push(parameter.name)
		}
	}

	const handle = Object.freeze(Object.create(null)) as CheckedEmailResult
	records.set(handle, {
		approved,
		summary: freeze({
			fields,
			omittedOptional,
			sourceManifest: approval.sourceManifest,
			rawEmailSha256: approval.rawEmailSha256,
			analysis: meta,
		}),
	})
	return handle
}

/** Revalidates the parent capability and its binding on every use, including after cancellation. */
export function inspectCheckedEmail(
	result: CheckedEmailResult,
	binding: TrustedEmailBinding,
): CheckedEmailSummary {
	const record = records.get(result)
	if(!record) {
		return reject('INVALID_CHECKED_EMAIL_HANDLE')
	}

	inspectApprovedEmail(record.approved, binding)
	return record.summary
}

/** Issuance only: the private checked handle determines the exact approved raw snapshot. */
export function copyCheckedEmailSource(
	result: CheckedEmailResult,
	binding: TrustedEmailBinding,
) {
	const checked = inspectCheckedEmail(result, binding)
	const approved = records.get(result)!.approved
	return {
		checked,
		summary: inspectApprovedEmail(approved, binding),
		raw: copyApprovedRawEmail(approved, binding),
	}
}
