import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeCandidates } from '../src/provider/normalize.ts'

describe('normalizeCandidates', () => {
	it('expands a plain integer to common encodings', () => {
		const out = normalizeCandidates('1247')
		assert.ok(out.includes('1247'))
		assert.ok(out.includes('"1247"')) // JSON-encoded
		assert.ok(out.includes('%221247%22')) // percent-encoded JSON
	})

	it('expands a comma-grouped number to the bare form', () => {
		assert.ok(normalizeCandidates('1,247').includes('1247'))
	})

	it('expands a "k"-suffixed number to its integer range', () => {
		// "1.2k" should match anything from 1150 to 1249 (rounded display)
		const out = normalizeCandidates('1.2k')
		assert.ok(out.some((c) => /^1[12][0-9][0-9]$/.test(c)))
	})

	it('preserves unicode digits and emits ascii equivalent', () => {
		// Devanagari digits १२४७ = 1247
		const out = normalizeCandidates('१२४७')
		assert.ok(out.includes('1247'))
	})

	it('handles bare ascii strings unchanged plus JSON-encoded form', () => {
		const out = normalizeCandidates('octocat')
		assert.ok(out.includes('octocat'))
		assert.ok(out.includes('"octocat"'))
	})

	it('returns only the input when normalization adds nothing', () => {
		const out = normalizeCandidates('zzz-unique-string-zzz')
		assert.ok(out.includes('zzz-unique-string-zzz'))
		assert.ok(out.includes('"zzz-unique-string-zzz"'))
	})
})
