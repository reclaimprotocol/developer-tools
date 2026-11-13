/* eslint-disable @stylistic/max-len */
/** Exact decimal string normalization; no floating point, rounding or conversion. */
export function canonicalEmailNumber(text: string): string | undefined {
	if(!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) {
		return
	}

	const negative = text.startsWith('-')
	const [whole, fraction = ''] = text
		.replace(/^-/, '')
		.replace(/,/g, '')
		.split('.')
	const integer = whole.replace(/^0+(?=\d)/, '')
	const decimal = fraction.replace(/0+$/, '')
	return `${negative && (integer !== '0' || decimal) ? '-' : ''}${integer}${decimal ? `.${decimal}` : ''}`
}
