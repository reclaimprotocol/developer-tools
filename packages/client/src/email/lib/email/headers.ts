/* eslint-disable @stylistic/max-len */
export interface RawHeader {
	name: string
	value: string
}

// Inspection only: these bytes are NEVER reserialized or substituted for DKIM input.
export function inspectHeaders(raw: Buffer): RawHeader[] {
	if(!raw.length || raw.length > 10 * 1024 * 1024) {
		throw new Error('MESSAGE_SIZE')
	}

	const boundary = raw.indexOf('\r\n\r\n')
	if(boundary < 0 || boundary > 128 * 1024) {
		throw new Error('INVALID_HEADERS')
	}

	const block = raw.subarray(0, boundary).toString('utf8')
	if(
		/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffd]/.test(block) ||
		/(?<!\r)\n|\r(?!\n)/.test(block)
	) {
		throw new Error('INVALID_HEADERS')
	}

	const headers: RawHeader[] = []
	for(const line of block.split('\r\n')) {
		if(Buffer.byteLength(line) > 998) {
			throw new Error('INVALID_HEADERS')
		}

		if(/^[ \t]/.test(line)) {
			if(!headers.length) {
				throw new Error('INVALID_HEADERS')
			}

			headers[headers.length - 1].value += ' ' + line.trim()
		} else {
			const match = /^([\x21-\x39\x3b-\x7e]+):[ \t]*(.*)$/.exec(line)
			if(!match) {
				throw new Error('INVALID_HEADERS')
			}

			headers.push({ name: match[1].toLowerCase(), value: match[2].trim() })
		}

		if(headers.length > 1000) {
			throw new Error('INVALID_HEADERS')
		}
	}

	return headers
}

export function oneHeader(headers: RawHeader[], name: string): string {
	const values = headers.filter((header) => header.name === name)
	if(values.length !== 1) {
		throw new Error(`AMBIGUOUS_${name.toUpperCase().replaceAll('-', '_')}`)
	}

	return values[0].value
}
