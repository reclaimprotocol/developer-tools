/**
 * `find_requests_containing` — search captured responses for any encoding of a
 * value and rank the requests that return it. Authored once as a plain
 * {@link RegisteredTool}; the MCP and cloud loop each pass their own backend
 * resolver (see authoring/tools.ts / shared.ts). Server-side: response bodies
 * stay here, only metadata + a short snippet leave.
 */
import {
	objectSchema,
	publicRequest,
	type ResolveBackend,
} from '../../../authoring/util.ts'
import { normalizeCandidates } from '../../../provider/normalize.ts'
import { defineTool, type RegisteredTool } from '../../../tools/registry.ts'

export function findTool(resolveBackend: ResolveBackend): RegisteredTool {
	return defineTool<Record<string, unknown>>(
		{
			name: 'find_requests_containing',
			description:
				'Searches captured responses for any encoding of `value` (raw, '
				+ 'URL-, JSON-, or HTML-escaped). Returns ranked candidates with the '
				+ 'matched variant, score, and a short snippet, to locate the '
				+ 'request that returns a data point. Also finds split matches: when '
				+ '`value` has several words (for example, a full name) and a '
				+ 'response carries each word in a separate field, the candidate has '
				+ '`splitMatch: true`; prove those per field (one redaction per '
				+ 'part). Response bodies stay server-side.',
			inputSchema: objectSchema(
				{ value: { type: 'string' }, limit: { type: 'number' } },
				['value'],
			),
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async(args) => {
			const backend = resolveBackend(args)
			const value = String(args.value)
			const variants = normalizeCandidates(value)
			// Name-part tokens (≥3 chars) for split-field detection — a JSON API
			// often carries a full name as separate first/last fields, so the whole
			// string never matches even though the value IS there.
			const tokens = value.split(/\s+/).filter((t) => t.length >= 3)
			const snip = (body: string, idx: number, len: number) => {
				const s = Math.max(0, idx - 40)

				return body.slice(s, Math.min(body.length, idx + len + 40))
			}

			const ranked = []
			for(const r of backend.capture.requests.values()) {
				if(!r.responseBody) {
					continue
				}

				const body = r.responseBody
				// Prefer JSON responses + smaller bodies (likely API endpoints).
				const base = (r.contentType.includes('json') ? 10 : 0)
					+ Math.max(0, 5 - Math.log10(Math.max(r.size, 1)))

				let hit: { snippet: string, variant: string } | undefined
				for(const v of variants) {
					const idx = body.indexOf(v)
					if(idx >= 0) {
						hit = { snippet: snip(body, idx, v.length), variant: v }
						break
					}
				}

				if(hit) {
					// Whole-value match — ranked above split matches (+5).
					ranked.push({
						...publicRequest(r),
						matchedVariant: hit.variant,
						snippet: hit.snippet,
						score: base + 5,
					})
					continue
				}

				// Split match: every word present separately (for example, first/last
				// name in distinct JSON fields). Requires ≥2 tokens so it's specific.
				if(tokens.length >= 2 && tokens.every((t) => body.includes(t))) {
					ranked.push({
						...publicRequest(r),
						matchedVariant: `split:${tokens.join('+')}`,
						splitMatch: true,
						snippet: snip(body, body.indexOf(tokens[0]), tokens[0].length),
						score: base,
					})
				}
			}

			ranked.sort((a, b) => b.score - a.score)
			const limit = Number(args.limit) || 10
			return { candidates: ranked.slice(0, limit) }
		},
	)
}
