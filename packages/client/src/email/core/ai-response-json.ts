/* eslint-disable @stylistic/max-len */
/** Provider envelopes echo JSON schemas, which are deeper than model answers.
 * Keep this transport-only bound separate from strictJson's signed-data limits.
 */
import { visit } from 'jsonc-parser'
export const EMAIL_AI_RESPONSE_BYTES = 524_288
const MAX_DEPTH = 64
const forbidden = new Set(['__proto__', 'constructor', 'prototype'])
const invalidUnicode =
	/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u
export function parseEmailAiResponseJson(text: string): unknown {
	const reject = (): never => {
		throw new Error('INVALID_AI_RESPONSE_JSON')
	}

	if(Buffer.byteLength(text, 'utf8') > EMAIL_AI_RESPONSE_BYTES) {
		reject()
	}

	const containers: (Set<string> | null)[] = []
	const begin = (keys: Set<string> | null) => {
		if(containers.length >= MAX_DEPTH) {
			reject()
		}

		containers.push(keys)
	}

	visit(
		text,
		{
			onObjectBegin: () => begin(new Set()),
			onArrayBegin: () => begin(null),
			onObjectEnd: () => {
				containers.pop()
			},
			onArrayEnd: () => {
				containers.pop()
			},
			onObjectProperty: (key) => {
				const keys = containers[containers.length - 1]
				if(
					!keys ||
					forbidden.has(key) ||
					keys.has(key) ||
					invalidUnicode.test(key)
				) {
					reject()
				}

				keys!.add(key)
			},
			onLiteralValue: (value) => {
				if(
					(typeof value === 'string' && invalidUnicode.test(value)) ||
					(typeof value === 'number' && !Number.isFinite(value))
				) {
					reject()
				}
			},
			onError: reject,
		},
		{
			disallowComments: true,
			allowTrailingComma: false,
			allowEmptyContent: false,
		},
	)
	// Only JSON text reaches this parser: no getters, class instances or external objects.
	// Duplicate/dangerous keys, invalid Unicode/numbers, size and depth are checked above.
	return JSON.parse(text)
}
