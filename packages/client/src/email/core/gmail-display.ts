/* eslint-disable @stylistic/max-len */
/** Gmail's parsed payload is for fast display only, never verification evidence. */
import { decodeWords } from 'postal-mime'
import { gmailRequest, GoogleEmailError } from './google.ts'

export interface GmailDisplay {
	from: string
	to: string
	subject: string
	date: string
	body: string
	html?: string
	truncated: boolean
	attachments: GmailDisplayFile[]
	attachmentsUnavailable?: boolean
}
export interface GmailDisplayFile {
	id: string
	filename: string
	mimeType: string
	size: number
	inline: boolean
	contentId?: string
}
interface Part {
	mimeType?: string
	filename?: string
	headers?: { name?: string, value?: string }[]
	body?: { data?: string, attachmentId?: string, size?: number }
	parts?: Part[]
}
function header(part: Part, name: string): string {
	if(!Array.isArray(part.headers)) {
		return ''
	}

	const value = part.headers.find(
		(h) => typeof h?.name === 'string' && h.name.toLowerCase() === name,
	)?.value
	return typeof value === 'string' ? value.slice(0, 128 * 1024) : ''
}

async function message(
	token: string,
	id: string,
	signal?: AbortSignal,
): Promise<Part> {
	if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
		throw new GoogleEmailError('GOOGLE_REJECTED')
	}

	const data = await gmailRequest<{
		id?: string
		payload?: Part
		sizeEstimate?: number
	}>(token, `/messages/${id}?format=full`, signal, 4 * 1024 * 1024)
	if(data.id !== id || !data.payload || typeof data.payload !== 'object') {
		throw new GoogleEmailError('GOOGLE_REJECTED')
	}

	if(
		data.sizeEstimate !== undefined &&
		(!Number.isSafeInteger(data.sizeEstimate) ||
			data.sizeEstimate < 0 ||
			data.sizeEstimate > 8 * 1024 * 1024)
	) {
		throw new GoogleEmailError('EMAIL_TOO_LARGE')
	}

	return data.payload
}

function files(payload: Part): { metadata: GmailDisplayFile, part: Part }[] {
	const result: { metadata: GmailDisplayFile, part: Part }[] = []
	let count = 0,
		total = 0
	function visit(part: Part, depth: number): void {
		if(!part || typeof part !== 'object' || depth > 20 || ++count > 200) {
			throw new GoogleEmailError('EMAIL_TOO_LARGE')
		}

		const type = part.mimeType?.toLowerCase() ?? 'application/octet-stream'
		const disposition = header(part, 'content-disposition')
		const isFile =
			!!part.filename ||
			/^\s*attachment\b/i.test(disposition) ||
			(!type.startsWith('multipart/') &&
				!['text/plain', 'text/html'].includes(type))
		if(isFile) {
			const size =
				part.body?.size ??
				(typeof part.body?.data === 'string'
					? Buffer.byteLength(part.body.data, 'base64url')
					: 0)
			total += size
			if(
				!Number.isSafeInteger(size) ||
				size < 0 ||
				size > 6 * 1024 * 1024 ||
				total > 8 * 1024 * 1024 ||
				result.length >= 20
			) {
				throw new GoogleEmailError('EMAIL_TOO_LARGE')
			}

			const contentId = header(part, 'content-id')
				.replace(/^<|>$/g, '')
				.slice(0, 512)
			result.push({
				part,
				metadata: {
					id: String(result.length),
					filename: decodeWords(
						part.filename || `attachment-${result.length + 1}`,
					)
						.replace(/[\r\n\0]/g, '')
						.slice(0, 512),
					mimeType: type.slice(0, 128),
					size,
					inline: /^\s*inline\b/i.test(disposition) || !!contentId,
					...(contentId ? { contentId } : {}),
				},
			})
			return // Attached/forwarded messages are never traversed as body or files.
		}

		if(part.parts !== undefined && !Array.isArray(part.parts)) {
			throw new GoogleEmailError('GOOGLE_REJECTED')
		}

		for(const child of part.parts ?? []) {
			visit(child, depth + 1)
		}
	}

	visit(payload, 0)
	return result
}

/** Fetch just the chosen display attachment; never establishes verification evidence. */
export async function gmailDisplayAttachment(
	token: string,
	id: string,
	fileId: string,
	signal?: AbortSignal,
): Promise<{ metadata: GmailDisplayFile, bytes: Buffer }> {
	if(!/^(?:[0-9]|1[0-9])$/.test(fileId)) {
		throw new GoogleEmailError('GOOGLE_REJECTED')
	}

	const file = files(await message(token, id, signal))[Number(fileId)]
	if(!file) {
		throw new GoogleEmailError('GOOGLE_REJECTED')
	}

	const reference = file.part.body?.attachmentId
	if(
		reference !== undefined &&
		(typeof reference !== 'string' ||
			!/^[A-Za-z0-9_-]{1,2048}$/.test(reference))
	) {
		throw new GoogleEmailError('GOOGLE_REJECTED')
	}

	const body = reference
		? await gmailRequest<{ data?: string, size?: number }>(
			token,
			`/messages/${id}/attachments/${reference}`,
			signal,
			8 * 1024 * 1024 + 1024,
		)
		: file.part.body
	if(
		typeof body?.data !== 'string' ||
		body.data.length > 8 * 1024 * 1024 ||
		!/^[A-Za-z0-9_-]*={0,2}$/.test(body.data)
	) {
		throw new GoogleEmailError('GOOGLE_REJECTED')
	}

	const bytes = Buffer.from(body.data, 'base64url')
	if(
		bytes.length !== file.metadata.size ||
		bytes.length > 6 * 1024 * 1024 ||
		(body.size !== undefined && body.size !== bytes.length) ||
		bytes.toString('base64url') !== body.data.replace(/=+$/, '')
	) {
		bytes.fill(0)
		throw new GoogleEmailError('GOOGLE_REJECTED')
	}

	return { metadata: file.metadata, bytes }
}

export async function gmailDisplay(
	token: string,
	id: string,
	signal?: AbortSignal,
): Promise<GmailDisplay> {
	const payload = await message(token, id, signal)
	let count = 0,
		body = '',
		html: string | undefined,
		truncated = false
	function visit(part: Part, depth: number): void {
		signal?.throwIfAborted()
		if(!part || typeof part !== 'object' || depth > 20 || ++count > 200) {
			throw new GoogleEmailError('EMAIL_TOO_LARGE')
		}

		// Never promote a forwarded message or attachment to the selected email body.
		if(
			part.filename ||
			/^\s*attachment\b/i.test(header(part, 'content-disposition'))
		) {
			return
		}

		const type = part.mimeType?.toLowerCase()
		if(type?.startsWith('multipart/')) {
			if(part.parts !== undefined && !Array.isArray(part.parts)) {
				throw new GoogleEmailError('GOOGLE_REJECTED')
			}

			for(const child of part.parts ?? []) {
				visit(child, depth + 1)
			}

			return
		}

		if(type !== 'text/plain' && type !== 'text/html') {
			return
		}

		if(type === 'text/html' ? html !== undefined : !!body) {
			return
		}

		// Large/external body parts wait for the existing raw preview. Do not fetch
		// attachment resources or start the MIME/document sandbox on the fast path.
		const encoded = part.body?.data
		if(typeof encoded !== 'string' || !encoded.length) {
			return
		}

		if(
			encoded.length > 2 * 1024 * 1024 ||
			!/^[A-Za-z0-9_-]+={0,2}$/.test(encoded)
		) {
			throw new GoogleEmailError('EMAIL_TOO_LARGE')
		}

		const bytes = Buffer.from(encoded, 'base64url')
		try {
			if(bytes.toString('base64url') !== encoded.replace(/=+$/, '')) {
				throw new GoogleEmailError('GOOGLE_REJECTED')
			}

			const charset = /charset\s*=\s*(?:"([^"\r\n]+)"|([^;\s]+))/i.exec(
				header(part, 'content-type'),
			)
			let decoder: InstanceType<typeof TextDecoder>
			try {
				decoder = new TextDecoder(charset?.[1] ?? charset?.[2] ?? 'utf-8')
			} catch{
				return
			} // The established MIME parser will handle unusual charsets.

			const text = decoder.decode(bytes)
			const limit = type === 'text/html' ? 1024 * 1024 : 256 * 1024
			if(Buffer.byteLength(text) > limit) {
				truncated = true
				return
			}

			if(type === 'text/html') {
				html = text
			} else {
				body = text
					.replace(/\r\n?/g, '\n')
					.replace(/\n{3,}/g, '\n\n')
					.trim()
			}
		} finally {
			bytes.fill(0)
		}
	}

	visit(payload, 0)
	// Reading an available body must not depend on every attachment fitting the
	// preview limits. Attachment access and verification retain their strict checks.
	let attachments: GmailDisplayFile[] = [],
		attachmentsUnavailable = false
	try {
		attachments = files(payload).map((file) => file.metadata)
	} catch(error) {
		if(
			!(error instanceof GoogleEmailError) ||
			error.code !== 'EMAIL_TOO_LARGE' ||
			(!body && !html)
		) {
			throw error
		}

		attachmentsUnavailable = true
	}

	if(!body && !html && !attachments.length) {
		throw new GoogleEmailError('GOOGLE_REJECTED')
	}

	const display = (name: string) => decodeWords(header(payload, name))
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 2048)
	return {
		from: display('from'),
		to: display('to'),
		subject: display('subject'),
		date: display('date'),
		body,
		html,
		truncated,
		attachments,
		...(attachmentsUnavailable ? { attachmentsUnavailable: true } : {}),
	}
}
