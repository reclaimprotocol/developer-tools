/**
 * RFC 8785 (JSON Canonicalization Scheme) stringification — object keys sorted
 * recursively, no whitespace, canonical number/string forms. The single source
 * of truth for canonical JSON in the SDK: the attestor `contentHash` binding
 * and provider `context` hashing both use it. Do not reimplement with a sorted
 * `JSON.stringify`.
 */
import { badData } from '@hapi/boom'
import * as canonicalizeMod from 'canonicalize'
import assert from 'node:assert'

// canonicalize ships as a CJS default export; resolve it across interop modes.
const canonicalize = ((canonicalizeMod as { default?: unknown }).default
	?? canonicalizeMod) as (input: unknown) => string | undefined

export function canonicalJson(value: unknown): string {
	const out = canonicalize(value)
	assert(out !== undefined, badData('value is not JSON-serializable'))
	return out
}
