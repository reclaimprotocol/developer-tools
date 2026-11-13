/* eslint-disable @stylistic/max-len */
import { createHash } from 'node:crypto'
import type { VerifiedAttachment } from '../../types/verification.ts'

// Only this server-side type carries bytes. JSON responses use VerifiedAttachment.
export interface VerifiedAttachmentBytes extends VerifiedAttachment {
	bytes: Buffer
	charset?: string
}
export function attachmentHash(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex')
}

export function attachmentMetadata({
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	bytes: _bytes,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	charset: _charset,
	...metadata
}: VerifiedAttachmentBytes): VerifiedAttachment {
	return metadata
}
