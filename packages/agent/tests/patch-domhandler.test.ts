import { Element } from 'domhandler'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import '../src/proof/patch-domhandler.ts'

// Guards the workaround for attestor-core's bundled-domhandler bug: the
// external `domhandler` (used by parse5-htmlparser2-tree-adapter to build the
// tree) must carry the DOM-compat shape the `xpath` engine checks, or every
// xPath response redaction throws "Context node does not appear to be a valid
// DOM node" at proof time. See src/proof/patch-domhandler.ts.
describe('domhandler DOM-compat patch', () => {
	it('gives nodes a string nodeName/localName', () => {
		// nodeName/localName are added at runtime by the patch, so the
		// static Element type doesn't carry them — same reason as the
		// `attributes` cast below.
		const el = new Element('script', { id: 'client-env' }) as
			Element & { nodeName?: string, localName?: string }
		assert.equal(el.nodeName, 'script')
		assert.equal(el.localName, 'script')
	})

	it('gives the attributes NamedNodeMap an item() → DOM attribute node', () => {
		const el = new Element('script', { id: 'client-env' })
		const attrs = el.attributes as { item?: (i: number) => unknown }
		assert.equal(typeof attrs.item, 'function')
		const attr = attrs.item!(0) as { nodeType: number, localName: string }
		assert.equal(attr.nodeType, 2)
		assert.equal(attr.localName, 'id')
	})
})
