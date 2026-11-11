import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { elementAnchor } from '../src/provider/dom-xpath.ts'

// The anchor scorer ranks every VERIFIED candidate by how likely its identifier
// is to survive a future render (shape-based, framework-agnostic), so a
// generated id self-demotes below a semantic class, a hashed/opaque anchor
// below a positional path, and so on. Every candidate here already resolves
// uniquely on this snapshot; the test pins WHICH durable one is chosen.

describe('elementAnchor — durability scoring', () => {
	it('prefers a semantic class over a generated ancestor id', () => {
		// `id="ember123"` is unique now but per-render generated; the value's own
		// semantic class is the durable anchor.
		const html = '<html><body><div id="ember123">'
			+ '<span class="user-name">Alex</span></div></body></html>'
		const a = elementAnchor(html, ['Alex'])
		assert.equal(a?.xPath, '//span[contains(@class, "user-name")]')
	})

	it('demotes a colon id (React useId / Radix) below a semantic class', () => {
		const html = '<html><body><div id=":r7:">'
			+ '<span class="display-name">Bob</span></div></body></html>'
		const a = elementAnchor(html, ['Bob'])
		assert.equal(a?.xPath, '//span[contains(@class, "display-name")]')
	})

	it('falls back to a positional path over a hashed/opaque class', () => {
		// `css-1a2b3c` is a build-hashed class — no semantic content; a positional
		// path is more likely to survive than that class.
		const html = '<html><body><main>'
			+ '<div class="css-1a2b3c">Val</div></main></body></html>'
		const a = elementAnchor(html, ['Val'])
		assert.ok(
			a?.xPath.startsWith('/html'),
			`expected an absolute positional path, got ${a?.xPath}`,
		)
	})

	it('prefers a purpose-built data-testid over an ancestor id', () => {
		const html = '<html><body><div id="settings-header">'
			+ '<span data-testid="full-name">Dana</span></div></body></html>'
		const a = elementAnchor(html, ['Dana'])
		assert.equal(a?.xPath, '//span[@data-testid="full-name"]')
	})

	it('prefers a stable ancestor id over the element\'s utility class', () => {
		// The github/settings shape — the durable pick is the ancestor id.
		const html = '<html><body><h1 id="settings-header">'
			+ '<a class="color-fg-default">Alex'
			+ '<span class="color-fg-muted">(u)</span></a></h1></body></html>'
		const a = elementAnchor(html, ['Alex'])
		assert.equal(a?.xPath, '//h1[@id="settings-header"]/a[1]')
	})
})
