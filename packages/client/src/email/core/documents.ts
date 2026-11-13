/* eslint-disable @stylistic/max-len */
import { fileURLToPath } from 'node:url'
import type { AttachmentText } from '../lib/email/attachment-text.ts'
import { runDocumentWorker } from './isolation.ts'
import { plainCopy } from './policy.ts'
import { documentWorkerResultsSchema } from './schemas.ts'

export interface DocumentInput {
	id: string
	filename: string
	mimeType: string
	charset?: string
	bytes: Buffer
	body?: boolean
	inspectOnly?: boolean
	allowEmpty?: boolean
}
/** Validate both the worker DTO and exact input/output coverage before approving any source. */
export function validateDocumentResults(
	value: unknown,
	inputs: Pick<DocumentInput, 'id' | 'filename'>[],
): AttachmentText[] {
	const parsed = documentWorkerResultsSchema.safeParse(plainCopy(value))
	if(
		!parsed.success ||
		parsed.data.length !== inputs.length ||
		parsed.data.some(
			(result, index) => result.id !== inputs[index].id ||
				result.filename !== inputs[index].filename,
		)
	) {
		throw new Error('ATTACHMENT_EXTRACTION_FAILED')
	}

	return parsed.data.map((result) => {
		if(result.status === 'ok') {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const { status: _status, ...output } = result
			return output
		}

		if(result.status === 'inspected') {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const { status: _status, ...output } = result
			return output
		}

		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { status: _status, code, stage, ...output } = result
		return { ...output, [stage === 'format' ? 'formatError' : 'error']: code }
	})
}

export async function extractSourceText(
	inputs: DocumentInput[],
	signal: AbortSignal,
): Promise<AttachmentText[]> {
	const output = await runDocumentWorker(
		fileURLToPath(
			new URL('../lib/email/attachment-text-worker.mjs', import.meta.url),
		),
		JSON.stringify({
			integrated: true,
			extractAll: true,
			rules: [],
			attachments: inputs.map(({ bytes, ...input }) => ({
				...input,
				base64: bytes.toString('base64'),
			})),
		}),
		signal,
	)
	return validateDocumentResults(output, inputs)
}
