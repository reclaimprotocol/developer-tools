/* eslint-disable @stylistic/max-len, @typescript-eslint/no-explicit-any -- ported from the email core's test suite; kept close to upstream so the two can be compared */
import {
	inspectCheckedEmail,
	transformEmailValue,
	validateAiContentCheck,
} from '../../../src/email/core/ai-check.ts'
import {
	approveWithResolver,
	inspectApprovedEmail,
	projectApprovedEmail,
	releaseApprovedEmail,
} from '../../../src/email/core/approval.ts'
import type {
	AiContentCheckResult,
	ApprovedEmailContent,
	CheckedEmailResult,
} from '../../../src/email/core/contracts.ts'
import { canonicalJson, sha256 } from '../../../src/email/core/policy.ts'
import { pdfDocument } from './fixtures/documents.ts'
import {
	fixtureBinding,
	fixturePolicy,
	fixtureResolver,
	multipart,
	signCoreEmail,
} from './fixtures/email-core.ts'
import {
	emailValueVectors,
	invalidEmailValueVectors,
} from './fixtures/email-values.ts'
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it
} from './vitest-compat.ts'

describe('deterministic email evidence validation', () => {
	const policy = fixturePolicy({
		params: [
			{
				name: 'income',
				instructions: 'Extract the gross weekly income amount.',
			},
			{
				name: 'reference',
				instructions: 'Find the reference identifier.',
				isOptional: true,
			},
		],
	})
	const binding = fixtureBinding(policy)
	let approved: ApprovedEmailContent
	beforeAll(async() => {
		approved = await approveWithResolver(
			await signCoreEmail({
				contentType: 'multipart/mixed; boundary="synthetic"',
				body: multipart([
					{
						type: 'text/plain; charset=utf-8',
						text: 'Synthetic weekly income: USD 1,234.50.',
					},
					{
						type: 'text/plain; charset=utf-8',
						name: 'reference.txt',
						text: 'Reference: ABC123.',
					},
				]),
			}),
			policy,
			binding,
			new AbortController().signal,
			fixtureResolver,
		)
	})
	afterAll(() => releaseApprovedEmail(approved))
	const input = () => projectApprovedEmail(approved, binding)
	const metadata = () => ({
		inputSha256: sha256(canonicalJson(input())),
		model: 'synthetic-model',
		promptVersion: 'email-content-v10' as const,
	})
	function candidate(): Extract<AiContentCheckResult, { outcome: 'pass' }> {
		const source = input().sources[0],
			start = source.text.indexOf('USD')
		return {
			outcome: 'pass',
			reviewedSourceIds: input().sources.map((s) => s.id),
			fields: {
				income: {
					value: '1234.5',
					evidence: {
						sourceId: source.id,
						sourceSha256: source.textSha256,
						quoteStart: 0,
						quoteEnd: source.text.length,
						quote: source.text,
						valueStart: start,
						valueEnd: start + 'USD 1,234.50'.length,
						transform: 'currency',
					},
				},
			},
		}
	}

	it('freezes checked values, full manifest and actual input digest; omits missing optional fields', () => {
		const proposal = candidate()
		const handle = validateAiContentCheck(
			approved,
			binding,
			proposal,
			metadata(),
		)
		proposal.fields.income.value = '999'
		const result = inspectCheckedEmail(handle, binding)
		expect(result.fields.income.value).toBe('1234.5')
		expect(result.omittedOptional).toEqual(['reference'])
		expect(result.sourceManifest).toEqual(
			inspectApprovedEmail(approved, binding).sourceManifest,
		)
		expect(Object.isFrozen(result.fields.income.evidence)).toBe(true)
	})
	it('records namespaced agent model IDs without relaxing evidence validation', () => {
		for(const model of [
			'gpt-6-luna',
			'anthropic/claude-sonnet-5',
			'vendor/model:version',
		]) {
			const checked = validateAiContentCheck(approved, binding, candidate(), {
				...metadata(),
				model,
			})
			expect(inspectCheckedEmail(checked, binding).analysis.model).toBe(model)
		}

		for(const model of [
			'model?key=secret',
			'model\nprivate',
			'x'.repeat(129),
		]) {
			expect(() => validateAiContentCheck(approved, binding, candidate(), {
				...metadata(),
				model,
			}),
			).toThrow('EMAIL_AI_INPUT_MISMATCH')
		}
	})
	it.each([
		[
			'missing required',
			(c: any) => {
				delete c.fields.income
			},
		],
		[
			'invented value',
			(c: any) => {
				c.fields.income.value = '999'
			},
		],
		[
			'unexpected field',
			(c: any) => {
				c.fields.admin = c.fields.income
			},
		],
		[
			'wrong digest',
			(c: any) => {
				c.fields.income.evidence.sourceSha256 = 'b'.repeat(64)
			},
		],
		[
			'invented quote',
			(c: any) => {
				c.fields.income.evidence.quote = 'USD 1,234.50'
			},
		],
		[
			'outside quote',
			(c: any) => {
				c.fields.income.evidence.quoteStart = 25
			},
		],
		[
			'fractional offset',
			(c: any) => {
				c.fields.income.evidence.valueStart = 0.5
			},
		],
		[
			'extra key',
			(c: any) => {
				c.authorized = true
			},
		],
		[
			'unsupported transform',
			(c: any) => {
				c.fields.income.evidence.transform = 'divide'
			},
		],
		[
			'missing source',
			(c: any) => {
				c.reviewedSourceIds.pop()
			},
		],
		[
			'duplicate source',
			(c: any) => {
				c.reviewedSourceIds[1] = c.reviewedSourceIds[0]
			},
		],
		[
			'unexpected page',
			(c: any) => {
				c.fields.income.evidence.page = 1
			},
		],
		[
			'unexpected attachment hash',
			(c: any) => {
				c.fields.income.evidence.attachmentSha256 = 'b'.repeat(64)
			},
		],
		[
			'placeholder',
			(c: any) => {
				c.fields.income.value = 'N/A'
			},
		],
		[
			'empty value',
			(c: any) => {
				c.fields.income.value = ''
			},
		],
	])('rejects %s', (_name, change) => {
		const c = candidate()
		change(c)
		expect(() => validateAiContentCheck(approved, binding, c, metadata()),
		).toThrow()
	})
	it('omits optional values with invalid evidence, but rejects malformed optional structure', () => {
		const c = candidate()
		c.fields.reference = { ...c.fields.income, value: 'invented' }
		expect(
			inspectCheckedEmail(
				validateAiContentCheck(approved, binding, c, metadata()),
				binding,
			).omittedOptional,
		).toEqual(['reference'])
		;(c.fields.reference.evidence as any).valueStart = '0'
		expect(() => validateAiContentCheck(approved, binding, c, metadata()),
		).toThrow('EMAIL_AI_INVALID_RESPONSE')
	})
	it('requires byte hashes for attachment evidence', () => {
		const c = candidate(),
			source = input().sources[1]
		const start = source.text.indexOf('ABC123')
		c.fields.reference = {
			value: 'ABC123',
			evidence: {
				sourceId: source.id,
				sourceSha256: source.textSha256,
				attachmentSha256: source.attachmentSha256,
				quoteStart: 0,
				quoteEnd: source.text.length,
				quote: source.text,
				valueStart: start,
				valueEnd: start + 6,
				transform: 'verbatim',
			},
		}
		expect(
			inspectCheckedEmail(
				validateAiContentCheck(approved, binding, c, metadata()),
				binding,
			).fields.reference.value,
		).toBe('ABC123')
		delete c.fields.reference.evidence.attachmentSha256
		expect(
			inspectCheckedEmail(
				validateAiContentCheck(approved, binding, c, metadata()),
				binding,
			).fields.reference,
		).toBeUndefined()
	})
	it('rejects semantic failure, forged handles, stale bindings, changed input digest and getters', () => {
		for(const outcome of ['fail', 'insufficient']) {
			expect(() => validateAiContentCheck(
				approved,
				binding,
				{ outcome, reason: 'conflict' },
				metadata(),
			),
			).toThrow()
		}

		expect(() => validateAiContentCheck(
			{} as ApprovedEmailContent,
			binding,
			candidate(),
			metadata(),
		),
		).toThrow('INVALID_APPROVAL_HANDLE')
		expect(() => inspectCheckedEmail({} as CheckedEmailResult, binding),
		).toThrow('INVALID_CHECKED_EMAIL_HANDLE')
		expect(() => validateAiContentCheck(
			approved,
			{ ...binding, attemptId: 'other' },
			candidate(),
			metadata(),
		),
		).toThrow('STALE_EMAIL_APPROVAL')
		expect(() => validateAiContentCheck(approved, binding, candidate(), {
			...metadata(),
			inputSha256: 'b'.repeat(64),
		}),
		).toThrow('EMAIL_AI_INPUT_MISMATCH')
		let read = false
		expect(() => validateAiContentCheck(
			approved,
			binding,
			{
				get outcome() {
					read = true
					return 'pass'
				},
			},
			metadata(),
		),
		).toThrow()
		expect(read).toBe(false)
	})
	it('invalidates a checked handle when its approval is cancelled', async() => {
		const controller = new AbortController()
		const handle = await approveWithResolver(
			await signCoreEmail(),
			policy,
			binding,
			controller.signal,
			fixtureResolver,
		)
		const source = projectApprovedEmail(handle, binding).sources[0],
			start = source.text.indexOf('1234')
		const result = validateAiContentCheck(
			handle,
			binding,
			{
				outcome: 'pass',
				reviewedSourceIds: [source.id],
				fields: {
					income: {
						value: '1234',
						evidence: {
							sourceId: source.id,
							sourceSha256: source.textSha256,
							quote: source.text,
							quoteStart: 0,
							quoteEnd: source.text.length,
							valueStart: start,
							valueEnd: start + 4,
							transform: 'number',
						},
					},
				},
			},
			{
				...metadata(),
				inputSha256: sha256(
					canonicalJson(projectApprovedEmail(handle, binding)),
				),
			},
		)
		controller.abort()
		expect(() => inspectCheckedEmail(result, binding)).toThrow(
			'INVALID_APPROVAL_HANDLE',
		)
	})
})
it.each(emailValueVectors)(
	'%s normalizes %s exactly',
	(transform, input, expected) => expect(transformEmailValue(input, transform)).toBe(expected),
)
it.each(invalidEmailValueVectors)('%s rejects %s', (transform, input) => expect(() => transformEmailValue(input, transform)).toThrow(),
)

it('requires PDF page evidence within the approved page range', async() => {
	const policy = fixturePolicy(),
		binding = fixtureBinding(policy)
	const controller = new AbortController()
	const approved = await approveWithResolver(
		await signCoreEmail({
			contentType: 'multipart/mixed; boundary="synthetic"',
			body: multipart([
				{
					type: 'application/pdf',
					name: 'income.pdf',
					bytes: pdfDocument('Gross weekly income USD 1234'),
					encoding: 'base64',
				},
			]),
		}),
		policy,
		binding,
		controller.signal,
		fixtureResolver,
	)
	try {
		const input = projectApprovedEmail(approved, binding),
			source = input.sources[0],
			start = source.text.indexOf('1234')
		const candidate = {
			outcome: 'pass',
			reviewedSourceIds: [source.id],
			fields: {
				income: {
					value: '1234',
					evidence: {
						sourceId: source.id,
						sourceSha256: source.textSha256,
						attachmentSha256: source.attachmentSha256,
						quote: source.text,
						quoteStart: 0,
						quoteEnd: source.text.length,
						valueStart: start,
						valueEnd: start + 4,
						page: 1,
						transform: 'number',
					},
				},
			},
		}
		const metadata = {
			inputSha256: sha256(canonicalJson(input)),
			model: 'synthetic-model',
			promptVersion: 'email-content-v10' as const,
		}
		expect(
			inspectCheckedEmail(
				validateAiContentCheck(approved, binding, candidate, metadata),
				binding,
			).fields.income.value,
		).toBe('1234')
		candidate.fields.income.evidence.page = 2
		expect(() => validateAiContentCheck(approved, binding, candidate, metadata),
		).toThrow('EMAIL_AI_INVALID_EVIDENCE')
		delete (candidate.fields.income.evidence as { page?: number }).page
		expect(() => validateAiContentCheck(approved, binding, candidate, metadata),
		).toThrow('EMAIL_AI_INVALID_EVIDENCE')
	} finally {
		controller.abort()
	}
})
