/* eslint-disable @stylistic/max-len */
import { dkimBody } from 'mailauth/lib/dkim/body/index.js'
import {
	DkimVerifier,
	type SignatureHeader,
	type SignatureResult,
} from 'mailauth/lib/dkim/dkim-verifier.js'
import { MessageParser } from 'mailauth/lib/dkim/message-parser.js'
import { formatRelaxedLine, writeToStream } from 'mailauth/lib/tools.js'
import {
	type DnsResolver,
	retryingDnsResolver,
} from '../lib/email/dkim-verifier.ts'
import { inspectHeaders, type RawHeader } from '../lib/email/headers.ts'
import type { DkimStatus, SelectedDkimSignature } from './contracts.ts'
import { sha256 } from './policy.ts'

export interface CoreDkimCandidate {
	status: DkimStatus
	signature: SelectedDkimSignature
	headers: RawHeader[]
	evidenceHeaderLines: Buffer[]
	coveredBytes: number
	totalBytes: number
}
/** Small pinned-mailauth adapter: capture the exact header being verified, never match b=/d=/s= loosely. */
export async function evaluateDkim(
	raw: Buffer,
	resolver?: DnsResolver,
): Promise<CoreDkimCandidate[]> {
	const candidates: CoreDkimCandidate[] = []
	class CapturingVerifier extends DkimVerifier {
		capture(header: SignatureHeader, result: SignatureResult) {
			if(header.type !== 'DKIM') {
				return
			}

			const headerIndex = this.headers.parsed.findIndex(
				(h) => h.line === header.original || h.line.equals(header.original),
			)
			if(headerIndex < 0) {
				throw new Error('DKIM_ADAPTER_INCOMPATIBLE')
			}

			const lines = result.signingHeaders?.headers ?? []
			const evidenceHeaderLines = lines.map((line) => header.headerCanon === 'relaxed'
				? formatRelaxedLine(Buffer.from(line), '\r\n')
				: Buffer.from(line + '\r\n'),
			)
			const evidenceHeaders = Buffer.concat(evidenceHeaderLines)
			candidates.push({
				status: {
					headerIndex,
					result: result.status.result,
					testing: result.status.testing === true,
				},
				signature: {
					headerIndex,
					signingDomain: result.signingDomain?.toLowerCase() ?? '',
					selector: result.selector ?? '',
					signatureSha256: sha256(
						Buffer.from(result.signature ?? '', 'base64'),
					),
					headerSha256: sha256(header.original),
					headerCanonicalization: header.headerCanon,
					bodyCanonicalization: header.bodyCanon,
				},
				headers:
					result.status.result === 'pass'
						? inspectHeaders(
							Buffer.concat([evidenceHeaders, Buffer.from('\r\n')]),
						)
						: [],
				evidenceHeaderLines,
				coveredBytes: result.canonBodyLength ?? -1,
				totalBytes: result.canonBodyLengthTotal ?? -2,
			})
		}
		override async verifySignature(header: SignatureHeader) {
			const result = await super.verifySignature(header)
			this.capture(header, result)
			return result
		}
		override skippedSignatureResult(header: SignatureHeader) {
			const result = super.skippedSignatureResult(header)
			this.capture(header, result)
			return result
		}
	}
	const verifier = new CapturingVerifier({
		strict: true,
		rejectRsaSha1: true,
		minBitLength: 1024,
		// Omitted resolver uses mailauth's DNS; production entry adds the existing bounded resolver.
		...(resolver ? { resolver: retryingDnsResolver(resolver) } : {}),
	})
	await writeToStream(verifier, raw)
	return candidates.sort(
		(a, b) => a.signature.headerIndex - b.signature.headerIndex,
	)
}

export async function canonicalEvidence(
	raw: Buffer,
	candidate: CoreDkimCandidate,
): Promise<Buffer> {
	const hasher = dkimBody(
		`simple/${candidate.signature.bodyCanonicalization}`,
		'sha256',
	)
	const chunks: Buffer[] = []
	const update = hasher.bodyHash.update.bind(hasher.bodyHash)
	// Observe bytes delivered by the library's canonicalizer, without duplicating its algorithm.
	hasher.bodyHash.update = (chunk) => {
		chunks.push(Buffer.from(chunk))
		update(chunk)
	}

	class BodyParser extends MessageParser {
		override async nextChunk(chunk: Buffer) {
			hasher.update(chunk)
		}
	}
	await writeToStream(new BodyParser(), raw)
	hasher.digest('hex')
	const body = Buffer.concat(chunks)
	if(
		body.length !== candidate.totalBytes ||
		body.length !== candidate.coveredBytes
	) {
		throw new Error('PROOF_CONTENT_NOT_AUTHENTICATED')
	}

	const used = new Set([
		'from',
		'to',
		'date',
		'content-type',
		'content-transfer-encoding',
		'content-disposition',
		'content-id',
	])
	// Only authenticated interpretation/identity fields enter MIME; no Subject or other metadata.
	const headers = candidate.evidenceHeaderLines.filter((line) => used.has(line.subarray(0, line.indexOf(':')).toString().toLowerCase()),
	)
	return Buffer.concat([...headers, Buffer.from('\r\n'), body])
}
