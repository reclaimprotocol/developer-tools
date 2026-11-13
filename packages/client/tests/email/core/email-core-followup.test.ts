/* eslint-disable @stylistic/max-len -- ported from the email core's test suite; kept close to upstream so the two can be compared */
import type {
	EmailPolicyInput,
	TrustedEmailBinding,
} from '../../../src/email/core/contracts.ts'
import {
	extractSourceText,
	validateDocumentResults,
} from '../../../src/email/core/documents.ts'
import {
	copyBinding,
	copyNormalizedPolicy,
	normalizeEmailPolicy,
} from '../../../src/email/core/policy.ts'
import { fixtureBinding, fixturePolicy } from './fixtures/email-core.ts'
import {
	canonicalInspection,
	xmlChunkInspection,
	xmlFixtures,
} from './fixtures/email-followup.ts'
import { expect, it } from './vitest-compat.ts'

it('matches JCS reference serializations/hashes and rejects invalid plain data before invoking accessors', () => {
	expect(
		canonicalInspection().filter((r) => r.outcome === 'matched-reference'),
	).toHaveLength(28)
})
it('strict schemas reject coercion, unknown keys, invalid versions, bounds and malformed bindings', () => {
	const policy = fixturePolicy()
	for(const change of [
		{
			params: [
				{
					name: 'income',
					instructions: 'Extract the gross weekly income amount.',
					isOptional: 'false',
				},
			],
		},
		{ sender: 12 },
		{ contentScope: 'all' },
		{
			params: [
				{
					name: 'income',
					instructions: 'Extract the gross weekly income amount.',
				},
				{
					name: 'income',
					instructions: 'Extract the gross weekly income amount.',
				},
			],
		},
		{
			params: [
				{
					name: 'income',
					instructions: 'Extract the gross weekly income amount.',
					isOptional: true,
				},
			],
		},
		{ minEmailDateS: '1234' },
		{ minEmailDateS: 20, maxEmailDateS: 10 },
		{ unknown: true },
	]) {
		expect(() => normalizeEmailPolicy({
			sender: policy.sender,
			params: [
				{
					name: 'income',
					instructions: 'Extract the gross weekly income amount.',
				},
			],
			...change,
		} as EmailPolicyInput),
		).toThrow()
	}

	expect(() => copyNormalizedPolicy({
		...policy,
		version: 'future',
	} as unknown as typeof policy),
	).toThrow()
	for(const change of [
		{ requestHash: 123 },
		{ expiresAt: String(Date.now() + 10000) },
		{ unknown: true },
		{ expiresAt: Number.MAX_VALUE },
	]) {
		expect(() => copyBinding(
			{ ...fixtureBinding(), ...change } as TrustedEmailBinding,
			policy,
		),
		).toThrow()
	}

	let called = false
	const binding = {
		...fixtureBinding(),
		get accountAddress() {
			called = true
			return 'alice@example.net'
		},
	}
	expect(() => copyBinding(binding, policy)).toThrow()
	expect(called).toBe(false)
})
it('validates worker output schema, identity, complete coverage and PDF page ranges', () => {
	const input = [{ id: 'body:0', filename: 'synthetic' }]
	const valid = { ...input[0], status: 'ok', format: 'txt', text: 'synthetic' }
	expect(validateDocumentResults([valid], input)[0].text).toBe('synthetic')
	for(const value of [
		[],
		[valid, valid],
		[{ ...valid, arbitrary: true }],
		[{ ...valid, text: 123 }],
		[{ ...valid, id: 'body:1' }],
		[{ ...valid, filename: 'swapped' }],
		[{ ...valid, text: 'x'.repeat(100001) }],
		[{ ...valid, text: '\ud800' }],
		[{ ...valid, format: 'pdf' }],
		[{ ...valid, format: 'pdf', pageRanges: [{ page: 1, start: 0, end: 5 }] }],
		[{ ...valid, status: 'error', code: 'SECRET_DATA', stage: 'text' }],
	]) {
		expect(() => validateDocumentResults(value, input)).toThrow()
	}

	let called = false
	expect(() => validateDocumentResults(
		[
			{
				...valid,
				get text() {
					called = true
					return 'synthetic'
				},
			},
		],
		input,
	),
	).toThrow()
	expect(called).toBe(false)
})
it('structural XML guards handle UTF-16, namespace events, declarations and actual limits through the isolated worker', async() => {
	const fixtures = xmlFixtures()
	const results = await extractSourceText(
		fixtures.map((f) => f.input),
		new AbortController().signal,
	)
	for(const [index, fixture] of fixtures.entries()) {
		const output = results[index]
		expect(output.error ?? output.formatError, fixture.name).toBe(fixture.error)
		if(!fixture.error) {
			expect(output.text, fixture.name).toBeTruthy()
		}

		if(fixture.text) {
			expect(output.text, fixture.name).toBe(fixture.text)
		}
	}
})
it.each([1, 2, 3, 7, 1024])(
	'SAX decoding and cell counts survive %i-byte boundaries and the final chunk',
	(size) => {
		expect(xmlChunkInspection(size)).toHaveLength(6)
	},
)
