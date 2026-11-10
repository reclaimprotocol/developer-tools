// Side-effect module: make `domhandler` nodes DOM-like for the `xpath` engine.
//
// WHY THIS EXISTS
// `@reclaimprotocol/attestor-core`'s published `lib` bundles its own inlined
// copy of `domhandler` and applies a DOM-compat patch (nodeName / localName +
// a NamedNodeMap `item()` shim) to THAT copy. But at proof time the HTML tree
// is built by the *external* `parse5-htmlparser2-tree-adapter`, which uses the
// separately-installed `domhandler` — a different, UNPATCHED copy. The `xpath`
// engine then fails `isNodeLike()` on every node (it needs a string `nodeName`)
// and throws "Context node does not appear to be a valid DOM node", so ALL
// xPath / xPath+jsonPath response redactions fail during `runAttestorProof`'s
// receipt validation. (Regex-only redactions escape it — they never touch the
// parse5/xpath path.) Running attestor-core from source works because there is
// then a single shared `domhandler`; the bug is only in the bundled `lib`.
//
// Rather than fork attestor-core, apply the identical patch to the external
// `domhandler` the adapter actually uses, so its tree nodes are DOM-like. This
// mirrors attestor-core's own `patch-parse5-tree`. Idempotent and
// version-agnostic. Import it before any proving path runs.
//
// Remove once attestor-core externalizes `domhandler` in its build (one shared
// copy → its own patch suffices).
import { Element, Node } from 'domhandler'

const PATCH_FLAG = Symbol.for('reclaim.domhandler.domCompatPatched')
const proto = Node.prototype as unknown as Record<PropertyKey, unknown>

if(!proto[PATCH_FLAG]) {
	// `xpath`'s isNodeLike() requires a string `nodeName`; domhandler nodes carry
	// the tag under `.name`.
	Object.defineProperty(Node.prototype, 'nodeName', {
		configurable: true,
		get(this: { name?: string }) {
			return this.name
		},
	})
	Object.defineProperty(Node.prototype, 'localName', {
		configurable: true,
		get(this: { name?: string }) {
			return this.name
		},
	})

	// Attribute-predicate steps (`[@id=…]`, `contains(@class,…)`) walk the
	// NamedNodeMap via `.item(i)`; give each returned attribute node the DOM
	// shape `xpath` expects (nodeType 2 + localName).
	const attrsGetter =
		Object.getOwnPropertyDescriptor(Element.prototype, 'attributes')?.get
	if(attrsGetter) {
		Object.defineProperty(Element.prototype, 'attributes', {
			configurable: true,
			get(this: unknown) {
				const attrs = attrsGetter.call(this) as
					(Record<number, { name: string }> & {
						item?: (i: number) => unknown
					})
				attrs.item = (i: number) => {
					const attr = attrs[i]
					return { ...attr, nodeType: 2, localName: attr.name }
				}

				return attrs
			},
		})
	}

	proto[PATCH_FLAG] = true
}
