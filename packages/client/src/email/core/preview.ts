/* eslint-disable @stylistic/max-len */
/** Server-only, untrusted display parsing. Never produces approved content. */
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { exactlyOneMailbox } from '../lib/email/address.ts'
import { inspectHeaders, oneHeader } from '../lib/email/headers.ts'
import { extractSourceText } from './documents.ts'
import { runDocumentWorker } from './isolation.ts'
import { normalizeEmailMailbox } from './sender.ts'

const attachmentSchema = z.strictObject({
	index: z.number().int().min(0).max(19),
	filename: z.string().max(512),
	mimeType: z.string().max(128),
	view: z.enum(['text', 'pdf', 'image']),
	viewMimeType: z.enum([
		'application/pdf',
		'image/png',
		'image/jpeg',
		'image/gif',
		'image/webp',
		'text/plain; charset=utf-8',
	]),
	base64: z
		.string()
		.max(12 * 1024 * 1024)
		.regex(/^[A-Za-z0-9+/]*={0,2}$/),
	inline: z.boolean(),
	contentId: z.string().max(512).optional(),
	previewError: z.literal('ATTACHMENT_TEXT_TOO_LARGE').optional(),
})
const previewSchema = z.strictObject({
	body: z.string().max(256 * 1024),
	truncated: z.boolean(),
	html: z
		.string()
		.max(1024 * 1024)
		.optional(),
	subject: z.string().max(2048),
	from: z.string().max(2048),
	to: z.string().max(2048),
	date: z.string().max(2048),
	attachments: z.array(attachmentSchema).max(20),
})
export interface PreviewAttachment {
	index: number
	filename: string
	mimeType: string
	view: 'text' | 'pdf' | 'image'
	previewError?: 'ATTACHMENT_TEXT_TOO_LARGE'
	viewMimeType: string
	inline: boolean
	contentId?: string
	bytes: Buffer
	sha256: string
	size: number
}
export interface EmailPreviewSnapshot {
	rawSha256: string
	body: string
	html?: string
	truncated: boolean
	from: string
	to: string
	subject: string
	date: string
	/** Unauthenticated mailbox for advisory checks only; absent for malformed/ambiguous From. */
	senderAddress?: string
	attachments: PreviewAttachment[]
}
export function releaseEmailPreview(preview: EmailPreviewSnapshot): void {
	for(const attachment of preview.attachments) {
		attachment.bytes.fill(0)
	}

	preview.body = ''
	preview.html = undefined
	preview.attachments = []
}

export async function prepareEmailPreview(
	raw: Buffer,
	signal: AbortSignal,
): Promise<EmailPreviewSnapshot> {
	signal.throwIfAborted()
	if(!raw.length || raw.length > 8 * 1024 * 1024) {
		throw new Error('MESSAGE_SIZE')
	}

	const rawSha256 = createHash('sha256').update(raw).digest('hex')
	const output = await runDocumentWorker(
		fileURLToPath(new URL('../lib/email/preview-worker.mjs', import.meta.url)),
		JSON.stringify({ raw: raw.toString('base64') }),
		signal,
		'preview',
	)
	const failure = z
		.strictObject({
			error: z.enum([
				'MESSAGE_SIZE',
				'PREVIEW_ATTACHMENT_LIMIT',
				'ATTACHMENT_TEXT_TOO_LARGE',
				'ATTACHMENT_FORMAT_INVALID',
				'EMAIL_PREVIEW_UNAVAILABLE',
			]),
		})
		.safeParse(output)
	if(failure.success) {
		throw new Error(failure.data.error)
	}

	const parsed = previewSchema.safeParse(output)
	if(
		!parsed.success ||
		Buffer.byteLength(parsed.data.body) > 256 * 1024 ||
		Buffer.byteLength(parsed.data.html ?? '') > 1024 * 1024
	) {
		throw new Error('EMAIL_PREVIEW_UNAVAILABLE')
	}

	const { attachments: files, ...display } = parsed.data
	const attachments: PreviewAttachment[] = []
	let total = 0
	try {
		for(const [index, file] of files.entries()) {
			const { base64, ...metadata } = file
			const bytes = Buffer.from(base64, 'base64')
			total += bytes.length
			attachments.push({
				...metadata,
				bytes,
				sha256: createHash('sha256').update(bytes).digest('hex'),
				size: bytes.length,
			})
			if(
				file.index !== index ||
				bytes.length > (file.previewError ? 8 : 6) * 1024 * 1024 ||
				total > 8 * 1024 * 1024 ||
				bytes.toString('base64') !== base64 ||
				(file.view === 'pdf'
					? file.viewMimeType !== 'application/pdf'
					: file.view === 'image'
						? !file.viewMimeType.startsWith('image/')
						: file.viewMimeType !== 'text/plain; charset=utf-8')
			) {
				throw new Error('EMAIL_PREVIEW_UNAVAILABLE')
			}
		}

		signal.throwIfAborted()
		// Use the same original-header parsing as verification, never the decoded,
		// truncated display name. Invalid metadata must not prevent opening a preview.
		let senderAddress: string | undefined
		try {
			senderAddress = normalizeEmailMailbox(
				exactlyOneMailbox(oneHeader(inspectHeaders(raw), 'from')),
			)
		} catch{
			/* Verification remains responsible for rejecting invalid identities. */
		}

		return { ...display, rawSha256, senderAddress, attachments }
	} catch(error) {
		for(const file of attachments) {
			file.bytes.fill(0)
		}

		throw error
	}
}

export async function prepareAttachmentView(
	file: PreviewAttachment,
	signal: AbortSignal,
): Promise<{
	bytes: Buffer
	contentType: string
	view: 'text' | 'pdf' | 'image'
	sha256: string
	truncated: boolean
}> {
	signal.throwIfAborted()
	if(file.previewError) {
		throw new Error(file.previewError)
	}

	if(
		!Buffer.isBuffer(file.bytes) ||
		file.bytes.length > 6 * 1024 * 1024 ||
		file.size !== file.bytes.length ||
		createHash('sha256').update(file.bytes).digest('hex') !== file.sha256 ||
		!(file.view === 'pdf'
			? file.viewMimeType === 'application/pdf'
			: file.view === 'image'
				? ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(
					file.viewMimeType,
				)
				: file.view === 'text' &&
					file.viewMimeType === 'text/plain; charset=utf-8')
	) {
		throw new Error('EMAIL_PREVIEW_UNAVAILABLE')
	}

	// Check PDF page count, dimensions and extracted-text bounds inside the
	// sandbox before returning the original document to the browser. A scanned
	// PDF can be viewed even though it has no text for AI analysis.
	if(file.view === 'pdf') {
		const [result] = await extractSourceText(
			[
				{
					id: 'attachment:0',
					filename: file.filename,
					mimeType: 'application/pdf',
					bytes: file.bytes,
					allowEmpty: true,
				},
			],
			signal,
		)
		if(result.error || result.formatError) {
			throw new Error(result.error ?? result.formatError)
		}
	}

	if(file.view !== 'text') {
		return {
			bytes: Buffer.from(file.bytes),
			contentType: file.viewMimeType,
			view: file.view,
			sha256: file.sha256,
			truncated: false,
		}
	}

	const [text] = await extractSourceText(
		[
			{
				id: 'attachment:0',
				filename: file.filename,
				mimeType: file.mimeType,
				bytes: file.bytes,
			},
		],
		signal,
	)
	if(text.formatError || text.error || typeof text.text !== 'string') {
		throw new Error(text.formatError ?? text.error ?? 'ATTACHMENT_NO_TEXT')
	}

	const bytes = Buffer.from(text.text)
	if(bytes.length > 400_000) {
		bytes.fill(0)
		throw new Error('ATTACHMENT_TEXT_TOO_LARGE')
	}

	return {
		bytes,
		contentType: 'text/plain; charset=utf-8',
		view: 'text',
		sha256: file.sha256,
		truncated: false,
	}
}

/** Display-only Gmail attachment. Inspect it independently of the raw preview or sender check. */
export async function prepareDisplayAttachment(
	file: { bytes: Buffer, filename: string, mimeType: string },
	signal: AbortSignal,
) {
	signal.throwIfAborted()
	if(!Buffer.isBuffer(file.bytes) || file.bytes.length > 6 * 1024 * 1024) {
		throw new Error('PREVIEW_ATTACHMENT_LIMIT')
	}

	const result = await runDocumentWorker(
		fileURLToPath(new URL('../lib/email/preview-worker.mjs', import.meta.url)),
		JSON.stringify({ attachment: file.bytes.toString('base64') }),
		signal,
		'preview',
	)
	if(
		result &&
		typeof result === 'object' &&
		'error' in result &&
		[
			'ATTACHMENT_TEXT_TOO_LARGE',
			'PREVIEW_ATTACHMENT_LIMIT',
			'ATTACHMENT_FORMAT_INVALID',
		].includes(String(result.error))
	) {
		throw new Error(String(result.error))
	}

	const parsed = attachmentSchema
		.pick({ view: true, viewMimeType: true })
		.safeParse(result)
	if(!parsed.success) {
		throw new Error('EMAIL_PREVIEW_UNAVAILABLE')
	}

	return prepareAttachmentView(
		{
			...file,
			...parsed.data,
			index: 0,
			inline: false,
			size: file.bytes.length,
			sha256: createHash('sha256').update(file.bytes).digest('hex'),
		},
		signal,
	)
}
