/** Return all string variants of `value` that might appear in a response
 *  body. Used by find_requests_containing to do server-side substring search
 *  without forcing the caller to guess the encoding. */
export function normalizeCandidates(value: string): string[] {
	const out = new Set<string>()
	const trimmed = value.trim()
	out.add(trimmed)

	const asciiDigits = toAsciiDigits(trimmed)
	if(asciiDigits !== trimmed) {
		out.add(asciiDigits)
	}

	// Comma-grouped numbers: "1,247" -> "1247"
	const dedup = asciiDigits.replace(/,/g, '')
	if(dedup !== asciiDigits) {
		out.add(dedup)
	}

	// k/M/B-suffixed display numbers: "1.2k" -> integer range
	const suffixMatch = asciiDigits.match(/^(\d+(?:\.\d+)?)\s*([kKmMbB])$/)
	if(suffixMatch) {
		const base = parseFloat(suffixMatch[1])
		const mult = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9 }[
			suffixMatch[2]
		]!
		const center = base * mult
		// Display rounds: "1.2k" came from anything 1150..1249.
		const window = mult / 10 ** (suffixMatch[1].split('.')[1]?.length ?? 0) / 2
		for(
			let n = Math.ceil(center - window);
			n < Math.ceil(center + window);
			n++
		) {
			out.add(String(n))
		}
	}

	// JSON-encoded + percent-encoded variants of every existing candidate.
	for(const c of [...out]) {
		out.add(JSON.stringify(c))
		out.add(encodeURIComponent(c))
		out.add(encodeURIComponent(JSON.stringify(c)))
	}

	return [...out]
}

function toAsciiDigits(s: string): string {
	return s.replace(/[\p{Nd}]/gu, (ch) => {
		const code = ch.codePointAt(0)!
		// Find the zero of this digit's block: digit value = code - blockZero.
		// Walk back at most 9 codepoints to find it.
		for(let i = 0; i <= 9; i++) {
			const candidate = String.fromCodePoint(code - i)
			if(/^\p{Nd}$/u.test(candidate)) {
				continue
			}

			return String(i - 1)
		}

		return ch
	})
}
