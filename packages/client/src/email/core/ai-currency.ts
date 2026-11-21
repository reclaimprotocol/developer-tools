/* eslint-disable @stylistic/max-len */
import { canonicalEmailNumber } from './ai-decimal.ts'
import { CURRENCY_ALIASES, CURRENCY_NAMES } from './currency-data.ts'

const SPACES = new Set([' ', '\t', '\r', '\n', '\u00a0', '\u202f'])
// A scan instead of /^[\u2026]+|[\u2026]+$/g, which backtracks quadratically on long
// runs of inner whitespace.
const trim = (text: string) => {
	let start = 0
	let end = text.length
	while(start < end && SPACES.has(text[start])) {
		start++
	}

	while(end > start && SPACES.has(text[end - 1])) {
		end--
	}

	return text.slice(start, end)
}

const label = (text: string) => trim(text.normalize('NFKC').replace(/[\u061c\u200e\u200f]/g, '')).replace(
	/[ \t\r\n\u00a0\u202f]+/g,
	' ',
)
const key = (text: string) => label(text).toLowerCase()
const currencies = new Map<string, Set<string>>()
for(const [code, names] of Object.entries(CURRENCY_ALIASES)) {
	for(const name of names) {
		const token = key(name),
			codes = currencies.get(token) ?? new Set<string>()
		codes.add(code)
		currencies.set(token, codes)
	}
}

// ISO codes identify themselves even when a translated label happens to collide.
for(const code of Object.keys(CURRENCY_ALIASES)) {
	currencies.set(key(code), new Set([code]))
}

type CurrencyError = {
	error:
		| 'CURRENCY_LITERAL_UNSUPPORTED'
		| 'CURRENCY_AMBIGUOUS'
		| 'CURRENCY_MARKER_CONFLICT'
		| 'CURRENCY_AMOUNT_INVALID'
		| 'CURRENCY_MISSING'
		| 'MONEY_AMOUNT_AMBIGUOUS'
}
export function normalizeEmailCurrencyCode(
	text: string,
): { value: string } | CurrencyError {
	const codes = currencies.get(key(text))
	if(!codes) {
		return { error: 'CURRENCY_LITERAL_UNSUPPORTED' }
	}

	return codes.size === 1
		? { value: [...codes][0] }
		: { error: 'CURRENCY_AMBIGUOUS' }
}

function units(markers: string[]): { value?: string } | CurrencyError {
	if(!markers.length) {
		return {}
	}

	const sets = markers.map((marker) => currencies.get(key(marker)))
	if(sets.some((set) => !set)) {
		return { error: 'CURRENCY_LITERAL_UNSUPPORTED' }
	}

	const common = [...sets[0]!].filter((code) => sets.every((set) => set!.has(code)),
	)
	if(!common.length) {
		return { error: 'CURRENCY_MARKER_CONFLICT' }
	}

	// Preserve an ambiguous source marker rather than guessing a country/code.
	return { value: common.length === 1 ? common[0] : label(markers[0]) }
}

/** Legacy amount-only transform; retained for explicitly unitless requests. */
export function emailCurrencyAmount(
	text: string,
): { literal: string } | CurrencyError {
	let value = trim(text)
	const negative = value.startsWith('-')
	if(negative) {
		value = value.slice(1)
	}

	const match =
		/^([^\d+\-]*)(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)([^\d]*)$/.exec(value)
	if(!match || (negative && match[2].startsWith('-'))) {
		return { error: 'CURRENCY_AMOUNT_INVALID' }
	}

	const resolved = units([trim(match[1]), trim(match[3])].filter(Boolean))
	if('error' in resolved) {
		return resolved
	}

	return { literal: `${negative ? '-' : ''}${match[2]}` }
}

// Decimal digits used across the requested regions. NFKC also handles fullwidth
// and mathematical digit forms. The source evidence itself is never rewritten.
const zeroes = [
	0x30, 0x660, 0x6f0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6,
	0xd66, 0xde6, 0xe50, 0xed0, 0xf20, 0x1040, 0x1090, 0x17e0, 0x1810, 0x1b50,
	0x1bb0, 0xa9d0, 0xabf0,
]
function digits(text: string): string {
	return text.normalize('NFKC').replace(/\p{Nd}/gu, (char) => {
		const point = char.codePointAt(0)!
		const zero = zeroes.find((start) => point >= start && point < start + 10)
		return zero === undefined ? char : String(point - zero)
	})
}

function priceNumber(text: string): { value: string } | CurrencyError {
	const raw = digits(trim(text))
		.replace(/[\u00a0\u202f]/g, ' ')
		.replace(/’/g, "'")
	const negative = raw.startsWith('-'),
		unsigned = negative ? raw.slice(1) : raw
	const valid = new Set<string>()
	// Enumerate interpretations instead of inferring a locale from currency or
	// sender. A single 1,234 / 1.234 is ambiguous; 1,234.50 / 1.234,50 is not.
	for(const decimal of ['', '.', ',', '٫']) {
		const pieces = decimal ? unsigned.split(decimal) : [unsigned]
		if(decimal && (pieces.length !== 2 || !/^\d+$/.test(pieces[1]))) {
			continue
		}

		const whole = pieces[0],
			separators = [...new Set(whole.replace(/\d/g, ''))]
		if(
			separators.length > 1 ||
			(separators.length && ![',', '.', ' ', "'", '٬'].includes(separators[0]))
		) {
			continue
		}

		if(!separators.length) {
			if(!/^\d+$/.test(whole)) {
				continue
			}
		} else {
			const groups = whole.split(separators[0])
			const western =
				/^[1-9]\d{0,2}$/.test(groups[0]) &&
				groups.slice(1).every((g) => /^\d{3}$/.test(g))
			const indian =
				/^[1-9]\d?$/.test(groups[0]) &&
				groups.length >= 3 &&
				/^\d{3}$/.test(groups.at(-1)!) &&
				groups.slice(1, -1).every((g) => /^\d{2}$/.test(g))
			if(!western && !indian) {
				continue
			}
		}

		const normalized = canonicalEmailNumber(
			`${negative ? '-' : ''}${whole.replace(/[,.' ٬]/g, '')}${decimal ? `.${pieces[1]}` : ''}`,
		)
		if(normalized !== undefined) {
			valid.add(normalized)
		}
	}

	if(!valid.size) {
		return { error: 'CURRENCY_AMOUNT_INVALID' }
	}

	if(valid.size > 1) {
		return { error: 'MONEY_AMOUNT_AMBIGUOUS' }
	}

	return { value: [...valid][0] }
}

/** Combined, currency-preserving result; optional unit text has its own evidence. */
export function normalizeEmailMoney(
	text: string,
	currencyText?: string,
): { value: string } | CurrencyError {
	let value = trim(text)
	const negative = value.startsWith('-')
	if(negative) {
		value = value.slice(1)
	}

	const match =
		/^([^\p{Nd}+\-]*)(-?\p{Nd}[\p{Nd}.,'’٫٬ \t\r\n\u00a0\u202f]*)([^\p{Nd}]*)$/u.exec(
			value,
		)
	if(!match || (negative && match[2].startsWith('-'))) {
		return { error: 'CURRENCY_AMOUNT_INVALID' }
	}

	const markers = [
		trim(match[1]),
		trim(match[3]),
		currencyText === undefined ? '' : trim(currencyText),
	].filter(Boolean)
	if(!markers.length) {
		return { error: 'CURRENCY_MISSING' }
	}

	const currency = units(markers)
	if('error' in currency) {
		return currency
	}

	const amount = priceNumber(`${negative ? '-' : ''}${trim(match[2])}`)
	if('error' in amount) {
		return amount
	}

	return { value: `${currency.value} ${amount.value}` }
}

const catalogue = Object.entries(CURRENCY_NAMES)
	.map(([code, name]) => `${code}=${name}`)
	.join('; ')
export const EMAIL_CURRENCY_TRANSFORM_DESCRIPTION = `For ordinary requests such as "find the price", "find the cost", "find the total" or "find the amount", default to money and include the stated currency with the amount in the SAME field. This applies even if the task has minor typos; no special SDK flags or separate currency field are needed. Return CODE amount (e.g. GBP 123.5) when the source identifies one currency; retain an ambiguous source marker (e.g. $ 123.5, never guessed USD) otherwise. If no currency is stated, use number and do not invent a unit. Never silently strip a stated unit from a general monetary request. Use the legacy currency transform (amount only) only when the caller explicitly requests a numeric value without its currency; currency-code is for an explicit request for the currency identity alone.
For money select the whole price, including its marker(s), as valueText. When a currency is stated separately (e.g. a table header or another part of the document), select the amount as valueText and add evidence.currency with its own sourceId, page, quoteBefore, valueText, quoteAfter (no transform). Select the complete currency label alone there; include context proving it applies to this same price. Both pieces must be in approved sources. Do not use another transaction's currency, exchange-rate examples, advertisements, or field names. Omit evidence.currency when the inline price already supplies the unit. The validator checks both exact quotes/pages/hashes, combines the literals itself, and rejects conflicting units or an invented combined value.
money normalizes exact decimal strings without arithmetic, rounding or exchange-rate conversion. Decimal dot/comma/Arabic decimal separator, consistent western or Indian grouping (comma, dot, spaces, apostrophe or Arabic grouping separator), and common regional decimal digits are accepted ONLY when they yield one numeric value. Mixed decimal/group conventions are distinguished by syntax, not locale guessing. A single 1,234 or 1.234 can be ambiguous: preserve the complete original price with verbatim rather than guessing or dropping the unit; if the caller requires an unambiguous normalized number, return insufficient. Values such as 1,234.50, 1.234,50, 1 234,50 and 1,23,456.78 are unambiguous. A minus may precede the unit or amount but not both. Unknown currency labels/unsupported price syntax must retain the complete source price with verbatim if permitted, not invent an ISO code. currency-code requires one unambiguous code; otherwise preserve the original with verbatim if permitted or return insufficient.
The pinned ISO/Unicode catalogue covers current currencies in Europe, the Americas and Asia (including Central America and the Caribbean), using ISO codes, full currency names and localized names/symbols from 33 languages. Case, Unicode compatibility forms and label whitespace are normalized. Colliding symbols/names are deliberately ambiguous globally. A currency code must come from evidence, never the sender/account country. Supported code/name catalogue: ${catalogue}. The legacy currency transform retains decimal-dot/comma-grouped number rules; it may strip supported markers but cannot convert currencies.`
