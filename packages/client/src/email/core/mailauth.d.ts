declare module 'mailauth/lib/dkim/dkim-verifier.js' {
	import { Writable } from 'node:stream'
	export interface SignatureHeader {
		type: string
		original: Buffer
		headerCanon: 'simple' | 'relaxed'
		bodyCanon: 'simple' | 'relaxed'
	}
	export interface SignatureResult {
		signingDomain?: string
		selector?: string
		signature?: string
		algo?: string
		canonBodyLength?: number
		canonBodyLengthTotal?: number
		signingHeaders?: { headers: string[] }
		status: { result: string, testing?: boolean }
	}
	export class DkimVerifier extends Writable {
		constructor(options: Record<string, unknown>)
		headers: { parsed: { line: Buffer, key: string }[] }
		verifySignature(header: SignatureHeader): Promise<SignatureResult>
		skippedSignatureResult(header: SignatureHeader): SignatureResult
	}
}
declare module 'mailauth/lib/tools.js' {
	import type { Writable } from 'node:stream'
	export function writeToStream(stream: Writable, input: Buffer): Promise<void>
	export function formatRelaxedLine(line: Buffer, suffix?: string): Buffer
}
declare module 'mailauth/lib/dkim/body/index.js' {
	export function dkimBody(
		mode: string,
		algorithm: string,
	): {
		bodyHash: { update(chunk: Buffer): void }
		update(chunk: Buffer): void
		digest(encoding: string): string
	}
}
declare module 'mailauth/lib/dkim/message-parser.js' {
	import { Writable } from 'node:stream'
	export class MessageParser extends Writable {
		nextChunk(chunk: Buffer): Promise<void>
	}
}
