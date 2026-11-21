/* eslint-disable @stylistic/max-len */
import { z } from 'zod'
import { EmailContentCheckError } from './ai-check.ts'
import type {
	EmailSource,
	FieldEvidence,
	LiteralEvidence,
} from './contracts.ts'
import { fieldEvidenceSchema } from './schemas.ts'

/** Models select literal evidence. Only trusted code computes offsets and copies hashes. */
const modelLiteralEvidenceSchema = z.strictObject({
	sourceId: fieldEvidenceSchema.shape.sourceId,
	page: fieldEvidenceSchema.shape.page.unwrap().nullable(),
	quoteBefore: z.string().max(2048),
	valueText: z.string().min(1).max(2048),
	quoteAfter: z.string().max(2048),
})

// Both branches are strict objects with required properties, suitable for strict
// structured output. Existing non-money evidence does not acquire a new key.
const modelValueEvidenceSchema = modelLiteralEvidenceSchema.extend({
	transform: fieldEvidenceSchema.shape.transform,
})
export const modelEvidenceSchema = z.union([
	modelValueEvidenceSchema,
	modelValueEvidenceSchema.extend({ currency: modelLiteralEvidenceSchema }),
])

function reject(detail: string): never {
	throw new EmailContentCheckError('EMAIL_AI_INVALID_EVIDENCE', detail)
}

function exactIndex(text: string, literal: string): number {
	const index = text.indexOf(literal)
	if(!literal || index < 0) {
		return reject('QUOTE_NOT_FOUND')
	}

	return index
}

function resolveLiteralEvidence(
	sources: readonly EmailSource[],
	evidence: z.infer<typeof modelLiteralEvidenceSchema>,
): LiteralEvidence {
	const source = sources.find((s) => s.id === evidence.sourceId)
	if(!source) {
		return reject('SOURCE_NOT_FOUND')
	}

	const page = source.pageRanges?.find((p) => p.page === evidence.page)
	if(source.pageRanges ? !page : evidence.page !== null) {
		return reject('PAGE_MISMATCH')
	}

	const start = page?.start ?? 0,
		end = page?.end ?? source.text.length
	const quote = evidence.quoteBefore + evidence.valueText + evidence.quoteAfter
	if(quote.length > 2048) {
		return reject('QUOTE_TOO_LONG')
	}

	// Identical quotes prove the same literal value. Select the first exact occurrence
	// deterministically; semantic attribution/conflicts still require full-source review.
	// Never rewrite whitespace, search another source/page or accept a near match.
	const quoteStart = start + exactIndex(source.text.slice(start, end), quote)
	const valueStart = quoteStart + evidence.quoteBefore.length
	return {
		sourceId: source.id,
		sourceSha256: source.textSha256,
		...(source.attachmentSha256
			? { attachmentSha256: source.attachmentSha256 }
			: {}),
		...(page ? { page: page.page } : {}),
		quote,
		quoteStart,
		quoteEnd: quoteStart + quote.length,
		valueStart,
		valueEnd: valueStart + evidence.valueText.length,
	}
}

export function resolveModelEvidence(
	sources: readonly EmailSource[],
	evidence: z.infer<typeof modelEvidenceSchema>,
): FieldEvidence {
	return {
		...resolveLiteralEvidence(sources, evidence),
		transform: evidence.transform,
		...('currency' in evidence
			? { currency: resolveLiteralEvidence(sources, evidence.currency) }
			: {}),
	}
}
