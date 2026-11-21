/* eslint-disable @stylistic/max-len, unicorn/no-await-expression-member -- ported from the email core's test suite; kept close to upstream so the two can be compared */
import { strToU8, zipSync } from 'fflate'
import { EmailAiProvider } from '../../../src/email/core/ai.ts'
import {
	approveWithResolver,
	copyApprovedRawEmail,
	inspectApprovedEmail,
	projectApprovedEmail,
	releaseApprovedEmail,
} from '../../../src/email/core/approval.ts'
import { extractSourceText } from '../../../src/email/core/documents.ts'
import {
	prepareAttachmentView,
	prepareDisplayAttachment,
	prepareEmailPreview,
	releaseEmailPreview,
} from '../../../src/email/core/preview.ts'
import { docxDocument, pdfDocument } from './fixtures/documents.ts'
import {
	fixtureBinding,
	fixturePolicy,
	fixtureResolver,
	multipart,
	signCoreEmail,
} from './fixtures/email-core.ts'
import { expect, it, vi } from './vitest-compat.ts'

const signal = () => new AbortController().signal
const image = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7l8AAAAASUVORK5CYII=',
	'base64',
)
async function mail(
	files: { type: string, name: string, bytes: Buffer }[] = [
		{ type: 'image/png', name: 'PRIVATE_UNSUPPORTED.png', bytes: image },
	],
) {
	return signCoreEmail({
		contentType: 'multipart/mixed; boundary="synthetic"',
		body: multipart([
			{ type: 'text/plain; charset=utf-8', text: 'Booking baggage count: 2.' },
			...files.map((f) => ({ ...f, encoding: 'base64' as const })),
		]),
	})
}

it.each(['body-only', 'attachments-only', 'body-and-attachments'] as const)(
	'drops unsupported formats after whole-message authentication for %s',
	async(contentScope) => {
		const policy = fixturePolicy({ contentScope }),
			binding = fixtureBinding(policy),
			raw = await mail()
		const handle = await approveWithResolver(
			raw,
			policy,
			binding,
			signal(),
			fixtureResolver,
		)
		try {
			expect(copyApprovedRawEmail(handle, binding)).toEqual(raw)
			expect(inspectApprovedEmail(handle, binding).inventory[1]).toMatchObject({
				id: 'attachment:1',
				exclusionReason: 'ATTACHMENT_FORMAT_UNSUPPORTED',
				filename: 'PRIVATE_UNSUPPORTED.png',
			})
			const input = projectApprovedEmail(handle, binding)
			expect(input.sources.map((s) => s.id)).toEqual(
				contentScope === 'attachments-only' ? [] : ['body:0'],
			)
			const complete = vi.fn(async(request: { sourcesJson: string }) => {
				expect(request.sourcesJson).not.toContain('PRIVATE_UNSUPPORTED')
				expect(request.sourcesJson).not.toContain(image.toString('base64'))
				expect(request.sourcesJson).not.toContain('attachment:1')
				return JSON.stringify({
					result: { outcome: 'insufficient', reason: 'Synthetic test' },
				})
			})
			const provider = new EmailAiProvider({
				identity: {
					provider: 'Synthetic',
					model: 'test',
					contextTokens: 1050000,
				},
				complete,
			})
			await expect(
				provider.check(
					handle,
					binding,
					signal(),
					async() => {},
					provider.describe(),
				),
			).rejects.toThrow(
				contentScope === 'attachments-only'
					? 'NO_USABLE_CONTENT'
					: 'EMAIL_AI_INSUFFICIENT',
			)
			expect(complete).toHaveBeenCalledTimes(
				contentScope === 'attachments-only' ? 0 : 1,
			)
		} finally {
			releaseApprovedEmail(handle)
		}
	},
)
it('authenticates dropped bytes: changing only an unsupported attachment fails DKIM', async() => {
	const raw = await mail(),
		policy = fixturePolicy(),
		binding = fixtureBinding(policy)
	const changed = Buffer.from(
		raw
			.toString()
			.replace(image.toString('base64').slice(0, 12), 'AAAAAAAAAAAA'),
	)
	expect(changed).not.toEqual(raw)
	await expect(
		approveWithResolver(changed, policy, binding, signal(), fixtureResolver),
	).rejects.toMatchObject({
		code: 'DKIM_VERIFICATION_FAILED',
		droppedAttachments: [],
	})
})
it('keeps supported files and original MIME indices when dropping a middle attachment', async() => {
	const raw = await mail([
		{ type: 'image/png', name: 'logo.png', bytes: image },
		{
			type: 'text/plain',
			name: 'booking.txt',
			bytes: Buffer.from('Baggage: 2'),
		},
	])
	const policy = fixturePolicy({ contentScope: 'attachments-only' }),
		binding = fixtureBinding(policy)
	const handle = await approveWithResolver(
		raw,
		policy,
		binding,
		signal(),
		fixtureResolver,
	)
	expect(
		projectApprovedEmail(handle, binding).sources.map((s) => s.id),
	).toEqual(['attachment:2'])
	releaseApprovedEmail(handle)
})
it('does not silently drop corrupted supported files; retains unsupported notices on failure', async() => {
	const raw = await mail([
		{
			type: 'application/pdf',
			name: 'bad.pdf',
			bytes: Buffer.from('invalid PDF'),
		},
		{ type: 'image/png', name: 'logo.png', bytes: image },
	])
	const policy = fixturePolicy(),
		binding = fixtureBinding(policy)
	await expect(
		approveWithResolver(raw, policy, binding, signal(), fixtureResolver),
	).rejects.toMatchObject({
		code: 'CONTENT_COVERAGE_INCOMPLETE',
		detail: 'ATTACHMENT_FORMAT_INVALID',
		droppedAttachments: [{ id: 'attachment:2', filename: 'logo.png' }],
	})
})
it('checks the raw email size before DNS, preview or extraction', async() => {
	const raw = Buffer.alloc(8 * 1024 * 1024 + 1),
		resolver = vi.fn(fixtureResolver),
		policy = fixturePolicy()
	await expect(
		approveWithResolver(
			raw,
			policy,
			fixtureBinding(policy),
			signal(),
			resolver,
		),
	).rejects.toThrow('MESSAGE_SIZE')
	await expect(prepareEmailPreview(raw, signal())).rejects.toThrow(
		'MESSAGE_SIZE',
	)
	expect(resolver).not.toHaveBeenCalled()
})
it.each([
	['text', 'large.txt', 'text/plain', () => Buffer.alloc(1024 * 1024 + 1, 65)],
	[
		'PDF bytes',
		'large.pdf',
		'application/pdf',
		() => Buffer.concat([pdfDocument(), Buffer.alloc(6 * 1024 * 1024)]),
	],
	[
		'image bytes',
		'large.png',
		'image/png',
		() => Buffer.concat([image, Buffer.alloc(2 * 1024 * 1024)]),
	],
	[
		'image dimensions',
		'huge.png',
		'image/png',
		() => {
			const b = Buffer.from(image)
			b.writeUInt32BE(100000, 16)
			return b
		},
	],
	[
		'PDF page dimensions',
		'huge.pdf',
		'application/pdf',
		() => Buffer.from(
			pdfDocument().toString('latin1').replace('612 792', '99999 99999'),
			'latin1',
		),
	],
	[
		'unsupported archive expanded bytes',
		'large.zip',
		'application/zip',
		() => Buffer.from(zipSync({ 'data.bin': new Uint8Array(65 * 1024 * 1024) })),
	],
	[
		'Office expanded bytes',
		'large.docx',
		'application/octet-stream',
		() => docxDocument('A'.repeat(65 * 1024 * 1024)),
	],
	['extracted text', 'long.txt', 'text/plain', () => Buffer.alloc(100001, 65)],
] as const)(
	'blocks oversized %s before preview',
	async(_label, filename, mimeType, bytes) => {
		await expect(
			prepareDisplayAttachment(
				{ bytes: bytes(), filename, mimeType },
				signal(),
			),
		).rejects.toThrow(/ATTACHMENT_TEXT_TOO_LARGE|PREVIEW_ATTACHMENT_LIMIT/)
	},
	30000,
)
it.each(['body-only', 'body-and-attachments', 'attachments-only'] as const)(
	'drops an oversized supported attachment for %s without sending it to AI',
	async(contentScope) => {
		const raw = await mail([
			{
				type: 'text/plain',
				name: 'large.txt',
				bytes: Buffer.alloc(1024 * 1024 + 1, 65),
			},
		])
		const policy = fixturePolicy({ contentScope }),
			binding = fixtureBinding(policy)
		const handle = await approveWithResolver(
			raw,
			policy,
			binding,
			signal(),
			fixtureResolver,
		)
		try {
			expect(copyApprovedRawEmail(handle, binding)).toEqual(raw)
			expect(inspectApprovedEmail(handle, binding).inventory[1]).toMatchObject({
				exclusionReason: 'ATTACHMENT_TEXT_TOO_LARGE',
			})
			expect(
				projectApprovedEmail(handle, binding).sources.map((s) => s.id),
			).toEqual(contentScope === 'attachments-only' ? [] : ['body:0'])
			const complete = vi.fn(async(request: { sourcesJson: string }) => {
				expect(request.sourcesJson).not.toContain('attachment:1')
				expect(request.sourcesJson).not.toContain('large.txt')
				return JSON.stringify({
					result: { outcome: 'insufficient', reason: 'Synthetic test' },
				})
			})
			const provider = new EmailAiProvider({
				identity: {
					provider: 'Synthetic',
					model: 'test',
					contextTokens: 1050000,
				},
				complete,
			})
			await expect(
				provider.check(
					handle,
					binding,
					signal(),
					async() => {},
					provider.describe(),
				),
			).rejects.toThrow(
				contentScope === 'attachments-only'
					? 'NO_USABLE_CONTENT'
					: 'EMAIL_AI_INSUFFICIENT',
			)
			expect(complete).toHaveBeenCalledTimes(
				contentScope === 'attachments-only' ? 0 : 1,
			)
		} finally {
			releaseApprovedEmail(handle)
		}
	},
)
it('permits scanned PDF preview but cannot extract nonexistent text for AI', async() => {
	const bytes = pdfDocument('')
	const view = await prepareDisplayAttachment(
		{ bytes, filename: 'scan.pdf', mimeType: 'application/pdf' },
		signal(),
	)
	expect(view.view).toBe('pdf')
	const [result] = await extractSourceText(
		[
			{
				id: 'attachment:0',
				bytes,
				filename: 'scan.pdf',
				mimeType: 'application/pdf',
			},
		],
		signal(),
	)
	expect(result.error).toBe('ATTACHMENT_NO_TEXT')
})

it('does not misclassify a supported PDF as unsupported because of its filename or MIME label', async() => {
	const raw = await mail([
		{
			type: 'image/png',
			name: 'misleading.png',
			bytes: pdfDocument('Baggage count: 2'),
		},
	])
	const policy = fixturePolicy({ contentScope: 'attachments-only' }),
		binding = fixtureBinding(policy)
	const handle = await approveWithResolver(
		raw,
		policy,
		binding,
		signal(),
		fixtureResolver,
	)
	expect(projectApprovedEmail(handle, binding).sources[0].text).toContain(
		'Baggage count: 2',
	)
	expect(
		inspectApprovedEmail(handle, binding).inventory[1].exclusionReason,
	).toBeUndefined()
	releaseApprovedEmail(handle)
})

it('drops an unsupported archive without applying Office XML interpretation to its contents', async() => {
	const raw = await mail([
		{
			type: 'application/zip',
			name: 'archive.zip',
			bytes: Buffer.from(
				zipSync({
					'../unrelated.xml': strToU8(
						'<!DOCTYPE data [<!ENTITY item "value">]><data>&item;</data>',
					),
				}),
			),
		},
	])
	const policy = fixturePolicy(),
		binding = fixtureBinding(policy)
	const handle = await approveWithResolver(
		raw,
		policy,
		binding,
		signal(),
		fixtureResolver,
	)
	expect(
		inspectApprovedEmail(handle, binding).inventory[1].exclusionReason,
	).toBe('ATTACHMENT_FORMAT_UNSUPPORTED')
	expect(
		projectApprovedEmail(handle, binding).sources.map((s) => s.id),
	).toEqual(['body:0'])
	releaseApprovedEmail(handle)
})

it('omits a small PDF exceeding processing limits after DKIM, while preserving its original bytes', async() => {
	const bytes = Buffer.from(
		pdfDocument().toString('latin1').replace('612 792', '99999 99999'),
		'latin1',
	)
	expect(bytes.length).toBeLessThan(1309 * 1024)
	const raw = await mail([
		{ type: 'application/pdf', name: 'large-page.pdf', bytes },
	])
	const policy = fixturePolicy(),
		binding = fixtureBinding(policy)
	const handle = await approveWithResolver(
		raw,
		policy,
		binding,
		signal(),
		fixtureResolver,
	)
	try {
		expect(copyApprovedRawEmail(handle, binding)).toEqual(raw)
		expect(inspectApprovedEmail(handle, binding).inventory[1]).toMatchObject({
			exclusionReason: 'ATTACHMENT_TEXT_TOO_LARGE',
		})
		expect(
			projectApprovedEmail(handle, binding).sources.map((s) => s.id),
		).toEqual(['body:0'])
	} finally {
		releaseApprovedEmail(handle)
	}

	const altered = Buffer.from(
		raw
			.toString()
			.replace(bytes.toString('base64').slice(0, 12), 'AAAAAAAAAAAA'),
	)
	await expect(
		approveWithResolver(altered, policy, binding, signal(), fixtureResolver),
	).rejects.toMatchObject({
		code: 'DKIM_VERIFICATION_FAILED',
		droppedAttachments: [],
	})
})
it('a size-limited attachment cannot prevent body preview or viewing another file', async() => {
	const raw = await mail([
		{
			type: 'text/plain',
			name: 'large.txt',
			bytes: Buffer.alloc(1024 * 1024 + 1, 65),
		},
		{ type: 'text/plain', name: 'small.txt', bytes: Buffer.from('Baggage: 2') },
	])
	const preview = await prepareEmailPreview(raw, signal())
	try {
		expect(preview.body).toContain('Booking baggage count: 2.')
		expect(preview.attachments[0].previewError).toBe(
			'ATTACHMENT_TEXT_TOO_LARGE',
		)
		await expect(
			prepareAttachmentView(preview.attachments[0], signal()),
		).rejects.toThrow('ATTACHMENT_TEXT_TOO_LARGE')
		expect(
			(
				await prepareAttachmentView(preview.attachments[1], signal())
			).bytes.toString(),
		).toBe('Baggage: 2')
	} finally {
		releaseEmailPreview(preview)
	}
})
it('reserves text capacity for bodies even after attachments, and a dropped file does not consume the remaining budget', async() => {
	const parts = [
		{
			id: 'attachment:0',
			filename: 'fits.txt',
			mimeType: 'text/plain',
			bytes: Buffer.alloc(60000, 65),
		},
		{
			id: 'attachment:1',
			filename: 'too-long.txt',
			mimeType: 'text/plain',
			bytes: Buffer.alloc(50000, 66),
		},
		{
			id: 'attachment:2',
			filename: 'small.txt',
			mimeType: 'text/plain',
			bytes: Buffer.from('Baggage: 2'),
		},
		{
			id: 'body:3',
			filename: 'body',
			mimeType: 'text/plain',
			bytes: Buffer.alloc(30000, 67),
			body: true,
		},
	]
	const results = await extractSourceText(parts, signal())
	expect(results.map((r) => r.id)).toEqual(parts.map((p) => p.id))
	expect(results.map((r) => r.error)).toEqual([
		undefined,
		'ATTACHMENT_TEXT_TOO_LARGE',
		undefined,
		undefined,
	])
	expect(results.reduce((sum, r) => sum + (r.text?.length ?? 0), 0)).toBe(90010)
})
it('does not treat an oversized body as a skippable attachment', async() => {
	const raw = await signCoreEmail({ body: 'A'.repeat(100001) })
	const policy = fixturePolicy()
	await expect(
		approveWithResolver(
			raw,
			policy,
			fixtureBinding(policy),
			signal(),
			fixtureResolver,
		),
	).rejects.toMatchObject({
		code: 'APPROVED_TEXT_LIMIT',
		droppedAttachments: [],
	})
})
