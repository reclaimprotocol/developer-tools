// Generate a verified xPath to the element holding a target value, using the
// SAME parser the attestor uses (parse5 + parse5-htmlparser2-tree-adapter) and
// self-verifying each candidate with the same `xpath` engine. Because the path
// is built from — and checked against — the attestor's own parse of the raw
// response body, it provably resolves to that element at proof time, on any
// site (no per-endpoint logic, no fragile byte-offset counting).
//
// The domhandler patch makes the tree's nodes DOM-like for `xpath` (see
// patch-domhandler.ts — mirrors attestor-core's patch-parse5-tree).
import { type Element, isTag, isText, type Node } from 'domhandler'
import { parse } from 'parse5'
import { adapter as htmlAdapter } from 'parse5-htmlparser2-tree-adapter'
import xpath from 'xpath'
import '../proof/patch-domhandler.ts'

/** Identifying attributes stable enough to anchor an xPath on (value-bearing
 *  attrs like `content`/`href`/`value` are excluded). */
const IDENT_ATTRS =
	['name', 'property', 'itemprop', 'data-testid', 'rel', 'for']

/** What an xPath candidate anchors on — used to weight its base stability. */
type AnchorKind = 'ident-attr' | 'id' | 'class' | 'positional'

/** One verified xPath option for the target element, tagged with what it
 *  anchors on so it can be scored for FUTURE stability (see
 *  {@link anchorStability}) rather than just "first that resolves". */
interface Candidate {
	xPath: string
	kind: AnchorKind
	/** The identifier the anchor keys on (an id / attr / class value); undefined
	 *  for a purely positional path. */
	token?: string
	/** Ancestor distance from the value element (0 = the element itself or a
	 *  direct-child anchor); larger = higher up. Tie-break nudge only. */
	depth: number
}

/** Base weight by anchor kind: purpose-built test hooks and ids beat classes,
 *  which beat a positional path. Modulated by {@link tokenQuality}. */
const TYPE_WEIGHT: Record<AnchorKind, number> = {
	'ident-attr': 0.95,
	id: 0.9,
	class: 0.6,
	positional: 0.3,
}

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * How likely an identifier token is to survive a future render, by its SHAPE —
 * framework-agnostic, so it catches generated ids/classes from any tool (this
 * year's or next) without naming them. Returns `[0.02, 1]`.
 *
 * Volatile shapes (machine-generated): a `:` (React `useId` `:r1:`, Radix), a
 * UUID, digit-heavy or trailing-digit tokens (`ember123`, `tab-2`), hex/hash
 * runs (`css-1a2b3c`), or opaque wordless strings. Durable shapes (human
 * authored): real word segments, kebab/snake of words (`settings-header`,
 * `primary_email_select`).
 */
function tokenQuality(token: string): number {
	const t = token.trim()
	if(!t) {
		return 0.3
	}

	// Kill signals — these tokens are (almost) always per-render generated.
	if(t.includes(':') || UUID_RE.test(t)) {
		return 0.05
	}

	let q = 1
	const len = t.length
	const digits = (t.match(/\d/g) ?? []).length
	const digitRatio = digits / len
	// A trailing digit run after letters is the classic generated-id tail.
	if(/[A-Za-z][-_]?\d+$/.test(t)) {
		q *= 0.3
	}

	if(digitRatio > 0.3) {
		q *= 0.4
	} else if(digitRatio > 0.15) {
		q *= 0.7
	}

	// A pure hex/short-hash run (`1a2b3c`, `deadbeef`) — no semantic content.
	if(/^[0-9a-f]{6,}$/i.test(t)) {
		q *= 0.15
	}

	// A real word — an alpha run ≥3 that ITSELF contains a vowel — is the
	// strongest durability signal; its absence means the token is opaque /
	// hash-like (`css-1a2b3c`, `sc-bdfBwQ`). Checking per-segment matters: a
	// stray vowel elsewhere in a hash must not count as "has a word".
	const hasWord = (t.match(/[A-Za-z]+/g) ?? [])
		.some((run) => run.length >= 3 && /[aeiou]/i.test(run))
	if(!hasWord) {
		q *= 0.3
	}

	if(len > 40) {
		q *= 0.6
	}

	return Math.max(0.02, Math.min(1, q))
}

/** Stability score for a candidate: base weight for its kind × the shape
 *  quality of its identifier, minus a small depth nudge so a nearer/shorter
 *  anchor wins an otherwise-tie. Positional paths score on kind alone. */
function anchorStability(c: Candidate): number {
	const base = TYPE_WEIGHT[c.kind]
	const quality = c.kind === 'positional' ? 1 : tokenQuality(c.token ?? '')
	const depthNudge = 1 - Math.min(c.depth, 8) * 0.01
	return base * quality * depthNudge
}

export interface DomAnchor {
	xPath: string
	/** Byte range of the element in the source html (parse5 source locations),
	 *  matching the slice the attestor reveals for this xPath. */
	start: number
	end: number
}

/**
 * A verified xPath to the tightest element containing one of `targets`, or
 * undefined if the value isn't present in the parsed tree. Prefers a short
 * stable selector (unique id → identifying attr → class), falling back to an
 * absolute child-indexed path (`/html[1]/body[1]/…/option[1]`). Every candidate
 * is checked with the real `xpath` engine and only returned if it resolves,
 * first-match, to that exact element.
 */
export function elementAnchor(
	html: string,
	targets: string[],
): DomAnchor | undefined {
	let doc: unknown
	try {
		doc = parse(html, {
			treeAdapter: htmlAdapter,
			sourceCodeLocationInfo: true,
		})
	} catch{
		return undefined
	}

	// `xpath` needs a named root node to start from (as attestor-core does).
	;(doc as { name: string }).name = 'root'

	const el = findElement(doc as Node, targets)
	if(!el) {
		return undefined
	}

	const { startIndex, endIndex } = el
	if(startIndex === null || endIndex === null) {
		return undefined
	}

	// Score EVERY candidate that provably resolves (first-match, uniquely) to the
	// target, and take the most durable — not merely the first that resolves.
	// Because each survivor already matches uniquely NOW, the choice only trades
	// on FUTURE stability; it can never pick a wrong/non-resolving node.
	const verified = [...candidateXPaths(el)]
		.map((c, i) => ({ c, i }))
		.filter(({ c }) => matchesUniquely(doc, c.xPath, el))
	if(!verified.length) {
		return undefined
	}

	verified.sort((a, b) => {
		return anchorStability(b.c) - anchorStability(a.c) ||
			a.c.depth - b.c.depth ||
			a.i - b.i
	})
	// `[startIndex, endIndex)` is exactly the slice the attestor reveals for this
	// xPath (its getNodeRange uses these same parse5 source locations).
	return { xPath: verified[0].c.xPath, start: startIndex, end: endIndex }
}

/** The tightest element that DIRECTLY holds a target. Prefers a COMPLETE-value
 *  occurrence — an attribute whose value IS the target, or a text child that IS
 *  the target — over one where the target is merely embedded in a longer string
 *  (for example, a userid inside a `1234567+user@…` noreply address). The
 *  complete field is the semantic source and yields a portable anchor; the
 *  embedded one is incidental. Smallest byte span wins within the chosen
 *  tier. */
function findElement(root: Node, targets: string[]): Element | undefined {
	const complete: Element[] = []
	const embedded: Element[] = []

	const walk = (node: Node) => {
		if(isTag(node)) {
			const el = node
			const texts = el.children.filter(isText).map((c) => c.data)
			const attrs = Object.values(el.attribs ?? {})
			const isTarget = (v: string): boolean => targets.some((t) => v === t)
			const hasTarget =
				(v: string): boolean => targets.some((t) => v.includes(t))
			if(texts.some((t) => isTarget(t.trim())) || attrs.some(isTarget)) {
				complete.push(el)
			} else if(texts.some(hasTarget) || attrs.some(hasTarget)) {
				embedded.push(el)
			}
		}

		if('children' in node && Array.isArray(node.children)) {
			for(const child of node.children) {
				walk(child)
			}
		}
	}

	walk(root)
	return smallestElement(complete.length ? complete : embedded)
}

/** Byte span of an element (0 when source locations are missing). */
function elementSpan(e: Element): number {
	return (e.endIndex ?? 0) - (e.startIndex ?? 0)
}

/** The element with the smallest byte span (the tightest / deepest match). */
function smallestElement(els: Element[]): Element | undefined {
	return els
		.filter((e) => e.startIndex !== null && e.endIndex !== null)
		.sort((a, b) => elementSpan(a) - elementSpan(b))
		.at(0)
}

/** Every candidate xPath for `el`, each tagged with what it anchors on. The
 *  caller verifies + scores them ({@link anchorStability}) rather than trusting
 *  emission order, so the DURABILITY winner is chosen, not the first that
 *  resolves. Order here is only the final tie-break. */
function* candidateXPaths(el: Element): Generator<Candidate> {
	const tag = el.name
	const a = el.attribs ?? {}
	if(a.id) {
		yield { xPath: `//${tag}[@id=${xpathLiteral(a.id)}]`, kind: 'id',
			token: a.id, depth: 0 }
	}

	for(const name of IDENT_ATTRS) {
		if(a[name]) {
			yield { xPath: `//${tag}[@${name}=${xpathLiteral(a[name])}]`,
				kind: 'ident-attr', token: a[name], depth: 0 }
		}
	}

	// A uniquely-identified DIRECT child pins the parent without a positional
	// path (`//span[span[@id="labels"]]`). Self-verification discards it when the
	// child id/attr isn't unique — for example, GitHub reuses `id="labels"` per
	// email row — so it never silently matches the wrong node.
	for(const child of el.children) {
		if(!isTag(child)) {
			continue
		}

		const ca = child.attribs ?? {}
		if(ca.id) {
			yield { xPath: `//${tag}[${child.name}[@id=${xpathLiteral(ca.id)}]]`,
				kind: 'id', token: ca.id, depth: 0 }
		}

		for(const name of IDENT_ATTRS) {
			if(ca[name]) {
				yield {
					xPath: `//${tag}[${child.name}[@${name}=${xpathLiteral(ca[name])}]]`,
					kind: 'ident-attr', token: ca[name], depth: 0,
				}
			}
		}
	}

	// The value element's own distinctive class.
	const distinctive = distinctiveClass(a.class)
	if(distinctive) {
		yield { xPath: `//${tag}[contains(@class, ${xpathLiteral(distinctive)})]`,
			kind: 'class', token: distinctive, depth: 0 }
	}

	// Ancestor-anchored (id/attr, then class), descending positionally to `el`.
	yield* ancestorAnchoredCandidates(el)

	yield { xPath: absolutePath(el), kind: 'positional', depth: 99 }
}

/** The longest whitespace-delimited token of a class attribute (the most
 *  distinctive one), or undefined when there's no class. */
function distinctiveClass(cls: string | undefined): string | undefined {
	return (cls ?? '')
		.split(/\s+/)
		.filter(Boolean)
		.sort((x, y) => y.length - x.length)[0]
}

/** Positional path from `anc` (exclusive) down to `el` (inclusive), for
 *  example `/ul[1]/li[3]/a[1]`. Empty string when `anc` is not an ancestor
 *  of `el`. */
function relativeSteps(anc: Element, el: Element): string {
	const parts: string[] = []
	let node: Node | null = el
	while(node && isTag(node) && node !== anc) {
		const tag = node.name
		let index = 1
		for(let sib = node.prev; sib; sib = sib.prev) {
			if(isTag(sib) && sib.name === tag) {
				index++
			}
		}

		parts.unshift(`/${tag}[${index}]`)
		node = node.parent
	}

	return node === anc ? parts.join('') : ''
}

/** Ancestors of `el` (nearest first) with their depth, skipping
 *  `html`/`body`/`head` (≈ the absolute path) and non-ancestors. Capped depth
 *  keeps paths short. */
function* anchorAncestors(el: Element): Generator<{
	tag: string
	attribs: Record<string, string>
	rel: string
	depth: number
}> {
	let depth = 1
	for(
		let anc: Node | null = el.parent;
		anc && isTag(anc) && depth <= 10;
		anc = anc.parent, depth++
	) {
		const tag = anc.name
		if(tag === 'html' || tag === 'body' || tag === 'head') {
			continue
		}

		const rel = relativeSteps(anc, el)
		if(rel) {
			yield { tag, attribs: anc.attribs ?? {}, rel, depth }
		}
	}
}

/** Ancestor-anchored candidates, descending positionally to `el`
 *  (`//div[@id="nav"]/ul[1]/li[1]/a[1]`): an id / identifying-attr or a
 *  distinctive-class anchor per ancestor, tagged with its kind + depth so the
 *  scorer weighs a stable ancestor id above the value's own utility class. */
function* ancestorAnchoredCandidates(el: Element): Generator<Candidate> {
	for(const { tag, attribs, rel, depth } of anchorAncestors(el)) {
		if(attribs.id) {
			yield { xPath: `//${tag}[@id=${xpathLiteral(attribs.id)}]${rel}`,
				kind: 'id', token: attribs.id, depth }
		}

		for(const name of IDENT_ATTRS) {
			if(attribs[name]) {
				const xp = `//${tag}[@${name}=${xpathLiteral(attribs[name])}]${rel}`
				yield { xPath: xp, kind: 'ident-attr', token: attribs[name], depth }
			}
		}

		const dc = distinctiveClass(attribs.class)
		if(dc) {
			yield { xPath: `//${tag}[contains(@class, ${xpathLiteral(dc)})]${rel}`,
				kind: 'class', token: dc, depth }
		}
	}
}

/** Chrome "full XPath"-style absolute path: `/html[1]/body[1]/…/tag[n]`, where
 *  n is the element's 1-based position among same-tag siblings. */
function absolutePath(el: Element): string {
	const parts: string[] = []
	let node: Node | null = el
	while(node && isTag(node)) {
		const tag = node.name
		let index = 1
		for(let sib = node.prev; sib; sib = sib.prev) {
			if(isTag(sib) && sib.name === tag) {
				index++
			}
		}

		parts.unshift(`/${tag}[${index}]`)
		node = node.parent
	}

	return parts.join('')
}

/** True when `expression` selects EXACTLY `el` (one match) against `doc`. The
 *  attestor applies the redaction regex to EVERY xPath match and throws if any
 *  fails, so a non-unique selector (for example, a class shared by sibling
 *  rows) is unusable — it must resolve to the single target element. */
function matchesUniquely(doc: unknown, expression: string, el: Node): boolean {
	try {
		const engine = xpath as unknown as {
			parse(e: string): { select(o: unknown): Node[] }
		}
		const nodes = engine.parse(expression).select({
			node: doc,
			allowAnyNamespaceForNoPrefix: true,
		})
		return nodes.length === 1 && nodes[0] === el
	} catch{
		return false
	}
}

/** Quote a string as an XPath 1.0 string literal (concat() when it holds both
 *  quote characters). */
function xpathLiteral(s: string): string {
	if(!s.includes('"')) {
		return `"${s}"`
	}

	if(!s.includes("'")) {
		return `'${s}'`
	}

	const parts = s.split('"').map((p) => `"${p}"`)
	return `concat(${parts.join(', \'"\', ')})`
}
