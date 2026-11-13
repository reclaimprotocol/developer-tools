/* eslint-disable @stylistic/max-len */
import { addressParser, decodeWords } from 'postal-mime'
import { exactlyOneMailbox } from '../lib/email/address.ts'
import { parseSignedDate } from '../lib/email/date.ts'
import {
	boundedDnsResolver,
	type DnsResolver,
} from '../lib/email/dkim-verifier.ts'
import {
	inspectHeaders,
	oneHeader,
	type RawHeader,
} from '../lib/email/headers.ts'
import { parseStrictMime } from '../lib/email/strict-mime.ts'
import {
	emailCheckCode,
	type EmailCheckObserver,
	type EmailCheckStep,
	reportEmailCheck,
} from './check-events.ts'
import type {
	ApprovedEmailContent,
	ApprovedEmailSummary,
	DkimStatus,
	EmailAiInput,
	EmailProofV1,
	EmailSource,
	NormalizedEmailPolicy,
	SourceInventoryEntry,
	TrustedEmailBinding,
} from './contracts.ts'
import {
	canonicalEvidence,
	type CoreDkimCandidate,
	evaluateDkim,
} from './dkim.ts'
import { extractSourceText } from './documents.ts'
import {
	canonicalJson,
	copyBinding,
	copyNormalizedPolicy,
	freeze,
	sha256,
} from './policy.ts'
import { matchesEmailDomain } from './sender.ts'
import { matchesEmailSender, normalizeEmailMailbox } from './sender.ts'

export class EmailApprovalError extends Error {
	readonly code: string
	readonly dkim: readonly DkimStatus[]
	readonly detail?: string
	readonly droppedAttachments: readonly {
		id: string
		filename: string
		reason: NonNullable<SourceInventoryEntry['exclusionReason']>
	}[]
	constructor(
		code: string,
		dkim: readonly DkimStatus[] = [],
		detail?: string,
		droppedAttachments: readonly {
			id: string
			filename: string
			reason: NonNullable<SourceInventoryEntry['exclusionReason']>
		}[] = [],
	) {
		super(code)
		this.code = code
		this.dkim = dkim
		this.detail = detail
		this.droppedAttachments = droppedAttachments
		this.name = 'EmailApprovalError'
		freeze(dkim)
		freeze(droppedAttachments)
	}
}
interface Record {
	raw: Buffer
	binding: TrustedEmailBinding
	policy: NormalizedEmailPolicy
	summary: ApprovedEmailSummary
	input: EmailAiInput
	dispose: () => void
}
const records = new WeakMap<ApprovedEmailContent, Record>()
// PostalMime 4.0.4 does not use MIME-Version to interpret content. Do not demand
// a signature for it; the evidence view omits it and uses fixed parser defaults.
const interpretations = [
	'content-type',
	'content-transfer-encoding',
	'content-disposition',
	'content-id',
]
function reject(code: string): never {
	throw new Error(code)
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, rejectWork) => {
		const cancel = () => rejectWork(new Error('EMAIL_APPROVAL_CANCELLED'))
		signal.addEventListener('abort', cancel, { once: true })
		work
			.then(resolve, rejectWork)
			.finally(() => signal.removeEventListener('abort', cancel))
		if(signal.aborted) {
			cancel()
		}
	})
}

function claims(
	headers: RawHeader[],
	candidate: CoreDkimCandidate,
	policy: NormalizedEmailPolicy,
	binding: TrustedEmailBinding,
	observer?: EmailCheckObserver,
) {
	let step: EmailCheckStep = 'signed_headers'
	try {
		for(const name of ['from', 'to', 'date']) {
			if(headers.filter((h) => h.name === name).length !== 1) {
				reject('PROOF_METADATA_NOT_AUTHENTICATED')
			}
		}

		for(const name of ['from', 'to', 'date']) {
			if(candidate.headers.filter((h) => h.name === name).length !== 1) {
				reject('PROOF_METADATA_NOT_AUTHENTICATED')
			}
		}

		for(const name of interpretations) {
			const count = headers.filter((h) => h.name === name).length
			if(
				count > 1 ||
				(count && !candidate.headers.some((h) => h.name === name))
			) {
				reject('PROOF_CONTENT_NOT_AUTHENTICATED')
			}
		}

		if(
			candidate.coveredBytes < 0 ||
			candidate.coveredBytes !== candidate.totalBytes
		) {
			reject('PROOF_CONTENT_NOT_AUTHENTICATED')
		}

		if(candidate.status.testing) {
			reject('PROOF_TESTING_KEY')
		}

		reportEmailCheck(observer, {
			step,
			status: 'passed',
			details: {
				fullBodyCoverage: true,
				headers: ['from', 'to', 'date', ...interpretations],
			},
		})
		step = 'sender'
		if(
			!policy.allowedDkimSigningDomains.some((domain) => matchesEmailDomain(domain, candidate.signature.signingDomain),
			)
		) {
			reject('SIGNER_NOT_ACCEPTED')
		}

		const from = normalizeEmailMailbox(
			exactlyOneMailbox(oneHeader(candidate.headers, 'from')),
		)
		if(!matchesEmailSender(policy.sender, from)) {
			reject('SENDER_NOT_ACCEPTED')
		}

		reportEmailCheck(observer, {
			step,
			status: 'passed',
			details: { senderAccepted: true, signerAccepted: true },
			privateDetails: { from, signer: candidate.signature.signingDomain },
		})
		step = 'recipient'
		const toHeader = oneHeader(candidate.headers, 'to')
		const recipients = addressParser(toHeader)
		if(!recipients.length || /,\s*(?:,|$)/.test(toHeader)) {
			reject('INVALID_MAILBOX')
		}

		const to = recipients.map((address) => {
			if('group' in address || !address.address) {
				return reject('INVALID_MAILBOX')
			}

			return normalizeEmailMailbox(address.address)
		})
		if(
			!to.includes(binding.accountAddress) ||
			(policy.expectedRecipient &&
				policy.expectedRecipient !== binding.accountAddress)
		) {
			reject('RECIPIENT_NOT_ACCEPTED')
		}

		reportEmailCheck(observer, {
			step,
			status: 'passed',
			details: {
				connectedAccountMatched: true,
				recipientRestriction: !!policy.expectedRecipient,
			},
			privateDetails: { to, account: binding.accountAddress },
		})
		step = 'date'
		const date = parseSignedDate(oneHeader(candidate.headers, 'date'))
		if(!/^\d{4}-/.test(date) || /:60[+-]/.test(date)) {
			reject('EMAIL_DATE_UNSUPPORTED')
		}

		const timestampS = Date.parse(date) / 1000
		if(
			!Number.isSafeInteger(timestampS) ||
			timestampS < -2208988800 ||
			timestampS > 253402300799
		) {
			reject('EMAIL_DATE_UNSUPPORTED')
		}

		if(
			(policy.minEmailDateS !== undefined &&
				timestampS < policy.minEmailDateS) ||
			(policy.maxEmailDateS !== undefined && timestampS > policy.maxEmailDateS)
		) {
			reject('EMAIL_DATE_NOT_ACCEPTED')
		}

		reportEmailCheck(observer, {
			step,
			status: 'passed',
			details: { signedDateAccepted: true },
			privateDetails: { date },
		})
		const display = (name: string) => decodeWords(oneHeader(candidate.headers, name))
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 2048)
		return {
			from,
			to,
			date,
			timestampS,
			fromDisplay: display('from'),
			toDisplay: display('to'),
		}
	} catch(error) {
		reportEmailCheck(observer, {
			step,
			status: 'failed',
			code: emailCheckCode(error, 'EMAIL_APPROVAL_FAILED'),
			details: {},
		})
		throw error
	}
}

async function sources(
	raw: Buffer,
	candidate: CoreDkimCandidate,
	policy: NormalizedEmailPolicy,
	signal: AbortSignal,
	observer?: EmailCheckObserver,
) {
	let step: EmailCheckStep = 'mime'
	const evidence = await canonicalEvidence(raw, candidate)
	const droppedAttachments: {
		id: string
		filename: string
		reason: NonNullable<SourceInventoryEntry['exclusionReason']>
	}[] = []
	const parts: Awaited<ReturnType<typeof parseStrictMime>>['mimeParts'] = []
	try {
		const parsed = await parseStrictMime(
			evidence,
			{
				maxNestingDepth: 20,
				maxHeadersSize: 128 * 1024,
				forceRfc822Attachments: true,
				attachmentEncoding: 'arraybuffer',
			},
			true,
		)
		parts.push(...parsed.mimeParts)
		const files = parts.filter((p) => p.kind === 'attachment')
		if(
			files.length > 20 ||
			files.reduce((n, p) => n + p.bytes.length, 0) > 8 * 1024 * 1024
		) {
			reject('EMAIL_ATTACHMENT_LIMIT')
		}

		const inventory: SourceInventoryEntry[] = parts.map((p, index) => ({
			id: `${p.kind}:${index}`,
			kind: p.kind,
			mimeType: p.mimeType,
			empty: p.bytes.length === 0,
			inScope:
				policy.contentScope === 'body-and-attachments' ||
				(p.kind === 'body'
					? policy.contentScope === 'body-only'
					: policy.contentScope === 'attachments-only'),
			decodedBytes: p.bytes.length,
			...(p.kind === 'attachment'
				? {
					attachmentSha256: sha256(p.bytes),
					filename: (p.filename || `part-${index}`).slice(0, 512),
				}
				: {}),
		}))
		signal.throwIfAborted()
		const input = parts.flatMap((p, index) => inventory[index].inScope || p.kind === 'attachment'
			? [
				{
					...p,
					id: inventory[index].id,
					filename: p.filename || `part-${index}`,
					body: p.kind === 'body',
					inspectOnly: !inventory[index].inScope,
				},
			]
			: [],
		)
		if(!input.length) {
			reject('NO_USABLE_CONTENT')
		}

		reportEmailCheck(observer, {
			step,
			status: 'passed',
			details: {
				parts: parts.length,
				attachments: files.length,
				inScope: input.length,
			},
		})
		step = 'extraction'
		const text = await extractSourceText(input, signal)
		reportEmailCheck(observer, {
			step,
			status: 'returned',
			details: {
				sources: text.map((t) => ({
					id: t.id,
					characters: t.text?.length ?? 0,
					pages: t.pageRanges?.length ?? 0,
					...(t.error ? { code: t.error } : {}),
					...(t.formatError ? { code: t.formatError } : {}),
				})),
			},
		})
		if(text.length !== input.length) {
			reject('CONTENT_COVERAGE_INCOMPLETE')
		}

		for(const entry of inventory) {
			const output = text.find((t) => t.id === entry.id)
			const reason = output?.error ?? output?.formatError
			if(
				entry.kind === 'attachment' &&
				(reason === 'ATTACHMENT_FORMAT_UNSUPPORTED' ||
					reason === 'ATTACHMENT_TEXT_TOO_LARGE')
			) {
				Object.assign(entry, { exclusionReason: reason })
				droppedAttachments.push({
					id: entry.id,
					filename: entry.filename!,
					reason,
				})
				reportEmailCheck(observer, {
					step: 'extraction',
					status: 'omitted',
					code: reason,
					details: { sourceId: entry.id },
					privateDetails: { filename: entry.filename },
				})
				continue
			}
		}

		const approved: EmailSource[] = []
		for(const entry of inventory) {
			const output = text.find((t) => t.id === entry.id)
			if(entry.exclusionReason) {
				continue
			}

			if(
				output?.error === 'ATTACHMENT_TEXT_TOO_LARGE' ||
				output?.formatError === 'ATTACHMENT_TEXT_TOO_LARGE'
			) {
				reject('APPROVED_TEXT_LIMIT')
			}

			if(!entry.inScope) {
				continue
			}

			if(
				!output ||
				output.error ||
				output.formatError ||
				output.text === undefined
			) {
				throw new EmailApprovalError(
					'CONTENT_COVERAGE_INCOMPLETE',
					[],
					output?.error ?? output?.formatError,
				)
			}

			// The worker applies email-text-v1 exactly once, including removal of ONE
			// leading BOM. Reapplying it here would erase a second, meaningful U+FEFF.
			const normalized = output.text
			Object.assign(entry, {
				empty: !normalized.trim(),
				textSha256: sha256(normalized),
			})
			if(!normalized.trim()) {
				if(entry.kind === 'attachment') {
					reject('CONTENT_COVERAGE_INCOMPLETE')
				}

				continue
			}

			approved.push({
				id: entry.id,
				kind: entry.kind,
				text: normalized,
				textSha256: sha256(normalized),
				...(entry.attachmentSha256
					? { attachmentSha256: entry.attachmentSha256 }
					: {}),
				...(output.pageRanges ? { pageRanges: output.pageRanges } : {}),
			})
		}

		if(!approved.length && !droppedAttachments.length) {
			reject('NO_USABLE_CONTENT')
		}

		if(approved.reduce((n, s) => n + s.text.length, 0) > 100_000) {
			reject('APPROVED_TEXT_LIMIT')
		}

		reportEmailCheck(observer, {
			step,
			status: 'passed',
			details: {
				sources: approved.map((s) => ({
					id: s.id,
					kind: s.kind,
					textSha256: s.textSha256,
					...(s.attachmentSha256
						? { attachmentSha256: s.attachmentSha256 }
						: {}),
					characters: s.text.length,
					pages: s.pageRanges?.length ?? 0,
				})),
			},
		})
		return { inventory, approved }
	} catch(error) {
		reportEmailCheck(observer, {
			step,
			status: 'failed',
			code: emailCheckCode(error, 'EMAIL_APPROVAL_FAILED'),
			details: {
				...(error instanceof EmailApprovalError && error.detail
					? { detail: error.detail }
					: {}),
			},
		})
		if(droppedAttachments.length) {
			throw new EmailApprovalError(
				emailCheckCode(error, 'EMAIL_APPROVAL_FAILED'),
				[],
				error instanceof EmailApprovalError ? error.detail : undefined,
				droppedAttachments,
			)
		}

		throw error
	} finally {
		evidence.fill(0)
		for(const part of parts) {
			part.bytes.fill(0)
		}
	}
}

/** Internal dependency seam for synthetic DNS tests. Not exported by the installed package. */
export async function approveWithResolver(
	input: Buffer,
	inputPolicy: NormalizedEmailPolicy,
	inputBinding: TrustedEmailBinding,
	signal: AbortSignal,
	resolver: DnsResolver,
	observer?: EmailCheckObserver,
	acceptedSignature?: EmailProofV1['emailProof']['acceptedDkimSignature'],
): Promise<ApprovedEmailContent> {
	// Snapshot all caller-owned data synchronously, before DNS or any other await.
	if(
		!Buffer.isBuffer(input) ||
		!input.length ||
		input.length > 8 * 1024 * 1024
	) {
		throw new EmailApprovalError('MESSAGE_SIZE')
	}

	const raw = Buffer.from(input)
	let dkim: readonly DkimStatus[] = []
	let retained = false
	try {
		const policy = copyNormalizedPolicy(inputPolicy)
		const binding = copyBinding(inputBinding, policy)
		signal.throwIfAborted()
		const workSignal = AbortSignal.any([
			signal,
			AbortSignal.timeout(Math.min(45_000, binding.expiresAt - Date.now())),
		])
		const headers = inspectHeaders(raw)
		reportEmailCheck(observer, {
			step: 'snapshot',
			status: 'passed',
			details: { bytes: raw.length, headers: headers.length },
		})
		if(headers.filter((h) => h.name === 'dkim-signature').length > 16) {
			reject('DKIM_SIGNATURE_LIMIT')
		}

		const candidates = await abortable(
			evaluateDkim(raw, (name, type) => {
				workSignal.throwIfAborted()
				return resolver(name, type)
			}),
			workSignal,
		)
		dkim = freeze(candidates.map((c) => c.status))
		reportEmailCheck(observer, {
			step: 'dkim',
			status: dkim.some((s) => s.result === 'pass') ? 'passed' : 'failed',
			details: { signatures: dkim },
		})
		workSignal.throwIfAborted()
		const passing = candidates.filter((c) => {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const { headerSha256: _header, ...signature } = c.signature
			return (
				c.status.result === 'pass' &&
				(!acceptedSignature ||
					canonicalJson(signature) === canonicalJson(acceptedSignature))
			)
		})
		if(!passing.length) {
			reject('DKIM_VERIFICATION_FAILED')
		}

		let firstError: unknown
		for(const candidate of passing) {
			try {
				const identity = claims(headers, candidate, policy, binding, observer)
				const content = await sources(
					raw,
					candidate,
					policy,
					workSignal,
					observer,
				)
				workSignal.throwIfAborted()
				const handle = Object.freeze(
					Object.create(null),
				) as ApprovedEmailContent
				const summary = freeze({
					rawEmailSha256: sha256(raw),
					...identity,
					signature: candidate.signature,
					dkim,
					inventory: content.inventory,
					contentScope: policy.contentScope,
					textVersion: policy.textVersion,
					sourceManifest: content.approved.map(
						// eslint-disable-next-line @typescript-eslint/no-unused-vars
						({ text: _text, pageRanges: _pages, ...manifest }) => manifest,
					),
				})
				const projection = freeze({
					params: policy.params,
					instructions: policy.instructions,
					contentScope: policy.contentScope,
					sources: content.approved,
				})
				const dispose = () => {
					raw.fill(0)
					records.delete(handle)
					signal.removeEventListener('abort', dispose)
					clearTimeout(timer)
				}

				const timer = setTimeout(
					dispose,
					Math.min(binding.expiresAt - Date.now(), 2_147_483_647),
				)
				timer.unref()
				signal.addEventListener('abort', dispose, { once: true })
				records.set(handle, {
					raw,
					binding,
					policy,
					summary,
					input: projection,
					dispose,
				})
				retained = true
				reportEmailCheck(observer, {
					step: 'approval',
					status: 'passed',
					details: {
						sources: content.approved.length,
						signatureHeaderIndex: candidate.status.headerIndex,
					},
				})
				return handle
			} catch(error) {
				firstError ??= error
				if(workSignal.aborted) {
					reject('EMAIL_APPROVAL_CANCELLED')
				}
			}
		}

		throw firstError
	} catch(error) {
		const message = error instanceof Error ? error.message : ''
		const code = signal.aborted
			? 'EMAIL_APPROVAL_CANCELLED'
			: /^[A-Z][A-Z_]+$/.test(message)
				? message
				: 'EMAIL_APPROVAL_FAILED'
		reportEmailCheck(observer, {
			step: 'approval',
			status: 'failed',
			code,
			details: {},
		})
		throw new EmailApprovalError(
			code,
			dkim,
			error instanceof EmailApprovalError ? error.detail : undefined,
			error instanceof EmailApprovalError ? error.droppedAttachments : [],
		)
	} finally {
		if(!retained) {
			raw.fill(0)
		}
	}
}

export function approveEmailSnapshot(
	raw: Buffer,
	policy: NormalizedEmailPolicy,
	trustedBinding: TrustedEmailBinding,
	signal: AbortSignal,
	observer?: EmailCheckObserver,
): Promise<ApprovedEmailContent> {
	return approveWithResolver(
		raw,
		policy,
		trustedBinding,
		signal,
		boundedDnsResolver,
		observer,
	)
}

function current(
	handle: ApprovedEmailContent,
	binding: TrustedEmailBinding,
): Record {
	const record = records.get(handle)
	if(!record) {
		throw new EmailApprovalError('INVALID_APPROVAL_HANDLE')
	}

	try {
		if(
			canonicalJson(copyBinding(binding, record.policy)) !==
			canonicalJson(record.binding)
		) {
			throw new Error()
		}
	} catch{
		throw new EmailApprovalError('STALE_EMAIL_APPROVAL')
	}

	return record
}

export function projectApprovedEmail(
	handle: ApprovedEmailContent,
	currentBinding: TrustedEmailBinding,
): EmailAiInput {
	return current(handle, currentBinding).input
}

export function inspectApprovedEmail(
	handle: ApprovedEmailContent,
	currentBinding: TrustedEmailBinding,
): ApprovedEmailSummary {
	return current(handle, currentBinding).summary
}

/** Server-only, explicit defensive copy for future proof construction; never model input. */
export function copyApprovedRawEmail(
	handle: ApprovedEmailContent,
	currentBinding: TrustedEmailBinding,
): Buffer {
	return Buffer.from(current(handle, currentBinding).raw)
}

export function releaseApprovedEmail(handle: ApprovedEmailContent): void {
	const record = records.get(handle)
	if(!record) {
		throw new EmailApprovalError('INVALID_APPROVAL_HANDLE')
	}

	record.dispose()
}
