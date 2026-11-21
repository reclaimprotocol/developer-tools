/* eslint-disable @stylistic/max-len, @typescript-eslint/no-explicit-any, unicorn/no-await-expression-member -- ported from the email core's test suite; kept close to upstream so the two can be compared */
import {
	EMAIL_PROMPT_VERSION,
	EmailAiProvider,
	type EmailModelRequest,
	OpenAiEmailClient,
} from '../../../src/email/core/ai.ts'
import {
	inspectCheckedEmail,
	transformEmailValue,
	validateAiContentCheck,
} from '../../../src/email/core/ai-check.ts'
import {
	approveWithResolver,
	projectApprovedEmail,
	releaseApprovedEmail,
} from '../../../src/email/core/approval.ts'
import type { AiContentCheckResult } from '../../../src/email/core/contracts.ts'
import {
	CURRENCY_DATA_METADATA
} from '../../../src/email/core/currency-data.ts'
import { pdfDocument } from './fixtures/documents.ts'
import {
	fixtureBinding,
	fixturePolicy,
	fixtureResolver,
	multipart,
	signCoreEmail,
} from './fixtures/email-core.ts'
import { expect, it, vi } from './vitest-compat.ts'

it.each(CURRENCY_DATA_METADATA.currentCodes)(
	'preserves current ISO currency %s in one price field',
	(code) => {
		expect(transformEmailValue(`${code} 123.50`, 'money')).toBe(`${code} 123.5`)
		expect(transformEmailValue(code.toLowerCase(), 'currency-code')).toBe(code)
	},
)
it('covers the requested regions, including Central America and the Caribbean, with a pinned snapshot', () => {
	const regional =
		`EUR GBP CHF ALL BAM CZK DKK HUF ISK MDL MKD NOK PLN RON RSD RUB SEK TRY UAH
    ARS BOB BRL CLP COP GYD PEN PYG SRD UYU VES VED
    CAD USD MXN BZD CRC GTQ HNL NIO PAB AWG BBD BMD BSD CUP DOP HTG JMD KYD TTD XCD XCG
    AED AFN AMD AZN BDT BHD BND BTN CNY GEL HKD IDR ILS INR IQD IRR JOD JPY KGS KHR KPW KRW KWD KZT
    LAK LBP LKR MMK MNT MOP MVR MYR NPR OMR PHP PKR QAR SAR SGD SYP THB TJS TMT TWD UZS VND YER`.split(
				/\s+/,
			)
	for(const code of regional) {
		expect(CURRENCY_DATA_METADATA.currentCodes).toContain(code)
	}

	expect(CURRENCY_DATA_METADATA.currentCodes).toHaveLength(176)
	expect(CURRENCY_DATA_METADATA.cldrVersion).toBe('48.0.0')
	expect(CURRENCY_DATA_METADATA.currentCodes).not.toContain('XXX')
	expect(CURRENCY_DATA_METADATA.currentCodes).not.toContain('XTS')
})
it.each([
	['GBP 123.50', 'GBP 123.5'],
	['123.50 British pounds', 'GBP 123.5'],
	['123,50 €', 'EUR 123.5'],
	['1.234,50 EUR', 'EUR 1234.5'],
	['EUR 1,234.50', 'EUR 1234.5'],
	['1\u202f234,50 euros', 'EUR 1234.5'],
	['CHF 1’234.50', 'CHF 1234.5'],
	['₹1,23,456.78', 'INR 123456.78'],
	['INR 12,34,56,789.50', 'INR 123456789.5'],
	['AED ١٢٣٫٥٠', 'AED 123.5'],
	['AED ١٬٢٣٤٫٥٠', 'AED 1234.5'],
	['INR १२३.५०', 'INR 123.5'],
	['BDT ১২৩.৫০', 'BDT 123.5'],
	['JPY １２３', 'JPY 123'],
	['THB ๑๒๓.๕๐', 'THB 123.5'],
	['R$ 123,50', 'BRL 123.5'],
	['123.50 Brazilian reais', 'BRL 123.5'],
	['123,50 reais brasileiros', 'BRL 123.5'],
	['123.50 Mexican pesos', 'MXN 123.5'],
	['123.50 Argentine pesos', 'ARS 123.5'],
	['S/ 123.50', 'PEN 123.5'],
	['123.50 renminbi', 'CNY 123.5'],
	['123.50 Ukrainian hryvnias', 'UAH 123.5'],
	['123,50 zł', 'PLN 123.5'],
	['$123.50', '$ 123.5'],
	['£123.50', '£ 123.5'],
	['¥123', '¥ 123'],
	['kr 123,50', 'kr 123.5'],
	['$123.50 MXN', 'MXN 123.5'],
	['£123.50 GBP', 'GBP 123.5'],
	['-BRL 123,50', 'BRL -123.5'],
	['EUR -0,00', 'EUR 0'],
	['KWD 0.123', 'KWD 0.123'],
	['USD 9,007,199,254,740,993.01', 'USD 9007199254740993.01'],
])(
	'normalizes price %s without stripping or converting currency',
	(literal, value) => {
		expect(transformEmailValue(literal, 'money')).toBe(value)
	},
)
it.each([
	['123.50', 'CURRENCY_MISSING'],
	['XXX 12', 'CURRENCY_LITERAL_UNSUPPORTED'],
	['XTS 12', 'CURRENCY_LITERAL_UNSUPPORTED'],
	['12 GBP EUR', 'CURRENCY_LITERAL_UNSUPPORTED'],
	['GBP 12 EUR', 'CURRENCY_MARKER_CONFLICT'],
	['EUR 1,234', 'MONEY_AMOUNT_AMBIGUOUS'],
	['KWD 1.234', 'MONEY_AMOUNT_AMBIGUOUS'],
	['EUR 1,2,3', 'CURRENCY_AMOUNT_INVALID'],
	['USD 1e3', 'CURRENCY_AMOUNT_INVALID'],
	['USD +12', 'CURRENCY_AMOUNT_INVALID'],
	['-USD -12', 'CURRENCY_AMOUNT_INVALID'],
])('rejects unsupported price %s with a precise reason', (literal, detail) => {
	expect(() => transformEmailValue(literal, 'money')).toThrow(
		expect.objectContaining({ detail }),
	)
})
it('keeps explicit unitless and no-currency requests available', () => {
	expect(transformEmailValue('GBP 123.50', 'currency')).toBe('123.5')
	expect(transformEmailValue('123.50', 'number')).toBe('123.5')
	expect(transformEmailValue('EUR 1,234', 'verbatim')).toBe('EUR 1,234')
})

async function checkedPrice(
	options: {
		separate?: boolean
		pdf?: boolean
		inline?: string
		value?: string
		currency?: string
		transform?: string
		changeModel?: (evidence: any) => void
		changeChecked?: (
			candidate: Extract<AiContentCheckResult, { outcome: 'pass' }>,
		) => void
	} = {},
) {
	const policy = fixturePolicy({
		params: [{ name: 'serviceA', instructions: 'gind the price' }],
	})
	const binding = fixtureBinding(policy),
		signal = new AbortController().signal
	const literal = options.inline ?? (options.separate ? '123.50' : 'GBP 123.50')
	const text = `Rental ABC123 price: ${literal}.`
	const currencyText = options.currency ?? 'GBP'
	const currencySourceText = `Rental ABC123 billing currency: ${currencyText}.`
	const raw = await signCoreEmail({
		contentType: 'multipart/mixed; boundary="synthetic"',
		body: multipart([
			{
				type: 'text/plain',
				text: options.pdf ? 'Rental ABC123 receipt attached.' : text,
			},
			...(options.pdf
				? [
					{
						type: 'application/pdf',
						name: 'receipt.pdf',
						bytes: pdfDocument(text),
						encoding: 'base64',
					},
				]
				: []),
			...(options.separate
				? [
					{
						type: 'application/pdf',
						name: 'currency.pdf',
						bytes: pdfDocument(currencySourceText),
						encoding: 'base64',
					},
				]
				: []),
		]),
	})
	const approved = await approveWithResolver(
		raw,
		policy,
		binding,
		signal,
		fixtureResolver,
	)
	try {
		const input = projectApprovedEmail(approved, binding)
		const source = input.sources.find((s) => s.text.includes(text))!
		const evidenceFor = (s: typeof source, value: string) => {
			const at = s.text.indexOf(value)
			expect(at).toBeGreaterThanOrEqual(0)
			return {
				sourceId: s.id,
				page: s.pageRanges ? 1 : null,
				quoteBefore: s.text.slice(0, at),
				valueText: value,
				quoteAfter: s.text.slice(at + value.length),
			}
		}

		const evidence: any = {
			...evidenceFor(source, literal),
			transform: options.transform ?? 'money',
		}
		if(options.separate) {
			evidence.currency = evidenceFor(
				input.sources.find((s) => s.text.includes(currencySourceText))!,
				currencyText,
			)
		}

		options.changeModel?.(evidence)
		const complete = vi.fn(async(request: EmailModelRequest) => {
			expect(JSON.parse(request.taskJson).task.params).toEqual([
				{ name: 'serviceA', instructions: 'gind the price', isOptional: false },
			])
			expect(request.systemPrompt).toContain('default to money')
			expect(request.systemPrompt).toContain('minor typos')
			expect(request.systemPrompt).toContain(
				'no special SDK flags or separate currency field',
			)
			expect(JSON.stringify(request.responseJsonSchema)).toContain('money')
			return JSON.stringify({
				result: {
					outcome: 'pass',
					reviewedSourceIds: input.sources.map((s) => s.id),
					fields: {
						serviceA: { value: options.value ?? 'GBP 123.5', evidence },
					},
				},
			})
		})
		const provider = new EmailAiProvider(
			new OpenAiEmailClient({ apiKey: 'synthetic' }, async(_url, options) => {
				const body = JSON.parse(options!.body as string)
				const text = await complete({
					systemPrompt: body.instructions,
					taskJson: body.input[0].content,
					sourcesJson: body.input[1].content,
					responseJsonSchema: body.text.format.schema,
				})
				return Response.json({
					status: 'completed',
					text: body.text,
					output: [
						{
							type: 'message',
							role: 'assistant',
							status: 'completed',
							content: [{ type: 'output_text', text }],
						},
					],
				})
			}),
		)
		const result = inspectCheckedEmail(
			await provider.check(
				approved,
				binding,
				signal,
				async() => {},
				provider.describe(),
			),
			binding,
		)
		expect(result.analysis.promptVersion).toBe(EMAIL_PROMPT_VERSION)
		if(options.changeChecked) {
			const candidate: Extract<AiContentCheckResult, { outcome: 'pass' }> = {
				outcome: 'pass',
				reviewedSourceIds: input.sources.map((s) => s.id),
				fields: structuredClone(result.fields),
			}
			options.changeChecked(candidate)
			validateAiContentCheck(approved, binding, candidate, result.analysis)
		}

		return result
	} finally {
		releaseApprovedEmail(approved)
	}
}

it.each([false, true])(
	'checks a generic one-field price request with inline currency (PDF=%s)',
	async(pdf) => {
		const result = await checkedPrice({ pdf })
		expect(result.fields.serviceA.value).toBe('GBP 123.5')
	},
)
it.each([false, true])(
	'binds a separately quoted currency label to the same checked price (PDF=%s)',
	async(pdf) => {
		const result = await checkedPrice({ pdf, separate: true })
		expect(result.fields.serviceA.value).toBe('GBP 123.5')
		expect(result.fields.serviceA.evidence.currency).toMatchObject({
			page: 1,
			quote: expect.stringContaining('Rental ABC123 billing currency: GBP'),
			sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
			attachmentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
		})
	},
)
it('preserves an ambiguous symbol instead of inventing USD', async() => {
	expect(
		(await checkedPrice({ inline: '$123.50', value: '$ 123.5' })).fields
			.serviceA.value,
	).toBe('$ 123.5')
	await expect(
		checkedPrice({ inline: '$123.50', value: 'USD 123.5' }),
	).rejects.toMatchObject({ detail: 'VALUE_MISMATCH' })
})
it('does not silently drop the stated currency in a money result', async() => {
	await expect(checkedPrice({ value: '123.5' })).rejects.toMatchObject({
		detail: 'VALUE_MISMATCH',
	})
})
it('rejects a separate currency contradicting the inline unit', async() => {
	await expect(
		checkedPrice({ inline: 'USD 123.50', separate: true }),
	).rejects.toMatchObject({ detail: 'CURRENCY_MARKER_CONFLICT' })
})
it('rejects currency evidence on a non-money transform', async() => {
	await expect(
		checkedPrice({ separate: true, transform: 'number', value: '123.5' }),
	).rejects.toMatchObject({ detail: 'CURRENCY_EVIDENCE_UNEXPECTED' })
})
it.each([
	[
		(e: any) => {
			e.currency.valueText = 'USD'
		},
		'QUOTE_NOT_FOUND',
	],
	[
		(e: any) => {
			e.currency.sourceId = 'attachment:999'
		},
		'SOURCE_NOT_FOUND',
	],
	[
		(e: any) => {
			e.currency.page = 2
		},
		'PAGE_MISMATCH',
	],
] as const)(
	'rejects invented currency evidence during quote resolution',
	async(changeModel, detail) => {
		await expect(
			checkedPrice({ separate: true, changeModel }),
		).rejects.toMatchObject({ detail })
	},
)
it.each([
	[
		(e: any) => {
			e.sourceSha256 = 'a'.repeat(64)
		},
		'HASH_MISMATCH',
	],
	[
		(e: any) => {
			e.attachmentSha256 = 'a'.repeat(64)
		},
		'HASH_MISMATCH',
	],
	[
		(e: any) => {
			e.quote = 'Currency: USD'
		},
		'QUOTE_MISMATCH',
	],
	[
		(e: any) => {
			e.valueEnd = 99999
		},
		'SPAN_OUT_OF_BOUNDS',
	],
	[
		(e: any) => {
			e.page = 2
		},
		'PAGE_MISMATCH',
	],
] as const)(
	'rechecks the nested currency proof rather than trusting AI output',
	async(change, detail) => {
		await expect(
			checkedPrice({
				separate: true,
				changeChecked: (candidate) => change(candidate.fields.serviceA.evidence.currency),
			}),
		).rejects.toMatchObject({ detail })
	},
)
