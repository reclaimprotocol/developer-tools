/* eslint-disable @stylistic/max-len */
/** Server-only browsing helpers. Gmail metadata is never authenticated evidence. */
import { decodeWords } from 'postal-mime'
import { gmailRequest, GoogleEmailError } from './google.ts'

export interface GmailSummary {
	id: string
	from: string
	to: string
	subject: string
	date: string
}
export interface GmailSearchPosition {
	before: number
	since: number
	pageToken?: string
	pendingIds: string[]
	pending: (GmailSummary & { received: number })[]
	exhausted: boolean
	seen: string[]
	/** Rows still needed for this UI page across progressive responses. */
	pageRemaining?: number
	/** Earliest date permitted for this user-requested page, retained across partial responses. */
	pageFloor?: number
}
export interface GmailSearchPage {
	messages: GmailSummary[]
	position: GmailSearchPosition
	partial: boolean
	hasMore: boolean
	retryAfterMs?: number
}
/** Shared display metadata; verification independently checks the selected raw email. */
export async function gmailSummaryMetadata(
	token: string,
	id: string,
	signal?: AbortSignal,
): Promise<{
	summary: GmailSummary
	received: number
	outgoing: boolean
}> {
	if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
		throw new GoogleEmailError('GOOGLE_REJECTED')
	}

	const params = new URLSearchParams({ format: 'metadata' })
	for(const name of ['From', 'To', 'Subject', 'Date']) {
		params.append('metadataHeaders', name)
	}

	const data = await gmailRequest(token, `/messages/${id}?${params}`, signal)
	if(
		data.labelIds !== undefined &&
		(!Array.isArray(data.labelIds) ||
			data.labelIds.some((label: unknown) => typeof label !== 'string'))
	) {
		throw new GoogleEmailError('GOOGLE_REJECTED')
	}

	const headers = Array.isArray(data.payload?.headers)
		? data.payload.headers
		: []
	const values = (name: string): unknown[] => headers
		.filter(
			(h: { name?: unknown }) => typeof h.name === 'string' && h.name.toLowerCase() === name,
		)
		.map((h: { value?: unknown }) => h.value)
	// Decode display metadata only; summaries never authorize a sender.
	const safe = (name: string) => decodeWords(String(values(name)[0] ?? '').slice(0, 128 * 1024))
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 512)
	return {
		summary: {
			id,
			from: safe('from'),
			to: safe('to'),
			subject: safe('subject'),
			date: safe('date'),
		},
		received: Number(data.internalDate ?? 0),
		outgoing: (data.labelIds ?? []).some(
			(label: string) => label === 'SENT' || label === 'DRAFT',
		),
	}
}

function monthsEarlier(before: number, months: number): number {
	const date = new Date(before * 1000),
		day = date.getUTCDate()
	date.setUTCDate(1)
	date.setUTCMonth(date.getUTCMonth() - months)
	const lastDay = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
	).getUTCDate()
	date.setUTCDate(Math.min(day, lastDay))
	return Math.max(0, Math.floor(date.getTime() / 1000))
}

export const sixMonthsEarlier = (before: number): number => monthsEarlier(before, 6)
export const threeMonthsEarlier = (before: number): number => monthsEarlier(before, 3)
export function initialGmailSearch(now = Date.now()): GmailSearchPosition {
	const before = Math.floor(now / 1000) + 1
	const since = sixMonthsEarlier(before)
	return {
		before,
		since,
		pageFloor: since,
		pageRemaining: 10,
		pendingIds: [],
		pending: [],
		exhausted: false,
		seen: [],
	}
}

export function validateGmailQuery(query: string): string {
	if(
		typeof query !== 'string' ||
		query.length > 500 ||
		/[\x00-\x1f\x7f]/.test(query)
	) {
		throw new Error('EMAIL_QUERY_INVALID')
	}

	const trimmed = query.trim()
	if(trimmed.length === 1) {
		throw new Error('EMAIL_QUERY_TOO_SHORT')
	}

	return trimmed
}

export async function searchGmailOwned(
	token: string,
	query: string,
	previous?: GmailSearchPosition,
	signal?: AbortSignal,
): Promise<GmailSearchPage> {
	query = validateGmailQuery(query)
	const position = previous ? structuredClone(previous) : initialGmailSearch()
	// A partial response continues the same click. Only a completed page starts a
	// new ten-row target with permission to look three calendar months farther back.
	if(previous && !position.pageRemaining) {
		position.pageRemaining = 10
		position.pageFloor = threeMonthsEarlier(position.since)
	}

	position.pageFloor ??= position.since
	const limit = Math.min(
		position.pageRemaining ?? 10,
		500 - position.seen.length,
	)
	const messages: GmailSummary[] = []
	const seen = new Set(position.seen)
	const bounded = AbortSignal.any([
		AbortSignal.timeout(20_000),
		...(signal ? [signal] : []),
	])
	let scanned = 0,
		pages = 0,
		partial = false,
		retryAfterMs: number | undefined
	// Return each recent batch immediately, including any surplus already fetched.
	while(!position.pending.length && limit > 0) {
		signal?.throwIfAborted()
		if(position.exhausted && !position.pendingIds.length) {
			if(position.since <= position.pageFloor) {
				break
			}

			position.before = position.since
			position.since = position.pageFloor
			position.exhausted = false
			delete position.pageToken
		}

		if(scanned >= 50 || pages >= 10 || bounded.aborted) {
			partial = true
			break
		}

		try {
			if(!position.pendingIds.length) {
				// Browse recent mail using only the date window and the user's query.
				// Request sender/signing-domain policies are applied during verification.
				const q = `${query ? `(${query}) ` : ''}-in:sent -in:drafts after:${position.since - 1} before:${position.before}`
				const params = new URLSearchParams({ q, maxResults: '50' })
				if(position.pageToken) {
					params.set('pageToken', position.pageToken)
				}

				const list = await gmailRequest(token, `/messages?${params}`, bounded)
				if(
					list.messages !== undefined &&
					(!Array.isArray(list.messages) || list.messages.length > 50)
				) {
					throw new GoogleEmailError('GOOGLE_REJECTED')
				}

				if(
					list.nextPageToken !== undefined &&
					(typeof list.nextPageToken !== 'string' ||
						!list.nextPageToken.length ||
						list.nextPageToken.length > 2048)
				) {
					throw new GoogleEmailError('GOOGLE_REJECTED')
				}

				position.pendingIds = (list.messages ?? []).map(
					(item: { id?: unknown }) => {
						if(
							typeof item.id !== 'string' ||
							!/^[a-zA-Z0-9_-]{1,128}$/.test(item.id)
						) {
							throw new GoogleEmailError('GOOGLE_REJECTED')
						}

						return item.id
					},
				)
				position.pageToken = list.nextPageToken
				position.exhausted = !list.nextPageToken
				pages++
			}

			const ids = position.pendingIds.slice(0, Math.min(5, limit, 50 - scanned))
			const batch = await Promise.allSettled(
				ids.map(async(id) => {
					if(seen.has(id) || position.pending.some((item) => item.id === id)) {
						return null
					}

					const { summary, received, outgoing } = await gmailSummaryMetadata(
						token,
						id,
						bounded,
					)
					// Enforce message-level direction even if user query operators override
					// the Gmail query. Received replies in a thread containing sent mail stay visible.
					if(
						outgoing ||
						!Number.isSafeInteger(received) ||
						received < position.since * 1000 ||
						received >= position.before * 1000
					) {
						return null
					}

					return { ...summary, received }
				}),
			)
			scanned += ids.length
			let failure: unknown
			// Commit each completed candidate once. Failed IDs remain pending; all workers
			// settle before returning so a continuation cannot overlap abandoned requests.
			const completed = new Set<string>()
			for(const [index, entry] of batch.entries()) {
				if(entry.status === 'rejected') {
					failure ??= entry.reason
					continue
				}

				completed.add(ids[index])
				if(
					entry.value &&
					!position.pending.some((item) => item.id === entry.value!.id)
				) {
					position.pending.push(entry.value)
				}
			}

			position.pendingIds = position.pendingIds.filter(
				(id) => !completed.has(id),
			)
			if(failure) {
				throw failure
			}
		} catch(error) {
			signal?.throwIfAborted()
			if(
				error instanceof GoogleEmailError &&
				error.code === 'GOOGLE_RATE_LIMIT'
			) {
				partial = true
				retryAfterMs = Math.max(1000, error.diagnostic?.retryAfterMs ?? 4000)
				break
			}

			if(
				bounded.aborted ||
				(error instanceof GoogleEmailError &&
					(error.code === 'GOOGLE_TIMEOUT' ||
						(error.code === 'GOOGLE_UNAVAILABLE' &&
							(error.diagnostic?.httpStatus ?? 0) >= 500)))
			) {
				partial = true
				break
			}

			throw error
		}
	}

	position.pending.sort(
		(a, b) => b.received - a.received || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
	)
	while(position.pending.length && messages.length < limit) {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { received: _received, ...summary } = position.pending.shift()!
		if(!seen.has(summary.id)) {
			seen.add(summary.id)
			messages.push(summary)
		}
	}

	position.seen = [...seen]
	const windowRemaining =
		!position.exhausted ||
		!!position.pendingIds.length ||
		!!position.pending.length ||
		position.since > position.pageFloor
	position.pageRemaining = windowRemaining ? limit - messages.length : 0
	// The UI paints each batch and resumes only the current ten-row target. The
	// persisted floor prevents retries/partial responses from widening it again.
	partial ||= position.pageRemaining > 0
	return {
		messages,
		position,
		partial,
		...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
		hasMore:
			seen.size < 500 &&
			(position.since > 0 ||
				!position.exhausted ||
				!!position.pendingIds.length ||
				!!position.pending.length),
	}
}
