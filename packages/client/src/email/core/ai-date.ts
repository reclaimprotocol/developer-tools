/* eslint-disable @stylistic/max-len */
/** Closed, locale-independent date grammar shared by the prompt and validator. */
export const EMAIL_DATE_TRANSFORM_DESCRIPTION =
	'ISO YYYY-MM-DD; day full-English-month year; numeric year-first YYYY-M-D with consistent -, / or . separators; or numeric year-last A/B/YYYY (also - or .), only when exactly one valid calendar date remains after considering both day/month and month/day order. One- or two-digit month/day and four-digit year are required. Normalize to YYYY-MM-DD. Equal month/day is unambiguous; otherwise, if both orders are valid, do not guess from language, location, sender, field name or other dates. Use verbatim to preserve an ambiguous date when the task permits the original representation, or return insufficient if an exact normalized date is required. Reject impossible dates and two-digit years'
const months = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
]
type DateResult =
	| { value: string }
	| { error: 'DATE_FORMAT_UNSUPPORTED' | 'DATE_INVALID' | 'DATE_AMBIGUOUS' }
function calendarDate(
	year: number,
	month: number,
	day: number,
): string | undefined {
	if(year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) {
		return
	}

	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
	if(
		day >
		[31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
	) {
		return
	}

	return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function normalizeEmailDate(text: string): DateResult {
	const named =
		/^(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})$/.exec(
			text,
		)
	const first = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/.exec(text)
	const last = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})$/.exec(text)
	let candidates: (string | undefined)[]
	if(named) {
		candidates = [
			calendarDate(
				Number(named[3]),
				months.indexOf(named[2]) + 1,
				Number(named[1]),
			),
		]
	} else if(first) {
		candidates = [
			calendarDate(Number(first[1]), Number(first[3]), Number(first[4])),
		]
	} else if(last) {
		candidates = [
			calendarDate(Number(last[4]), Number(last[3]), Number(last[1])),
			calendarDate(Number(last[4]), Number(last[1]), Number(last[3])),
		]
	} else {
		return { error: 'DATE_FORMAT_UNSUPPORTED' }
	}

	const valid = [
		...new Set(
			candidates.filter((value): value is string => value !== undefined),
		),
	]
	if(!valid.length) {
		return { error: 'DATE_INVALID' }
	}

	if(valid.length > 1) {
		return { error: 'DATE_AMBIGUOUS' }
	}

	return { value: valid[0] }
}
