/* eslint-disable @stylistic/max-len */
import { Worker } from 'node:worker_threads'
import type { AttachmentFormat, RegexRule } from '../../types/verification.ts'
import { isSupportedNodeVersion } from '../node-runtime.ts'
import type { VerifiedAttachmentBytes } from './attachments.ts'

export interface AttachmentText {
	id: string
	filename: string
	format?: AttachmentFormat
	encoding?: string
	text?: string
	error?: string
	formatError?: string
	pageRanges?: { page: number, start: number, end: number }[]
}

export function attachmentTextIssue(code: string): string {
	const messages: Record<string, string> = {
		ATTACHMENT_FORMAT_UNSUPPORTED:
			'The attachment is not a supported PDF, DOCX, XLSX or text document.',
		ATTACHMENT_FORMAT_INVALID:
			'The attachment bytes do not form a recognizable document of the declared format.',
		ATTACHMENT_FORMAT_NOT_ALLOWED:
			'The attachment format is outside the formats predefined for this flow.',
		ATTACHMENT_TEXT_UNREADABLE:
			'The system could not decode the attachment into readable text.',
		ATTACHMENT_NO_TEXT:
			'The attachment contains no readable text. Scanned PDFs and images require OCR.',
		ATTACHMENT_ENCRYPTED:
			'The attachment is encrypted and its text cannot be read.',
		ATTACHMENT_TEXT_TOO_LARGE:
			'The attachment exceeds the text extraction size limit.',
		ATTACHMENT_EXTRACTION_TIMEOUT:
			'Attachment processing exceeded the execution time limit.',
		ATTACHMENT_RUNTIME_UNSUPPORTED:
			"The server's Node.js version is unsupported. Use Node.js 22.19 or newer, then restart the server.",
		ATTACHMENT_TEXT_EXTRACTION_FAILED:
			'The document parser failed while extracting attachment text.',
		ATTACHMENT_EXTRACTION_FAILED: 'The attachment processing worker failed.',
	}
	return (
		messages[code] || 'The system could not extract readable attachment text.'
	)
}

export async function prepareAttachmentText(
	attachments: VerifiedAttachmentBytes[],
	rules: RegexRule[],
	allowedFormats?: AttachmentFormat[],
): Promise<AttachmentText[]> {
	// Related images are still DKIM-verified and downloadable. Only documents
	// and attachments selected explicitly by filename enter content matching.
	const candidates = attachments.filter(
		(a) => !a.inline ||
			rules.some((r) => r.target === 'attachment' && r.filename === a.filename),
	)
	if(!candidates.length) {
		return []
	}

	if(!isSupportedNodeVersion()) {
		return candidates.map(({ id, filename }) => ({
			id,
			filename,
			formatError: 'ATTACHMENT_RUNTIME_UNSUPPORTED',
		}))
	}

	return new Promise((resolve) => {
		const worker = new Worker(
			new URL('./attachment-text-worker.mjs', import.meta.url),
			{
				execArgv: [],
				env: {},
				stdout: true,
				stderr: true,
				resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 },
				workerData: {
					attachments: candidates.map(
						({ id, filename, mimeType, bytes, charset }) => ({
							id,
							filename,
							mimeType,
							bytes,
							charset,
						}),
					),
					rules,
					allowedFormats,
				},
			},
		)
		worker.stdout.on('data', () => {})
		worker.stderr.on('data', () => {})
		let finished = false
		const finish = (result: AttachmentText[]) => {
			if(finished) {
				return
			}

			finished = true
			clearTimeout(timer)
			void worker.terminate()
			resolve(result)
		}

		const failure = (code: string) => candidates.map(({ id, filename }) => ({
			id,
			filename,
			formatError: code,
		}))
		const timer = setTimeout(
			() => finish(failure('ATTACHMENT_EXTRACTION_TIMEOUT')),
			20_000,
		)
		worker.once('message', finish)
		worker.once('error', () => finish(failure('ATTACHMENT_EXTRACTION_FAILED')))
		worker.once('exit', () => {
			if(!finished) {
				finish(failure('ATTACHMENT_EXTRACTION_FAILED'))
			}
		})
	})
}
