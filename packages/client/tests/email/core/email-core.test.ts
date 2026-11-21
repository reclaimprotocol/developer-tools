/* eslint-disable @stylistic/max-len -- ported from the email core's test suite; kept close to upstream so the two can be compared */
import {
	approveWithResolver,
	copyApprovedRawEmail,
	EmailApprovalError,
	inspectApprovedEmail,
	projectApprovedEmail,
	releaseApprovedEmail,
} from '../../../src/email/core/approval.ts'
import type {
	ApprovedEmailContent,
	EmailPolicyInput,
} from '../../../src/email/core/contracts.ts'
import {
	hashEmailPolicy,
	normalizeEmailPolicy,
} from '../../../src/email/core/policy.ts'
import {
	matchesEmailSender,
	parseEmailSender,
} from '../../../src/email/core/sender.ts'
import {
	completeBody,
	fixtureBinding,
	fixturePolicy,
	fixtureResolver,
	inspectionCases,
	multipart,
	resignTags,
	signCoreEmail,
} from './fixtures/email-core.ts'
import { publicRecord } from './fixtures/signed-email.ts'
import { describe, expect, it } from './vitest-compat.ts'

async function approve(
	raw: Buffer,
	options: Partial<EmailPolicyInput> = {},
	signal = new AbortController().signal,
) {
	const policy = fixturePolicy(options)
	const binding = fixtureBinding(policy)
	const handle = await approveWithResolver(
		raw,
		policy,
		binding,
		signal,
		fixtureResolver,
	)
	return {
		handle,
		binding,
		summary: inspectApprovedEmail(handle, binding),
		input: projectApprovedEmail(handle, binding),
	}
}

describe('immutable sender and policy', () => {
	it('preserves regex source and uses full case-insensitive mailbox matching', () => {
		const sender = 'regex:User[.]Name[+]Tag@EXAMPLE[.]com'
		expect(parseEmailSender(sender).sender).toBe(sender)
		expect(matchesEmailSender(sender, 'user.name+tag@example.com')).toBe(true)
		expect(
			matchesEmailSender('regex:.*@example[.]com', 'a@sub.example.com'),
		).toBe(false)
		expect(
			matchesEmailSender('regex:a[+]b@example[.]com', 'ab@example.com'),
		).toBe(false)
		expect(
			matchesEmailSender(
				'regex:.*@xn--bcher-kva[.]example',
				'a@xn--bcher-kva.example',
			),
		).toBe(true)
	})
	it('copies, normalizes and hashes policy; rejects accessors and unknown options', () => {
		const source = {
			sender: 'regex:.*@EXAMPLE[.]COM',
			allowedDkimSigningDomains: ['regex:example[.]com'],
			params: [
				{
					name: 'income',
					instructions: 'Extract the gross weekly income amount.',
				},
			],
		}
		const policy = normalizeEmailPolicy(source)
		source.params[0].name = 'modified'
		expect(policy.params[0].name).toBe('income')
		expect(policy.allowedDkimSigningDomains).toEqual(['regex:example[.]com'])
		expect(Object.isFrozen(policy.params)).toBe(true)
		expect(hashEmailPolicy(policy)).toMatch(/^[a-f0-9]{64}$/)
		expect(hashEmailPolicy(fixturePolicy())).toBe(
			'02a5ebcad30422ce3cea196b7eb4d2fbd51e4d357bd511240be127bb5b479972',
		)
		expect(() => normalizeEmailPolicy({ ...source, cache: true } as EmailPolicyInput),
		).toThrow()
		let called = false
		expect(() => normalizeEmailPolicy({
			get sender() {
				called = true
				return source.sender
			},
			params: [
				{
					name: 'income',
					instructions: 'Extract the gross weekly income amount.',
				},
			],
		}),
		).toThrow()
		expect(called).toBe(false)
	})
})
describe('DKIM validity and proof eligibility', () => {
	it('passes every required RFC fixture and separately rejects From-only coverage', async() => {
		for(const fixture of await inspectionCases('valid-rfc-variants')) {
			const policy = fixturePolicy(),
				binding = fixtureBinding(policy)
			try {
				const handle = await approveWithResolver(
					fixture.raw,
					policy,
					binding,
					new AbortController().signal,
					fixture.resolver,
				)
				expect(fixture.error, fixture.name).toBeUndefined()
				expect(
					inspectApprovedEmail(handle, binding).dkim.some(
						(d) => d.result === 'pass',
					),
					fixture.name,
				).toBe(true)
				releaseApprovedEmail(handle)
			} catch(error) {
				expect(error, fixture.name).toBeInstanceOf(EmailApprovalError)
				expect((error as EmailApprovalError).code, fixture.name).toBe(
					fixture.error,
				)
				expect(fixture.error, fixture.name).toBeDefined()
			}
		}
	}, 180_000)
	it.each(['partial-body-signature', 'tampered-message'])(
		'rejects %s for the right reason',
		async(name) => {
			for(const fixture of await inspectionCases(name)) {
				try {
					await approve(fixture.raw)
					throw new Error('unexpected approval')
				} catch(error) {
					expect(error).toBeInstanceOf(EmailApprovalError)
					expect((error as EmailApprovalError).code).toBe(fixture.error)
					expect(
						(error as EmailApprovalError).dkim.some((s) => s.result === 'pass'),
					).toBe(fixture.dkimPass)
				}
			}
		},
	)
	it('cannot import altered unsigned recipient/date or interpretation headers', async() => {
		const raw = await signCoreEmail({
			headerList: [
				'from',
				'content-type',
				'content-transfer-encoding',
				'mime-version',
			],
		})
		for(const change of [
			(text: string) => text.replace('alice@example.net', 'attacker@example.net'),
			(text: string) => text.replace('19 Oct 2026', '20 Oct 2026'),
		]) {
			await expect(
				approve(Buffer.from(change(raw.toString()))),
			).rejects.toMatchObject({
				code: 'PROOF_METADATA_NOT_AUTHENTICATED',
				dkim: [{ result: 'pass' }],
			})
		}

		await expect(
			approve(await signCoreEmail({ headerList: ['from', 'to', 'date'] })),
		).rejects.toMatchObject({
			code: 'PROOF_CONTENT_NOT_AUTHENTICATED',
			dkim: [{ result: 'pass' }],
		})
	})
	it('enforces recipient, sender, exact signer, requested dates and testing-key policy', async() => {
		const raw = await signCoreEmail()
		for(const [options, code] of [
			[{ sender: 'regex:other@example[.]com' }, 'SENDER_NOT_ACCEPTED'],
			[
				{ allowedDkimSigningDomains: ['regex:sibling[.]example[.]com'] },
				'SIGNER_NOT_ACCEPTED',
			],
			[{ expectedRecipient: 'other@example.net' }, 'RECIPIENT_NOT_ACCEPTED'],
			[{ minEmailDateS: 1_800_000_000 }, 'EMAIL_DATE_NOT_ACCEPTED'],
		] as const) {
			await expect(approve(raw, options)).rejects.toMatchObject({
				code,
				dkim: [{ result: 'pass' }],
			})
		}

		const policy = fixturePolicy(),
			binding = fixtureBinding(policy)
		await expect(
			approveWithResolver(
				raw,
				policy,
				binding,
				new AbortController().signal,
				async() => [[publicRecord + '; t=y']],
			),
		).rejects.toMatchObject({
			code: 'PROOF_TESTING_KEY',
			dkim: [{ result: 'pass', testing: true }],
		})
		await expect(
			approve(await signCoreEmail({ date: '19 Oct 2026 10:00:60 +0000' })),
		).rejects.toMatchObject({ code: 'EMAIL_DATE_UNSUPPORTED' })
	})
	it('binds the exact usable signature when an altered duplicate precedes it', async() => {
		const raw = await signCoreEmail()
		const end = raw.indexOf('\r\nFrom:')
		const altered = raw.subarray(0, end).toString().replace(/\bh=/, 'l=0; h=')
		const { handle, summary } = await approve(
			Buffer.concat([Buffer.from(altered + '\r\n'), raw]),
		)
		expect(summary.dkim.map((d) => d.result)).toEqual(['fail', 'pass'])
		expect(summary.signature.headerIndex).toBe(1)
		releaseApprovedEmail(handle)
	})
	it('accepts unknown signature tags and key flags without adding policy rejection', async() => {
		const raw = resignTags(await signCoreEmail(), (line) => line.replace('v=1;', 'v=1; X_unknown=value;'),
		)
		const policy = fixturePolicy(),
			binding = fixtureBinding(policy)
		const handle = await approveWithResolver(
			raw,
			policy,
			binding,
			new AbortController().signal,
			async() => [[publicRecord + '; t=unknown']],
		)
		releaseApprovedEmail(handle)
	})
	it('does not combine signature coverage and requires RFC From signing and current DNS keys', async() => {
		const first = await signCoreEmail({
			headerList: ['from', 'to', 'content-type', 'content-transfer-encoding'],
		})
		const second = await signCoreEmail({
			headerList: ['from', 'date', 'content-type', 'content-transfer-encoding'],
		})
		const combined = Buffer.concat([
			first.subarray(0, first.indexOf('\r\nFrom:') + 2),
			second,
		])
		await expect(approve(combined)).rejects.toMatchObject({
			code: 'PROOF_METADATA_NOT_AUTHENTICATED',
			dkim: [{ result: 'pass' }, { result: 'pass' }],
		})
		const raw = await signCoreEmail()
		await expect(
			approve(
				resignTags(raw, (line) => line.replace(
					/\bh=([^;]*)/,
					(_match, fields: string) => 'h=' +
							fields
								.split(':')
								.filter((field) => field.trim().toLowerCase() !== 'from')
								.join(':'),
				),
				),
			),
		).rejects.toMatchObject({ code: 'DKIM_VERIFICATION_FAILED' })
		const policy = fixturePolicy(),
			binding = fixtureBinding(policy)
		await expect(
			approveWithResolver(
				raw,
				policy,
				binding,
				new AbortController().signal,
				async() => [['v=DKIM1; p=']],
			),
		).rejects.toMatchObject({ code: 'DKIM_VERIFICATION_FAILED' })
	})
	it('allows an explicitly delegated signing domain without organizational alignment', async() => {
		const raw = await signCoreEmail({ domain: 'delegated.example.org' })
		const policy = fixturePolicy({
				allowedDkimSigningDomains: ['regex:delegated[.]example[.]org'],
			}),
			binding = fixtureBinding(policy)
		const handle = await approveWithResolver(
			raw,
			policy,
			binding,
			new AbortController().signal,
			async() => [[publicRecord]],
		)
		expect(inspectApprovedEmail(handle, binding).signature.signingDomain).toBe(
			'delegated.example.org',
		)
		releaseApprovedEmail(handle)
	})
})
describe('complete immutable source approval', () => {
	it('includes both alternatives and every attachment, with repeatable hashes and PDF ranges', async() => {
		const raw = await signCoreEmail({
			contentType: 'multipart/mixed; boundary="synthetic"',
			body: completeBody(),
		})
		const first = await approve(raw),
			second = await approve(raw)
		expect(first.input).toEqual(second.input)
		// Baseline captured before the upstream-tooling follow-up. No text-version drift.
		expect(first.input.sources.map((s) => s.textSha256)).toEqual([
			'74f637a6bf64bc9fcf80a4bd641372e5d6f4571978376926a3375a6d6ee71547',
			'20e028026c65b46c41d5917e61c731e2fbfeb9da3303638959e8ea3d5104aecc',
			'63327bc377487f0def99d55bcc62e9643632b2b051ac7d0d34af106b48c25476',
			'91ed7f35dafa6e7ee871f391bda863db3e43d536975318b49be1b55fad4f6a3a',
			'fddce12d90be6559a1ca2a67fbb69a9aad1b98e143cc18738206719c66ab88c4',
			'3613ae6997f5fe38c72f6c65106d5c28413c0ab86f9a48cfaf7484a714ac1b21',
		])
		expect(first.input.sources.map((s) => s.id)).toEqual([
			'body:0',
			'body:1',
			'attachment:2',
			'attachment:3',
			'attachment:4',
			'attachment:5',
		])
		expect(first.input.sources[1].text).toContain('correction')
		expect(first.input.sources[2].pageRanges?.[0]).toMatchObject({
			page: 1,
			start: 0,
		})
		expect(Object.keys(first.input)).toEqual([
			'params',
			'instructions',
			'contentScope',
			'sources',
		])
		releaseApprovedEmail(first.handle)
		releaseApprovedEmail(second.handle)
	}, 60_000)
	it('permits attachment-only mail and explicit scope; does not change MIME-order indices', async() => {
		const raw = await signCoreEmail({
			contentType: 'multipart/mixed; boundary="synthetic"',
			body: multipart([
				{ type: 'text/plain; charset=utf-8', text: '' },
				{
					type: 'text/plain; charset=utf-8',
					name: 'synthetic.txt',
					text: 'Synthetic income 1234',
				},
			]),
		})
		const result = await approve(raw)
		expect(result.input.sources.map((s) => s.id)).toEqual(['attachment:1'])
		expect(result.summary.inventory[0].empty).toBe(true)
		releaseApprovedEmail(result.handle)
		await expect(
			approve(raw, { contentScope: 'body-only' }),
		).rejects.toMatchObject({ code: 'NO_USABLE_CONTENT' })
		const [image] = await inspectionCases('unreadable-attachment')
		const scoped = await approve(image.raw, { contentScope: 'body-only' })
		expect(scoped.summary.inventory[1].inScope).toBe(false)
		releaseApprovedEmail(scoped.handle)
	}, 60_000)
	it('uses canonical evidence so unsigned relaxed whitespace cannot change values', async() => {
		const raw = await signCoreEmail({ body: 'Synthetic income: 1 234  \r\n' })
		const changed = Buffer.from(
			raw.toString().replace('1 234  \r\n', '1\t \t234\t \r\n'),
		)
		const a = await approve(raw),
			b = await approve(changed)
		expect(a.input).toEqual(b.input)
		expect(a.summary.rawEmailSha256).not.toBe(b.summary.rawEmailSha256)
		releaseApprovedEmail(a.handle)
		releaseApprovedEmail(b.handle)
	})
	it('removes exactly one leading BOM across decoding, extraction and approval', async() => {
		const result = await approve(
			await signCoreEmail({ body: '\uFEFF\uFEFFSynthetic\r\nvalue\r\n' }),
		)
		expect(result.input.sources[0].text).toBe('\uFEFFSynthetic\nvalue\n')
		releaseApprovedEmail(result.handle)
	})
	it('owns the raw buffer before DNS awaits and rejects forged, stale, expired and cancelled handles', async() => {
		const raw = await signCoreEmail()
		const original = Buffer.from(raw)
		const policy = fixturePolicy(),
			binding = fixtureBinding(policy),
			control = new AbortController()
		const pending = approveWithResolver(
			raw,
			policy,
			binding,
			control.signal,
			async(name, type) => {
				raw.fill(0)
				return fixtureResolver(name, type)
			},
		)
		const handle = await pending
		expect(copyApprovedRawEmail(handle, binding)).toEqual(original)
		const copy = copyApprovedRawEmail(handle, binding)
		copy.fill(0)
		expect(copyApprovedRawEmail(handle, binding)).toEqual(original)
		expect(() => projectApprovedEmail(
			{ approved: true } as unknown as ApprovedEmailContent,
			binding,
		),
		).toThrow('INVALID_APPROVAL_HANDLE')
		for(const key of [
			'requestHash',
			'accountAddress',
			'attemptId',
			'messageId',
		] as const) {
			expect(() => projectApprovedEmail(handle, { ...binding, [key]: 'changed' }),
			).toThrow('STALE_EMAIL_APPROVAL')
		}

		expect(() => projectApprovedEmail(handle, { ...binding, expiresAt: Date.now() - 1 }),
		).toThrow('STALE_EMAIL_APPROVAL')
		expect(() => {
			;(
				projectApprovedEmail(handle, binding).sources[0] as { text: string }
			).text = 'changed'
		}).toThrow()
		control.abort()
		expect(() => projectApprovedEmail(handle, binding)).toThrow(
			'INVALID_APPROVAL_HANDLE',
		)
	})
	it('rejects ambiguous parameters, malformed encoding, excess files and unsupported charset', async() => {
		for(const options of [
			{ contentType: 'text/plain; charset=utf-8; charset=ascii' },
			{ transferEncoding: 'base64', body: 'bad$base64' },
			{ contentType: 'text/plain; charset=made-up', body: 'Synthetic' },
		]) {
			await expect(
				approve(await signCoreEmail(options)),
			).rejects.toBeInstanceOf(EmailApprovalError)
		}

		await expect(
			approve(
				await signCoreEmail({
					contentType: 'multipart/mixed; boundary="synthetic"',
					body: multipart(
						Array.from({ length: 21 }, (_, i) => ({
							type: 'text/plain',
							name: `part-${i}.txt`,
							text: 'Synthetic',
						})),
					),
				}),
			),
		).rejects.toMatchObject({ code: 'EMAIL_ATTACHMENT_LIMIT' })
		await expect(
			approve(Buffer.alloc(8 * 1024 * 1024 + 1)),
		).rejects.toMatchObject({ code: 'MESSAGE_SIZE' })
	})
	it('cancels while DNS is pending without creating an approval', async() => {
		const controller = new AbortController(),
			policy = fixturePolicy(),
			binding = fixtureBinding(policy)
		let started!: () => void
		const lookupStarted = new Promise<void>((resolve) => {
			started = resolve
		})
		let complete!: (value: string[][]) => void
		const pending = approveWithResolver(
			await signCoreEmail(),
			policy,
			binding,
			controller.signal,
			() => {
				started()
				return new Promise((resolve) => {
					complete = resolve
				})
			},
		)
		await lookupStarted
		controller.abort()
		await expect(pending).rejects.toMatchObject({
			code: 'EMAIL_APPROVAL_CANCELLED',
		})
		complete([[publicRecord]])
	})
})
