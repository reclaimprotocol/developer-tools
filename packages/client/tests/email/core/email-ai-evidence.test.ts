/* eslint-disable @stylistic/max-len -- ported from the email core's test suite; kept close to upstream so the two can be compared */
import {
	modelEvidenceSchema,
	resolveModelEvidence,
} from '../../../src/email/core/ai-evidence.ts'
import type { EmailSource } from '../../../src/email/core/contracts.ts'
import { sha256 } from '../../../src/email/core/policy.ts'
import { describe, expect, it } from './vitest-compat.ts'

// Synthetic multi-page ticket: no passenger data or bytes from the user's email.
const prefix = 'Synthetic travel details 😀\n'.repeat(150)
const page =
	'Passenger: Synthetic Alice\nBaggage provisions\nCarry-on baggage   0 pieces\nBaggage allowance   0 pieces   n/a\nGeneral baggage provisions\n'
const text = prefix + page
const source: EmailSource = {
	id: 'attachment:1',
	kind: 'attachment',
	text,
	textSha256: sha256(text),
	attachmentSha256: 'a'.repeat(64),
	pageRanges: [
		{ page: 1, start: 0, end: prefix.length },
		{ page: 2, start: prefix.length, end: text.length },
	],
}
const evidence = {
	sourceId: source.id,
	page: 2,
	quoteBefore: 'Baggage allowance   ',
	valueText: '0',
	quoteAfter: ' pieces   n/a',
	transform: 'number' as const,
}

describe('exact model quote resolution', () => {
	it('locates a zero count deep in a PDF without asking the model to count UTF-16 positions', () => {
		const resolved = resolveModelEvidence([source], evidence)
		expect(resolved.quoteStart).toBe(
			text.indexOf(
				evidence.quoteBefore + evidence.valueText + evidence.quoteAfter,
			),
		)
		expect(text.slice(resolved.quoteStart, resolved.quoteEnd)).toBe(
			evidence.quoteBefore + evidence.valueText + evidence.quoteAfter,
		)
		expect(text.slice(resolved.valueStart, resolved.valueEnd)).toBe('0')
		expect(resolved).toMatchObject({
			sourceId: source.id,
			page: 2,
			sourceSha256: source.textSha256,
			attachmentSha256: source.attachmentSha256,
		})
	})
	it.each([
		{ sourceId: 'body:0' },
		{ page: 1 },
		{ page: null },
		{ page: 3 },
		{ quoteBefore: 'Baggage allowance ' },
		{ valueText: '2' },
		{ quoteBefore: prefix.slice(-20) + page.slice(0, page.indexOf('0')) },
		{ quoteBefore: 'x'.repeat(2048) },
	])(
		'rejects missing, rewritten, cross-page or incorrectly attributed evidence: %j',
		(change) => {
			expect(() => resolveModelEvidence([source], { ...evidence, ...change }),
			).toThrow('EMAIL_AI_INVALID_EVIDENCE')
		},
	)
	it('uses the selected page to disambiguate identical quotes on different pages', () => {
		const repeated = {
			...source,
			text: page + page,
			textSha256: sha256(page + page),
			pageRanges: [
				{ page: 1, start: 0, end: page.length },
				{ page: 2, start: page.length, end: 2 * page.length },
			],
		}
		expect(resolveModelEvidence([repeated], evidence).quoteStart).toBe(
			page.length +
				page.indexOf(
					evidence.quoteBefore + evidence.valueText + evidence.quoteAfter,
				),
		)
	})
	it('uses a stable exact occurrence for repeated and overlapping literal evidence', () => {
		const body: EmailSource = {
			id: 'body:0',
			kind: 'body',
			text: 'aaa',
			textSha256: sha256('aaa'),
		}
		const repeated = resolveModelEvidence([body], {
			...evidence,
			sourceId: body.id,
			page: null,
			quoteBefore: '',
			valueText: 'a',
			quoteAfter: 'a',
		})
		expect(repeated.quoteStart).toBe(0)
		expect(repeated.valueStart).toBe(0)
		expect(
			resolveModelEvidence([body], {
				...evidence,
				sourceId: body.id,
				page: null,
				quoteBefore: 'a',
				valueText: 'a',
				quoteAfter: 'a',
			}).valueStart,
		).toBe(1)
	})
	it('accepts duplicated presentation blocks while retaining the selected literal and exact source hash', () => {
		const block = 'Account: Synthetic Alice\nNo additional users enabled.\n'
		const body: EmailSource = {
			id: 'body:0',
			kind: 'body',
			text: block + block,
			textSha256: sha256(block + block),
		}
		const selected = {
			sourceId: body.id,
			page: null,
			quoteBefore: 'Account: Synthetic Alice\n',
			valueText: 'No',
			quoteAfter: ' additional users enabled.',
			transform: 'count' as const,
		}
		const resolved = resolveModelEvidence([body], selected)
		expect(resolved.quoteStart).toBe(0)
		expect(resolved.valueStart).toBe(block.indexOf('No'))
		expect(resolved.sourceSha256).toBe(body.textSha256)
		expect(body.text.slice(resolved.valueStart, resolved.valueEnd)).toBe('No')
	})
	it('selects a specific occurrence when another field has the same value', () => {
		const selected = resolveModelEvidence([source], {
			...evidence,
			quoteBefore: page.slice(
				0,
				page.indexOf('Baggage allowance   ') + 'Baggage allowance   '.length,
			),
			quoteAfter: page.slice(
				page.indexOf('Baggage allowance   ') + 'Baggage allowance   0'.length,
			),
		})
		expect(selected.valueStart).toBe(
			text.indexOf('Baggage allowance   0') + 'Baggage allowance   '.length,
		)
	})
	it('rejects model-supplied offsets/hashes and empty literals at the wire boundary', () => {
		for(const extra of [
			{ quoteStart: 3274 },
			{ sourceSha256: source.textSha256 },
			{ valueText: '' },
		]) {
			expect(
				modelEvidenceSchema.safeParse({ ...evidence, ...extra }).success,
			).toBe(false)
		}
	})
})
