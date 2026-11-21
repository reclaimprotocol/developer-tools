/* eslint-disable @stylistic/max-len -- ported from the email core's test suite; kept close to upstream so the two can be compared */
import {
	EMAIL_PROMPT_VERSION,
	EmailAiProvider,
	type EmailModelRequest,
} from '../../../src/email/core/ai.ts'
import {
	inspectCheckedEmail,
	transformEmailValue,
} from '../../../src/email/core/ai-check.ts'
import {
	EMAIL_CURRENCY_TRANSFORM_DESCRIPTION
} from '../../../src/email/core/ai-currency.ts'
import {
	approveWithResolver,
	projectApprovedEmail,
	releaseApprovedEmail,
} from '../../../src/email/core/approval.ts'
import type { EmailCheckEvent } from '../../../src/email/core/check-events.ts'
import { pdfDocument } from './fixtures/documents.ts'
import {
	fixtureBinding,
	fixturePolicy,
	fixtureResolver,
	multipart,
	signCoreEmail,
} from './fixtures/email-core.ts'
import { expect, it, vi } from './vitest-compat.ts'

it.each([
	['USD', 'USD'],
	['usd', 'USD'],
	['US$', 'USD'],
	['U.S. dollars', 'USD'],
	['United States dollar', 'USD'],
	['€', 'EUR'],
	['eur', 'EUR'],
	['Euro', 'EUR'],
	['EUROS', 'EUR'],
	['GBP', 'GBP'],
	['British pounds', 'GBP'],
	['pound sterling', 'GBP'],
	['sterling', 'GBP'],
	['\u00a0British\u202fpounds\u00a0', 'GBP'],
	['CHF', 'CHF'],
	['Swiss francs', 'CHF'],
	['Canadian dollars', 'CAD'],
	['CA$', 'CAD'],
	['AUD', 'AUD'],
	['Australian dollars', 'AUD'],
	['AU$', 'AUD'],
	['NZ$', 'NZD'],
	['Singapore dollars', 'SGD'],
	['HK$', 'HKD'],
	['Japanese yen', 'JPY'],
	['JP¥', 'JPY'],
	['RMB', 'CNY'],
	['Chinese yuan', 'CNY'],
	['₹', 'INR'],
	['Indian rupees', 'INR'],
	['Swedish kronor', 'SEK'],
	['Norwegian kroner', 'NOK'],
	['Danish kroner', 'DKK'],
])('normalizes currency identity %s to %s', (literal, code) => {
	expect(transformEmailValue(literal, 'currency-code')).toBe(code)
})
it.each([
	['£1,234.50', '1234.5'],
	['GBP 1,234.500', '1234.5'],
	['1,234.50 British pounds', '1234.5'],
	['EUROS 1,234.50', '1234.5'],
	['1,234.50 euro', '1234.5'],
	['1,234.50\u00a0EUR', '1234.5'],
	['CHF\u202f1,234.50', '1234.5'],
	['1,234.50 Swiss francs', '1234.5'],
	['US$12', '12'],
	['$12 USD', '12'],
	['£12 GBP', '12'],
	['EUR 12 euros', '12'],
	['AUD 12', '12'],
	['12 Australian dollars', '12'],
	['CA$12', '12'],
	['$12 CAD', '12'],
	['¥12 CNY', '12'],
	['12 dollars', '12'],
	['Rs.12', '12'],
	['kr 12 NOK', '12'],
	['-£0012.50', '-12.5'],
	['£-12.50', '-12.5'],
	['-12 GBP', '-12'],
	['-USD 0.00', '0'],
	[' USD 9,007,199,254,740,993.0100 ', '9007199254740993.01'],
	['12', '12'],
])(
	'normalizes amount %s exactly without currency conversion',
	(literal, amount) => {
		expect(transformEmailValue(literal, 'currency')).toBe(amount)
	},
)
it.each([
	'£',
	'C$',
	'$',
	'dollar',
	'dollars',
	'¥',
	'kr',
	'Fr',
	'francs',
	'Rs.',
	'rupees',
	'pounds',
])('does not guess an identity for %s', (literal) => {
	expect(() => transformEmailValue(literal, 'currency-code')).toThrow(
		expect.objectContaining({ detail: 'CURRENCY_AMBIGUOUS' }),
	)
})
it.each(['AUD 12 USD', '£12 EUR', 'US$12 CAD', '€12 dollars', '¥12 GBP'])(
	'rejects conflicting markers: %s',
	(literal) => {
		expect(() => transformEmailValue(literal, 'currency')).toThrow(
			expect.objectContaining({ detail: 'CURRENCY_MARKER_CONFLICT' }),
		)
	},
)
it.each([
	'USD 1,23',
	'EUR 12,50',
	'EUR 1.234,50',
	'GBP 1 234.50',
	'USD 1e3',
	'USD +12',
	'-USD -12',
	'$£12',
	'USD 12 plus tax',
	'12 USD/GBP',
	'USDT 12',
])('rejects unsupported or misleading amount syntax: %s', (literal) => {
	expect(() => transformEmailValue(literal, 'currency')).toThrow(
		'EMAIL_AI_INVALID_EVIDENCE',
	)
})
it.each([
	'USDT',
	'USDC',
	'credits',
	'British',
	'12 USD',
	'CAD/USD',
	'USDollars',
])('rejects unsupported currency identity %s', (literal) => {
	expect(() => transformEmailValue(literal, 'currency-code')).toThrow(
		expect.objectContaining({ detail: 'CURRENCY_LITERAL_UNSUPPORTED' }),
	)
})

async function checkCurrency(
	sourceText: string,
	fields: Record<
		string,
		{ literal: string, value: string, transform: 'currency' | 'currency-code' }
	>,
	pdf = false,
) {
	const policy = fixturePolicy({
		params: Object.entries(fields).map(([name, field]) => ({
			name,
			instructions:
				field.transform === 'currency'
					? 'Find the total rental amount.'
					: 'Find the currency of the total rental amount.',
		})),
	})
	const binding = fixtureBinding(policy),
		signal = new AbortController().signal
	const raw = await signCoreEmail(
		pdf
			? {
				contentType: 'multipart/mixed; boundary="synthetic"',
				body: multipart([
					{ type: 'text/plain', text: 'Your rental receipt is attached.' },
					{
						type: 'application/pdf',
						name: 'receipt.pdf',
						encoding: 'base64',
						bytes: pdfDocument(sourceText),
					},
				]),
			}
			: { body: sourceText },
	)
	const approved = await approveWithResolver(
		raw,
		policy,
		binding,
		signal,
		fixtureResolver,
	)
	const input = projectApprovedEmail(approved, binding),
		source = input.sources.find(
			(s) => s.kind === (pdf ? 'attachment' : 'body'),
		)!
	const events: Readonly<EmailCheckEvent>[] = []
	const proposal = Object.fromEntries(
		Object.entries(fields).map(([name, field]) => {
			const at = source.text.indexOf(field.literal)
			expect(at).toBeGreaterThanOrEqual(0)
			return [
				name,
				{
					value: field.value,
					evidence: {
						sourceId: source.id,
						page: pdf ? 1 : null,
						quoteBefore: source.text.slice(0, at),
						valueText: field.literal,
						quoteAfter: source.text.slice(at + field.literal.length),
						transform: field.transform,
					},
				},
			]
		}),
	)
	const complete = vi.fn(async(request: EmailModelRequest) => {
		expect(request.systemPrompt).toContain(EMAIL_CURRENCY_TRANSFORM_DESCRIPTION)
		expect(JSON.stringify(request.responseJsonSchema)).toContain(
			'currency-code',
		)
		return JSON.stringify({
			result: {
				outcome: 'pass',
				reviewedSourceIds: input.sources.map((s) => s.id),
				fields: proposal,
			},
		})
	})
	const provider = new EmailAiProvider({
		identity: { provider: 'Synthetic', model: 'test', contextTokens: 1050000 },
		complete,
	})
	try {
		const checked = await provider.check(
			approved,
			binding,
			signal,
			async() => {},
			provider.describe(),
			(e) => events.push(e),
		)
		const result = inspectCheckedEmail(checked, binding)
		expect(result.analysis.promptVersion).toBe(EMAIL_PROMPT_VERSION)
		return { result, events }
	} catch(error) {
		return { error, events }
	} finally {
		releaseApprovedEmail(approved)
	}
}

it.each([false, true])(
	'verifies amount and currency from the same signed evidence (PDF=%s)',
	async(pdf) => {
		const { result, error } = await checkCurrency(
			'Rental total: 123.50 British pounds.',
			{
				serviceA: {
					literal: '123.50 British pounds',
					value: '123.5',
					transform: 'currency',
				},
				serviceB: {
					literal: 'British pounds',
					value: 'GBP',
					transform: 'currency-code',
				},
			},
			pdf,
		)
		expect(error).toBeUndefined()
		expect(result!.fields.serviceA.value).toBe('123.5')
		expect(result!.fields.serviceB.value).toBe('GBP')
	},
)
it('allows spacing around the selected literal without mistaking surrounding words for part of its token', async() => {
	const { error } = await checkCurrency('Rental total USD 123.50 due.', {
		serviceA: {
			literal: ' USD 123.50 ',
			value: '123.5',
			transform: 'currency',
		},
		serviceB: { literal: ' USD ', value: 'USD', transform: 'currency-code' },
	})
	expect(error).toBeUndefined()
})
it.each([
	['Rental total: $12.', '$', 'USD', 'currency-code', 'CURRENCY_AMBIGUOUS'],
	[
		'Rental total: USDT 12.',
		'USD',
		'USD',
		'currency-code',
		'CURRENCY_TOKEN_BOUNDARY',
	],
	[
		'Rental total: 312 GBP.',
		'12 GBP',
		'12',
		'currency',
		'CURRENCY_TOKEN_BOUNDARY',
	],
	['Rental total: US$12.', '$12', '12', 'currency', 'CURRENCY_TOKEN_BOUNDARY'],
	[
		'Rental total: -USD12.',
		'USD12',
		'12',
		'currency',
		'CURRENCY_TOKEN_BOUNDARY',
	],
	['Rental total: EUR 12.', 'EUR', 'USD', 'currency-code', 'VALUE_MISMATCH'],
	[
		'Rental total: 12 British pounds.',
		'12 British pounds',
		'15',
		'currency',
		'VALUE_MISMATCH',
	],
	[
		'Rental total: £12 EUR.',
		'£12 EUR',
		'12',
		'currency',
		'CURRENCY_MARKER_CONFLICT',
	],
] as const)(
	'rejects invented conversions and partial evidence: %s',
	async(text, literal, value, transform, check) => {
		const { result, error, events } = await checkCurrency(text, {
			serviceA: { literal, value, transform },
		})
		expect(result).toBeUndefined()
		expect(error).toMatchObject({
			code: 'EMAIL_AI_INVALID_EVIDENCE',
			detail: check,
		})
		expect(events).toContainEqual(
			expect.objectContaining({
				step: 'evidence_validation',
				status: 'failed',
				details: { field: 'serviceA', transform, check },
			}),
		)
	},
)
