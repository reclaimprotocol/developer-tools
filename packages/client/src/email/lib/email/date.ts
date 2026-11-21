/* eslint-disable @stylistic/max-len */
const MONTHS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec',
]
const ZONES: Record<string, string> = {
	UT: '+0000',
	UTC: '+0000',
	GMT: '+0000',
	EST: '-0500',
	EDT: '-0400',
	CST: '-0600',
	CDT: '-0500',
	MST: '-0700',
	MDT: '-0600',
	PST: '-0800',
	PDT: '-0700',
}

// RFC 5322 sections 3.3 and 4.3. Receivers must also interpret the obsolete
// grammar, including CFWS around tokens and two/three-digit years.
// A marker distinguishes a comment from actual folding whitespace: numeric
// zones require FWS even when adjacent clock tokens use the obsolete syntax.
const CFWS = '[ \\t\\x00]*'
const DATE_TIME = new RegExp(
	`^${CFWS}(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun)${CFWS},${CFWS})?` +
		`(\\d{1,2})${CFWS}(${MONTHS.join('|')})${CFWS}(\\d{2,})${CFWS}` +
		`(\\d{2})${CFWS}:${CFWS}(\\d{2})(?:${CFWS}:${CFWS}(\\d{2}))?` +
		`([ \\t\\x00]*)([+-]\\d{4}|[A-Za-z]+)${CFWS}$`,
	'i',
)

function dateTokens(header: string): string {
	const tokens: string[] = []
	let depth = 0
	for(let i = 0; i < header.length; i++) {
		const char = header[i]
		const code = header.charCodeAt(i)
		if(depth && char === '\\') {
			// quoted-pair also includes the obsolete ASCII escapes (section 4.1).
			if(++i === header.length || header.charCodeAt(i) > 127) {
				throw new Error('INVALID_DATE')
			}
		} else if(char === '(') {
			if(!depth) {
				tokens.push('\x00')
			}

			depth++
		} else if(char === ')') {
			if(!depth) {
				throw new Error('INVALID_DATE')
			}

			depth--
		} else if(char === '\r') {
			if(header[i + 1] !== '\n' || !/[ \t]/.test(header[i + 2] || '')) {
				throw new Error('INVALID_DATE')
			}

			i++ // Unfold CRLF, retaining the following WSP.
		} else if(depth) {
			if(code === 0 || code === 10 || code > 127) {
				throw new Error('INVALID_DATE')
			}
		} else {
			if(!/[A-Za-z0-9,:+\- \t]/.test(char)) {
				throw new Error('INVALID_DATE')
			}

			tokens.push(char)
		}
	}

	if(depth) {
		throw new Error('INVALID_DATE')
	}

	return tokens.join('')
}

export function parseSignedDate(header: string): string {
	const match = DATE_TIME.exec(dateTokens(header))
	if(!match) {
		throw new Error('INVALID_DATE')
	}

	const [
		,
		weekday,
		dayText,
		monthText,
		yearText,
		hourText,
		minuteText,
		secondText = '00',
		zoneWhitespace,
		rawZone,
	] = match
	const month = MONTHS.findIndex(
		(m) => m.toLowerCase() === monthText.toLowerCase(),
	)
	let year = BigInt(yearText)
	if(yearText.length === 2) {
		year += year < 50n ? 2000n : 1900n
	} else if(yearText.length === 3) {
		year += 1900n
	}

	const [day, hour, minute, second] = [
		dayText,
		hourText,
		minuteText,
		secondText,
	].map(Number)
	const numericZone = /^[+-]/.test(rawZone)
	// Section 4.3 treats military and unrecognized alphabetic zones as -0000.
	// J is excluded from the single-letter obsolete-zone grammar.
	if((numericZone && !/[ \t]$/.test(zoneWhitespace)) || /^j$/i.test(rawZone)) {
		throw new Error('INVALID_DATE')
	}

	const zone = numericZone ? rawZone : (ZONES[rawZone.toUpperCase()] ?? '-0000')
	if(month < 0 || year < 1900n || hour > 23 || minute > 59 || second > 60) {
		throw new Error('INVALID_DATE')
	}

	// The RFC bounds zone minutes, but adds no bound on its two hour digits.
	if(Number(zone.slice(3)) > 59) {
		throw new Error('INVALID_DATE')
	}

	const leapYear =
		year % 4n === 0n && (year % 100n !== 0n || year % 400n === 0n)
	const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
	if(day < 1 || day > days[month]) {
		throw new Error('INVALID_DATE')
	}

	// Gregorian weekdays repeat every 400 years. Avoid JavaScript's year/range
	// limits and its special handling of years 0..99 or leap-second values.
	const wall = new Date(0)
	wall.setUTCFullYear(2000 + Number(year % 400n), month, day)
	if(
		weekday &&
		['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
			wall.getUTCDay()
		].toLowerCase() !== weekday.toLowerCase()
	) {
		throw new Error('INVALID_DATE')
	}

	const pad = (n: number) => String(n).padStart(2, '0')
	const outputYear =
		year > 9999n ? `+${year.toString().padStart(6, '0')}` : year.toString()
	// Retain -00:00: the UTC instant is known; the sender's local zone is not.
	return `${outputYear}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${zone.slice(0, 3)}:${zone.slice(3)}`
}
