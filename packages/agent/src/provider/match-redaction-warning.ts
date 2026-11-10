/**
 * Non-blocking advisory for a request whose `responseMatches` count is less
 * than its `responseRedactions` count.
 *
 * Some verification clients (notably the InApp SDK) pair the two arrays by
 * index and may not behave correctly when there are fewer matches than
 * redactions. This is NOT enforced — the author keeps full control over what
 * they publish in either old-devtools or builder mode. The tools surface these
 * strings so the dev can make an informed decision (for example, add a
 * functional match per redaction) rather than being blocked.
 */

/** One request's match/redaction counts, with a human label for the message. */
export interface RequestCounts {
	label: string
	matchCount: number
	redactionCount: number
}

/** Build advisory warnings for any request with matchCount < redactionCount.
 *  Returns an empty array when everything is fine. */
export function matchRedactionWarnings(requests: RequestCounts[]): string[] {
	const warnings: string[] = []
	for(const req of requests) {
		if(req.matchCount < req.redactionCount) {
			warnings.push(
				`${req.label}: ${req.matchCount} response match(es) but ` +
				`${req.redactionCount} response redaction(s). Some verification ` +
				'clients (for example, the InApp SDK) may not work correctly when ' +
				'responseMatches is shorter than responseRedactions — they pair the ' +
				'two by index. This is allowed; add a functional match per redaction ' +
				'if you hit verification issues.',
			)
		}
	}

	return warnings
}

/** Counts for a single drafted request shape (provider or injected request). */
export function countsFor(
	label: string,
	req: {
		responseMatches?: unknown[]
		responseRedactions?: unknown[]
	},
): RequestCounts {
	return {
		label,
		matchCount: req.responseMatches?.length ?? 0,
		redactionCount: req.responseRedactions?.length ?? 0,
	}
}
