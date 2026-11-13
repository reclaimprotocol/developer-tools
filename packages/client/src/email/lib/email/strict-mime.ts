/* eslint-disable @stylistic/max-len */
import PostalMime, { type PostalMimeOptions } from 'postal-mime'

// postal-mime 4.0.4 deliberately tolerates broken encodings and unclosed MIME
// parts. This small adapter rejects those repairs. PostalMime still performs
// all MIME traversal, attachment classification and transfer decoding.
// These internal hooks are isolated here and covered by signed fixtures.
interface MimeNode {
	state: string
	headers: { key: string, value: string }[]
	contentType: {
		multipart: string | false
		parsed: { value: string, params: { charset?: string, name?: string } }
	}
	contentDisposition: {
		parsed: { value: string, params: { filename?: string } }
	}
	childNodes: MimeNode[]
	stripComments(value: string): string
	content: ArrayBuffer | null
	contentTransferEncoding: { value: string }
	contentDecoder: LineDecoder | null
	feed(line: Uint8Array): void
	finalize(boundaryEnded?: boolean): Promise<void>
}
interface LineDecoder {
	pendingLineBreak: boolean
	chunks: (Uint8Array | string)[]
	writeByte?: (byte: number) => void
	update(line: Uint8Array): void
	finalize(boundaryEnded?: boolean): Promise<ArrayBuffer>
}
interface ParserHooks {
	root: MimeNode
	currentNode: MimeNode
	boundaries: { value: Uint8Array, node: MimeNode }[]
	processLine(line: Uint8Array, isFinal: boolean): Promise<void>
}

export interface MimeInventoryPart {
	kind: 'body' | 'attachment'
	mimeType: string
	filename: string
	charset?: string
	bytes: Buffer
}
export async function parseStrictMime(
	raw: Buffer,
	options: PostalMimeOptions,
	inventory = false,
) {
	const parser = new PostalMime(options)
	// Core copy: reaches into PostalMime's untyped internals. The guard below
	// checks their shape and fails with MIME_PARSER_INCOMPATIBLE if it changes.
	const hooks = parser as unknown as ParserHooks
	if(
		!hooks.currentNode ||
		!Array.isArray(hooks.boundaries) ||
		typeof hooks.processLine !== 'function'
	) {
		throw new Error('MIME_PARSER_INCOMPATIBLE')
	}

	const hooked = new WeakSet<MimeNode>()
	const closed = new WeakSet<MimeNode>()
	const charsets = new Map<ArrayBuffer, string>()
	const processLine = hooks.processLine.bind(parser)
	hooks.processLine = async(line, isFinal) => {
		if(line[0] === 45 && line[1] === 45) {
			const marker = Buffer.from(line)
				.toString('latin1')
				.replace(/[ \t]+$/, '')
			for(const boundary of hooks.boundaries) {
				if(marker === `--${Buffer.from(boundary.value).toString('latin1')}--`) {
					closed.add(boundary.node)
				}
			}
		}

		const node = hooks.currentNode
		if(!hooked.has(node)) {
			hooked.add(node)
			const feed = node.feed.bind(node)
			const finalize = node.finalize.bind(node)
			const base64: string[] = []
			let softBreak = false
			let hasHeader = false
			node.feed = (bytes) => {
				const readingHeaders = node.state === 'header'
				const text = Buffer.from(bytes).toString('latin1')
				if(node.state === 'header') {
					if(
						text &&
						!(
							/^[\x21-\x39\x3b-\x7e]+:/.test(text) ||
							(/^[ \t]/.test(text) && hasHeader)
						)
					) {
						throw new Error('MALFORMED_MIME')
					}

					if(text && !/^[ \t]/.test(text)) {
						hasHeader = true
					}
				} else if(node.state === 'body') {
					const encoding = node.contentTransferEncoding.value.toLowerCase()
					if(
						inventory &&
						!node.contentType.multipart &&
						((encoding === '7bit' && /[\x00\x80-\xff]/.test(text)) ||
							(encoding === '8bit' && text.includes('\0')))
					) {
						throw new Error('ATTACHMENT_DECODE_FAILED')
					}

					if(encoding === 'base64') {
						if(/[^A-Za-z0-9+/= \t]/.test(text)) {
							throw new Error('ATTACHMENT_DECODE_FAILED')
						}

						base64.push(text.replace(/[ \t]/g, ''))
					} else if(encoding === 'quoted-printable') {
						for(let i = 0; i < text.length; i++) {
							if(text[i] !== '=') {
								continue
							}

							if(i === text.length - 1) {
								break
							}

							if(!/^[0-9a-f]{2}$/i.test(text.slice(i + 1, i + 3))) {
								throw new Error('ATTACHMENT_DECODE_FAILED')
							}

							i += 2
						}

						softBreak = text.endsWith('=')
					}
				}

				feed(bytes)
				if(readingHeaders && node.state === 'body') {
					const encoding = node.contentTransferEncoding.value.toLowerCase()
					if(
						!['7bit', '8bit', 'binary', 'base64', 'quoted-printable'].includes(
							encoding,
						)
					) {
						throw new Error('ATTACHMENT_DECODE_FAILED')
					}

					for(const name of [
						'content-type',
						'content-disposition',
						'content-transfer-encoding',
					]) {
						if(node.headers.filter((h) => h.key === name).length > 1) {
							throw new Error('MALFORMED_MIME')
						}
					}

					if(inventory) {
						for(const header of node.headers.filter((h) => ['content-type', 'content-disposition'].includes(h.key),
						)) {
							checkParameters(node.stripComments(header.value))
						}

						if(
							node.contentType.multipart &&
							!['mixed', 'alternative', 'related'].includes(
								node.contentType.multipart,
							)
						) {
							throw new Error('MIME_INTERPRETATION_UNSUPPORTED')
						}
					}

					// PostalMime normalizes hard line breaks to LF, including in file
					// content. Keep original line endings for identity/QP decoding so the
					// downloaded bytes are the actual file. The body is normalized later.
					const decoder = node.contentDecoder
					if(decoder && encoding !== 'base64') {
						preserveLineEndings(decoder)
					}
				}
			}

			node.finalize = async(boundaryEnded) => {
				if(node.state !== 'finished') {
					if(
						node.state === 'header' ||
						(node.contentType.multipart && !closed.has(node))
					) {
						throw new Error('MALFORMED_MIME')
					}

					if(softBreak) {
						throw new Error('ATTACHMENT_DECODE_FAILED')
					}

					const encoded = base64.join('')
					if(Buffer.from(encoded, 'base64').toString('base64') !== encoded) {
						throw new Error('ATTACHMENT_DECODE_FAILED')
					}
				}

				await finalize(boundaryEnded)
				const charset = node.contentType.parsed.params.charset
				if(charset && node.content) {
					charsets.set(node.content, charset)
				}
			}
		}

		return processLine(line, isFinal)
	}

	const email = await parser.parse(raw)
	const mimeParts: MimeInventoryPart[] = []
	if(inventory) {
		const walk = (node: MimeNode) => {
			if(node.childNodes.length) {
				for(const child of node.childNodes) {
					walk(child)
				}

				return
			}

			if(node.contentType.multipart) {
				return
			}

			if(mimeParts.length >= 1000) {
				throw new Error('MIME_PART_LIMIT')
			}

			const type = node.contentType.parsed
			const disposition = node.contentDisposition.parsed
			const filename = disposition.params.filename || type.params.name || ''
			const file =
				disposition.value === 'attachment' ||
				Boolean(filename) ||
				node.headers.some((h) => h.key === 'content-id')
			const kind =
				!file && ['text/plain', 'text/html'].includes(type.value)
					? 'body'
					: 'attachment'
			mimeParts.push({
				kind,
				mimeType: type.value,
				filename,
				...(type.params.charset ? { charset: type.params.charset } : {}),
				bytes: Buffer.from(new Uint8Array(node.content ?? new ArrayBuffer(0))),
			})
		}

		walk(hooks.root)
	}

	return {
		...email,
		mimeParts,
		attachmentCharsets: email.attachments.map((a) => a.content instanceof ArrayBuffer ? charsets.get(a.content) : undefined,
		),
	}
}

function checkParameters(value: string) {
	const fields: string[] = []
	let quoted = false,
		escaped = false,
		start = 0
	for(let i = 0; i < value.length; i++) {
		if(escaped) {
			escaped = false
			continue
		}

		if(quoted && value[i] === '\\') {
			escaped = true
			continue
		}

		if(value[i] === '"') {
			quoted = !quoted
		}

		if(!quoted && value[i] === ';') {
			fields.push(value.slice(start, i))
			start = i + 1
		}
	}

	if(quoted || escaped) {
		throw new Error('MALFORMED_MIME')
	}

	fields.push(value.slice(start))
	const seen = new Set<string>()
	for(const field of fields.slice(1)) {
		const match =
			/^\s*([a-z0-9!#$&+.^_`|~*-]+)\s*=\s*(?:"(?:[^"\\]|\\.)*"|[^\s";]+)\s*$/i.exec(
				field,
			)
		if(!match || seen.has(match[1].toLowerCase())) {
			throw new Error('MALFORMED_MIME')
		}

		seen.add(match[1].toLowerCase())
	}

	// An extended value and a basic fallback may disagree across MIME implementations.
	for(const name of seen) {
		const base = name.split('*')[0]
		if(name !== base && seen.has(base)) {
			throw new Error('MALFORMED_MIME')
		}

		const continuation = /\*(\d+)\*?$/.exec(name)
		if(continuation) {
			const index = Number(continuation[1])
			if(
				index > 100 ||
				(index > 0 &&
					!seen.has(`${base}*${index - 1}`) &&
					!seen.has(`${base}*${index - 1}*`))
			) {
				throw new Error('MALFORMED_MIME')
			}
		}
	}
}

function preserveLineEndings(decoder: LineDecoder) {
	const update = decoder.update.bind(decoder)
	const finalize = decoder.finalize.bind(decoder)
	let previousEnding = new Uint8Array()
	const writeEnding = () => {
		if(decoder.writeByte) {
			for(const byte of previousEnding) {
				decoder.writeByte(byte)
			}
		} else {
			decoder.chunks.push(previousEnding)
		}
	}

	decoder.update = (line) => {
		if(decoder.pendingLineBreak) {
			writeEnding()
		}

		decoder.pendingLineBreak = false
		update(line)
		const offset = line.byteOffset + line.byteLength
		const suffix = new Uint8Array(
			line.buffer,
			offset,
			Math.min(2, line.buffer.byteLength - offset),
		)
		previousEnding =
			suffix[0] === 13 && suffix[1] === 10
				? new Uint8Array([13, 10])
				: suffix[0] === 10
					? new Uint8Array([10])
					: new Uint8Array()
	}

	decoder.finalize = (boundaryEnded) => {
		if(!boundaryEnded && decoder.pendingLineBreak) {
			writeEnding()
		}

		decoder.pendingLineBreak = false
		return finalize(boundaryEnded)
	}
}
