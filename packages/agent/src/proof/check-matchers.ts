/**
 * Offline matcher check: run a recipe's `responseRedactions` +
 * `responseMatches` against a captured response with attestor-core's own HTTP
 * provider, without a network call or a TLS session.
 *
 * It replays the two halves of a real proof on a synthetic transcript:
 *   1. prover side: `providers.http.createRequest` builds the request and
 *      `getResponseRedactions` picks the response slices to reveal (xPath /
 *      jsonPath / regex, exactly as at proof time);
 *   2. attestor side: `providers.http.assertValidProviderReceipt` checks the
 *      redacted transcript against `responseMatches` and extracts params.
 *
 * Hashed (OPRF) slices stay in plaintext here: OPRF needs the attestor, so the
 * check treats the value as its own nullifier. Everything else is the same
 * engine the attestor runs.
 */
import {
	CURRENT_ATTESTOR_VERSION,
	type Logger,
	PROVIDER_CTX,
	providers,
	type RedactedOrHashedArraySlice,
	redactSlices,
} from '@reclaimprotocol/attestor-core'
// Side-effect: make external domhandler nodes DOM-like so attestor-core's
// bundled `xpath` accepts them (see patch-domhandler.ts).
import './patch-domhandler.ts'
import { LOGGER } from '../logger.ts'
import type { CapturedRequest, ReclaimProvider } from '../provider/schema.ts'
import { buildHttpParams } from './proof-core.ts'

/** Longest revealed slice returned; the full slice is still checked. */
const MAX_SLICE_CHARS = 400
/** Most revealed slices returned. */
const MAX_SLICES = 10
/** Longest error message returned (attestor errors can embed the base64 of
 *  a whole element). */
const MAX_REASON_CHARS = 600

export interface RevealedSlice {
	/** Byte offsets in the response body. */
	from: number
	to: number
	/** Revealed text, truncated to {@link MAX_SLICE_CHARS}. */
	text: string
	/** Set when the slice is an OPRF-hashed value (plaintext here). */
	hashed?: true
}

export interface MatcherCheckResult {
	/** True when the attestor would accept this response. */
	ok: boolean
	/** Where it failed: building the request, selecting what to reveal, or
	 *  checking `responseMatches` on the revealed bytes. */
	failedAt?: 'request' | 'redaction' | 'match'
	/** Attestor-core's error, truncated. */
	reason?: string
	/** Params the attestor would extract (regex groups + `paramValues` the
	 *  matches use). */
	extractedParameters: Record<string, string>
	/** The response body slices revealed to the attestor. */
	revealed: RevealedSlice[]
	revealedSliceCount: number
	revealedBytes: number
	bodyBytes: number
	/** Set when an OPRF-hashed redaction was checked in plaintext. */
	note?: string
}

/** Placeholder secret header: the request builder needs one secret, and the
 *  check never sends the request. */
const OFFLINE_SECRET = { 'X-Reclaim-Offline-Check': '1' }

/**
 * Check `provider`'s matchers against `captured`'s response body, offline.
 * Uses the captured status and content type, so a non-2xx capture fails the
 * same way it would at proof time.
 */
export function checkMatchersOffline(
	provider: ReclaimProvider,
	captured: Pick<CapturedRequest, 'status' | 'contentType' | 'responseBody'>,
): MatcherCheckResult {
	const http = providers.http
	const params = buildHttpParams(provider)
	const logger = silentLogger()
	const body = Buffer.from(captured.responseBody ?? '', 'utf8')
	const head = Buffer.from(
		`HTTP/1.1 ${captured.status} ${captured.status < 300 ? 'OK' : 'ERR'}\r\n`
		+ `Content-Type: ${captured.contentType || 'text/plain'}\r\n`
		+ `Content-Length: ${body.length}\r\n\r\n`,
	)
	const response = new Uint8Array(Buffer.concat([head, body]))
	const empty = {
		extractedParameters: {},
		revealed: [],
		revealedSliceCount: 0,
		revealedBytes: 0,
		bodyBytes: body.length,
	}

	let request: Uint8Array
	try {
		const req = http.createRequest(
			{ headers: OFFLINE_SECRET }, structuredClone(params), logger,
		)
		const data = typeof req.data === 'string'
			? new Uint8Array(Buffer.from(req.data))
			: req.data
		request = redactSlices(data, req.redactions)
	} catch(err) {
		return { ...empty, ok: false, failedAt: 'request', reason: reasonOf(err) }
	}

	let slices: RedactedOrHashedArraySlice[]
	try {
		slices = http.getResponseRedactions?.({
			response, params: structuredClone(params), logger, ctx: PROVIDER_CTX,
		}) ?? []
	} catch(err) {
		return { ...empty, ok: false, failedAt: 'redaction', reason: reasonOf(err) }
	}

	const hidden = slices.filter((s) => !s.hash)
	const hashed = slices.filter((s) => s.hash)
	const view = revealedSlices(head.length, response.length, hidden, hashed)
	const redacted = redactSlices(response, hidden)
	const seen = {
		revealed: view.slice(0, MAX_SLICES).map((s) => ({
			from: s.from,
			to: s.to,
			text: truncate(
				Buffer.from(response.subarray(head.length + s.from, head.length + s.to))
					.toString('utf8'),
				MAX_SLICE_CHARS,
			),
			...(s.hashed ? { hashed: true as const } : {}),
		})),
		revealedSliceCount: view.length,
		revealedBytes: view.reduce((n, s) => n + s.to - s.from, 0),
		bodyBytes: body.length,
		...(hashed.length
			? {
				note: 'OPRF-hashed values were checked in plaintext; at proof time '
					+ 'the attestor sees their nullifier instead.',
			}
			: {}),
	}

	try {
		const out = http.assertValidProviderReceipt({
			clientVersion: CURRENT_ATTESTOR_VERSION,
			receipt: [
				{ sender: 'client', message: request },
				{ sender: 'server', message: redacted },
			],
			params: structuredClone(params),
			logger,
			ctx: PROVIDER_CTX,
		})
		// The http provider validates synchronously; a thenable here would mean
		// a provider we don't run offline.
		const extracted = out instanceof Promise ? undefined : out
		return {
			ok: true,
			extractedParameters: extracted?.extractedParameters ?? {},
			...seen,
		}
	} catch(err) {
		return {
			ok: false,
			failedAt: 'match',
			reason: reasonOf(err),
			extractedParameters: {},
			...seen,
		}
	}
}

/** Body-relative revealed ranges: the complement of `hidden` within the body,
 *  merged with the hashed slices (revealed as their nullifier at proof time).
 */
function revealedSlices(
	bodyStart: number,
	total: number,
	hidden: RedactedOrHashedArraySlice[],
	hashed: RedactedOrHashedArraySlice[],
): { from: number, to: number, hashed?: true }[] {
	const out: { from: number, to: number, hashed?: true }[] = []
	let cursor = bodyStart
	const sorted = [...hidden].sort((a, b) => a.fromIndex - b.fromIndex)
	for(const s of sorted) {
		if(s.fromIndex > cursor) {
			out.push({ from: cursor - bodyStart, to: s.fromIndex - bodyStart })
		}

		cursor = Math.max(cursor, s.toIndex)
	}

	if(cursor < total) {
		out.push({ from: cursor - bodyStart, to: total - bodyStart })
	}

	for(const h of hashed) {
		out.push({
			from: h.fromIndex - bodyStart, to: h.toIndex - bodyStart, hashed: true,
		})
	}

	return out
		.filter((s) => s.to > s.from && s.from >= 0)
		.sort((a, b) => a.from - b.from)
}

function reasonOf(err: unknown): string {
	return truncate(err instanceof Error ? err.message : String(err),
		MAX_REASON_CHARS)
}

function truncate(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max)}… (${s.length} chars)` : s
}

/** A logger for attestor-core calls that records nothing: the check reports
 *  its outcome in the result, and the provider logs whole responses. */
function silentLogger(): Logger {
	return LOGGER.child({ scope: 'check-matchers' }, { level: 'silent' })
}
