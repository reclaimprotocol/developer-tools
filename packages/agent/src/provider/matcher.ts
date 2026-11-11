import { badRequest } from '@hapi/boom'
import assert from 'node:assert'
import { elementAnchor } from './dom-xpath.ts'
import { normalizeCandidates } from './normalize.ts'
import type { OprfMode, ResponseMatch, ResponseRedaction } from './schema.ts'

/** Reclaim attestor caps OPRF-hashed values at 62 bytes (TOPRF marker
 *  encoding). Surfaces as a clean error here rather than a confusing
 *  attestor-side failure at proof time. */
export const OPRF_MAX_BYTES = 62

export interface MatcherSynthesis {
	match: ResponseMatch
	redaction?: ResponseRedaction
	/** The captured value, keyed by `paramName`. NOT baked into the shipped
	 *  recipe — the caller uses it for the author's own proof; each verifying
	 *  user's value is re-extracted live (see verify/run.ts `extractBareParams`).
	 */
	paramValues?: Record<string, string>
}

/**
 * Build the matcher pieces (one responseMatch + one responseRedaction) for a
 * target value seen in a captured response. The design, in one line:
 *
 *   the REDACTION selects with xPath/jsonPath and names the value with a
 *   capture group; the MATCH is a `contains` of the surrounding structure with
 *   the value replaced by `{{paramName}}`.
 *
 * The match is what the attestor enforces (against the prover's revealed
 * bytes), so it must anchor the value in context the prover can't relocate — a
 * JSON key (`"login":"{{v}}"`) or the value's HTML element (`<span …>{{v}}`).
 * The redaction's regex only extracts/narrows; xPath/jsonPath do the selecting.
 *
 * `hash` (OPRF) is opt-in — enable it only when the request asks to protect
 * PII. It rides the `contains {{v}}` path: the redaction carries `hash`, match
 * keeps `{{v}}`, and the attestor substitutes the nullifier from paramValues at
 * proof time. Throws when `hash` is set on a free-form value (no safe class).
 */
export function synthesizeMatcher(
	body: string,
	contentType: string,
	target: string,
	paramName: string,
	hash?: OprfMode,
): MatcherSynthesis | undefined {
	if(
		!body.includes(target) &&
		!normalizeCandidates(target).some((v) => body.includes(v))
	) {
		return undefined
	}

	if(hash && !inferValueClass(target)) {
		throw new Error(
			'OPRF hashing requires a target with a known-safe character class '
			+ '(digits, slug, or email). '
			+ `Got "${target}" which is free-form. Use a tighter target `
			+ '(for example, just the alphanumeric portion of the value) '
			+ 'or call propose_provider without `hash`.',
		)
	}

	const valueClass = inferValueClass(target) ?? '[^"<>\\n]+'

	// JSON body → the value lives in a `"key": value` pair. jsonPath pins the
	// exact property; the `contains` match anchors on the key.
	if(/json/i.test(contentType) || isJsonBody(body)) {
		const r = jsonMatcher(body, target, paramName, valueClass, hash)
		if(r) {
			return r
		}
	}

	// HTML/XML → the value lives in an element. xPath selects it (an id/class
	// ancestor, else the value's own tag); the `contains` match is the element
	// markup with the value swapped for the placeholder. A `<script>` holding
	// JSON routes through jsonPath instead.
	if(/html|xml/i.test(contentType) || looksLikeHtml(body)) {
		const r = htmlMatcher(body, target, paramName, valueClass, hash)
		if(r) {
			return r
		}
	}

	// Inline JSON / JS-object text outside an HTML element (a JS bundle, a
	// non-JSON text body): anchor on the key name right before the value.
	const inline = inlineKeyMatcher(body, target, paramName, valueClass, hash)
	if(inline) {
		return inline
	}

	// No JSON key and no stable xPath anchor: a content-anchored regex, matched
	// by CONTENT so it reproduces regardless of DOM position at proof time (a
	// positional `(//tag)[N]` resolves to the wrong node at proof — see 9fd7770).
	return contentMatcher(body, target, paramName, valueClass, hash)
}

/** True when `body` is a JSON document (starts `{`/`[` and parses). */
function isJsonBody(body: string): boolean {
	const head = body.trimStart()[0]
	if(head !== '{' && head !== '[') {
		return false
	}

	try {
		JSON.parse(body)
		return true
	} catch{
		return false
	}
}

/** Index of `target` (or an encoding variant) in `text`, with the matched
 *  variant. `{ idx: -1 }` when absent. */
function firstIndex(
	text: string,
	target: string,
): { idx: number, value: string } {
	for(const value of [target, ...normalizeCandidates(target)]) {
		const idx = text.indexOf(value)
		if(idx >= 0) {
			return { idx, value }
		}
	}

	return { idx: -1, value: target }
}

/**
 * Assemble the result for a value that sits after a literal `prefix` and
 * before a `close` delimiter — the shared shape for JSON `"key":"…"` and
 * JSON-in-HTML. The redaction pairs the selector with a capture regex
 * (whitespace in the prefix flexed); the match `contains` `prefix{{v}}close`.
 */
function keyValueResult(
	prefix: string,
	close: string,
	target: string,
	paramName: string,
	valueClass: string,
	selector: { jsonPath?: string, xPath?: string },
	hash?: OprfMode,
): MatcherSynthesis {
	const redaction: ResponseRedaction = {
		...selector,
		regex:
			`${escapeRegexFlexWs(prefix)}(?<${paramName}>${valueClass})`
			+ escapeRegex(close),
	}
	if(hash) {
		redaction.hash = hash
	}

	return {
		match: { type: 'contains', value: `${prefix}{{${paramName}}}${close}` },
		redaction,
		paramValues: { [paramName]: target },
	}
}

// ---------------------------------------------------------------------------
// JSON: "key": value  →  jsonPath redaction + `contains "key":"{{v}}"`
// ---------------------------------------------------------------------------

/**
 * Matcher for a value inside a JSON `"key": value` pair. jsonPath pins the
 * exact property (so the redaction extracts THIS one, not a same-named key
 * elsewhere); the `contains` match anchors on `"key":`.
 */
function jsonMatcher(
	body: string,
	target: string,
	paramName: string,
	valueClass: string,
	hash?: OprfMode,
): MatcherSynthesis | undefined {
	const jsonPath = findJsonPath(body, target)
	if(!jsonPath) {
		return undefined
	}

	const anchor = jsonKeyPrefix(body, target, lastPathKey(jsonPath))
	if(!anchor) {
		return undefined
	}

	return keyValueResult(
		anchor.prefix, anchor.close, target, paramName, valueClass,
		{ jsonPath }, hash,
	)
}

/** The trailing object-property name of a jsonPath (`$.total_records` →
 *  `"total_records"`), or undefined for an array-index/bracket leaf, which
 *  has no literal key to anchor a search on. */
function lastPathKey(jsonPath: string | undefined): string | undefined {
	const m = jsonPath ? /\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(jsonPath) : null
	return m?.[1]
}

/**
 * The literal `"key":"` (or `"key":` for a raw number/bool) immediately before
 * `target` in `text`, plus the closing quote (`"` for a string value, `''`
 * otherwise). Returns undefined when the value isn't preceded by a JSON key.
 *
 * When `key` is given, anchors the search on occurrences of the KEY (not the
 * value) — so a short/common value elsewhere in the body (for example, the
 * digit "5" inside `"investment_amount":354.85`) can't be mistaken for this
 * field. Only falls back to a whole-body value search when there's no
 * resolvable key (for example, `findJsonPath` returned an array-index leaf).
 */
function jsonKeyPrefix(
	text: string,
	target: string,
	key?: string,
): { prefix: string, close: string } | undefined {
	if(key !== undefined) {
		return jsonKeyPrefixByKey(text, target, key)
	}

	const { idx } = firstIndex(text, target)
	if(idx < 0) {
		return undefined
	}

	let i = idx - 1
	const quoted = text[i] === '"'
	if(quoted) {
		i--
	}

	while(i >= 0 && /\s/.test(text[i] ?? '')) {
		i--
	}

	if(text[i] !== ':') {
		return undefined
	}

	i--
	while(i >= 0 && /\s/.test(text[i] ?? '')) {
		i--
	}

	if(text[i] !== '"') {
		return undefined
	}

	const keyStart = text.lastIndexOf('"', i - 1)
	if(keyStart < 0) {
		return undefined
	}

	return { prefix: text.slice(keyStart, idx), close: quoted ? '"' : '' }
}

/** `jsonKeyPrefix`'s key-anchored path: scan occurrences of `"key"`, and for
 *  each, check whether the value that follows its `:` matches `target` (or a
 *  normalized candidate) before accepting it. */
function jsonKeyPrefixByKey(
	text: string,
	target: string,
	key: string,
): { prefix: string, close: string } | undefined {
	const keyToken = `"${key}"`
	let from = 0
	for(;;) {
		const keyIdx = text.indexOf(keyToken, from)
		if(keyIdx < 0) {
			return undefined
		}

		from = keyIdx + keyToken.length
		let i = from
		while(i < text.length && /\s/.test(text[i] ?? '')) {
			i++
		}

		if(text[i] !== ':') {
			continue
		}

		i++
		while(i < text.length && /\s/.test(text[i] ?? '')) {
			i++
		}

		const matched = matchJsonValueAt(text, i, target)
		if(matched) {
			return {
				prefix: text.slice(keyIdx, matched.valueStart),
				close: matched.close,
			}
		}
	}
}

/** Whether the JSON value starting at `pos` in `text` — quoted string or a
 *  raw number/bool/null token — equals `target` (or a normalized candidate).
 *  Returns the position right after any opening quote (matching `firstIndex`'s
 *  convention) and the delimiter to close the match template with. */
function matchJsonValueAt(
	text: string,
	pos: number,
	target: string,
): { valueStart: number, close: string } | undefined {
	const candidates = [target, ...normalizeCandidates(target)]
	if(text[pos] === '"') {
		let j = pos + 1
		while(j < text.length && text[j] !== '"') {
			j += text[j] === '\\' ? 2 : 1
		}

		const raw = text.slice(pos + 1, j)
		return candidates.includes(raw)
			? { valueStart: pos + 1, close: '"' }
			: undefined
	}

	let j = pos
	while(j < text.length && !/[,}\]\s]/.test(text[j] ?? '')) {
		j++
	}

	const raw = text.slice(pos, j)
	return candidates.includes(raw) ? { valueStart: pos, close: '' } : undefined
}

function findJsonPath(body: string, target: string): string | undefined {
	let parsed: unknown
	try {
		parsed = JSON.parse(body)
	} catch{
		return undefined
	}

	const candidates = normalizeCandidates(target)
	const paths: string[] = []
	collectJsonPaths(parsed, '$', candidates, paths)
	if(paths.length > 1) {
		throw new Error(
			`target value "${target}" occurs at multiple JSON paths `
			+ `(${paths.join(', ')}) — choose a value that identifies one field`,
		)
	}

	return paths[0]
}

function collectJsonPaths(
	node: unknown,
	path: string,
	candidates: string[],
	paths: string[],
): void {
	// Two paths are enough to prove ambiguity and keep traversal bounded for a
	// response containing the same primitive many times.
	if(paths.length > 1) {
		return
	}

	if(node === null || node === undefined) {
		return
	}

	if(
		typeof node === 'string' ||
		typeof node === 'number' ||
		typeof node === 'boolean'
	) {
		const str = String(node)
		if(candidates.includes(str)) {
			paths.push(path)
		}

		return
	}

	if(Array.isArray(node)) {
		for(const [i, element] of node.entries()) {
			collectJsonPaths(element, `${path}[${i}]`, candidates, paths)
		}

		return
	}

	if(typeof node === 'object') {
		for(const [k, v] of Object.entries(node as Record<string, unknown>)) {
			const childPath = /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)
				? `${path}.${k}`
				: `${path}["${k}"]`
			collectJsonPaths(v, childPath, candidates, paths)
		}
	}
}

// ---------------------------------------------------------------------------
// HTML: element  →  xPath redaction + `contains "<tag …>{{v}}</tag>"`
// ---------------------------------------------------------------------------

function looksLikeHtml(body: string): boolean {
	return /<[a-zA-Z][a-zA-Z0-9-]*[\s>]/.test(body.slice(0, 2000))
}

/**
 * Matcher for a value inside an HTML element. The element and a verified xPath
 * come from a real parse5 parse (see dom-xpath.ts), then either:
 *  - `<script>` JSON: dig the value out with jsonPath (`"key":"{{v}}"` match);
 *  - regular element: `contains` the element markup with the value → `{{v}}`.
 */
function htmlMatcher(
	body: string,
	target: string,
	paramName: string,
	valueClass: string,
	hash?: OprfMode,
): MatcherSynthesis | undefined {
	const anchor = elementAnchor(body, [target, ...normalizeCandidates(target)])
	if(!anchor) {
		return undefined
	}

	const revealSlice = body.slice(anchor.start, anchor.end)

	// JSON embedded in a <script>: xPath selects the script, jsonPath digs out
	// the value, the regex captures it — immune to a same-named key elsewhere.
	const scriptJson = scriptJsonContent(revealSlice)
	if(scriptJson) {
		const jsonPath = findJsonPath(scriptJson, target)
		const kp = jsonPath
			? jsonKeyPrefix(scriptJson, target, lastPathKey(jsonPath))
			: undefined
		if(jsonPath && kp) {
			return keyValueResult(
				kp.prefix, kp.close, target, paramName, valueClass,
				{ xPath: anchor.xPath, jsonPath }, hash,
			)
		}
	}

	// Inline JS-object / JSON text inside the element (a SvelteKit/Next/Nuxt
	// hydration `<script>` that isn't valid JSON): anchor on the key name
	// nearest the value (`currentTierDescription:"{{v}}"`), scoped by the xPath.
	const inline = inlineKeyMatcher(
		revealSlice, target, paramName, valueClass, hash, anchor.xPath,
	)
	if(inline) {
		return inline
	}

	const result = elementResult(
		anchor.xPath, revealSlice, target, paramName, valueClass, hash,
	)
	const [left = '', right = ''] = result?.match.value
		.split(`{{${paramName}}}`) ?? []
	const hits = result?.redaction?.regex
		? countMatches(revealSlice, result.redaction.regex)
		: 0
	assert(
		!result || !isGenericWindow(left, right) || hits <= 1,
		badRequest(
			`target value "${target}" sits in a <${elementTag(revealSlice)}> `
			+ 'with no key name or markup next to it. The only literal context, '
			+ `"${result?.match.value}", matches ${hits} values in that element, `
			+ 'so it would not pin this one. Pick a request where the value has '
			+ 'a key (for example, a JSON API response) or sits in its own '
			+ 'element.',
		),
	)
	return result
}

/** How many times `regex` matches in `text` (0 for an invalid regex). */
function countMatches(text: string, regex: string): number {
	try {
		return [...text.matchAll(new RegExp(regex, 'g'))].length
	} catch{
		return 0
	}
}

/** Tag name of the element markup starting `markup` (`script`, `div`, …). */
function elementTag(markup: string): string {
	return /^<([A-Za-z][\w-]*)/.exec(markup)?.[1] ?? 'element'
}

/** A literal window with no letter or digit on either side (for example,
 *  `:"{{v}}",`): it pins a value only when the element holds nothing else. */
function isGenericWindow(left: string, right: string): boolean {
	return !/[A-Za-z0-9]/.test(left + right)
}

// ---------------------------------------------------------------------------
// Inline key: `key:"value"` / `"key":"value"` in JS-object or JSON text
// ---------------------------------------------------------------------------

/** How far left of a value to look for its key. */
const MAX_KEY_LOOKBACK = 128

/** The key directly before a value: JSON `"key":`, `'key':`, or a bare JS
 *  identifier `key:`, then the value's opening quote (if any) at the end. */
const KEY_BEFORE_VALUE = new RegExp(
	'(?:"([A-Za-z_$][\\w$-]*)"|\'([A-Za-z_$][\\w$-]*)\''
	+ '|(?<![\\w$"\'])([A-Za-z_$][\\w$]*))\\s*:\\s*(["\']?)$',
)

/**
 * Matcher for a value written as `key:"value"` (JS object literal, as SvelteKit
 * and similar frameworks inline into SSR pages) or `"key":"value"` inside text
 * that isn't parseable JSON. The window is the key name plus the value's
 * quotes, so the match pins this field and nothing user-specific:
 * `currentTierDescription:"{{v}}"`.
 *
 * Rejects a key that appears more than once in `scope` with a different value:
 * the regex would extract the first one, which may not be this field. When the
 * value has a key but it's ambiguous, throws rather than falling back to a
 * looser window. Returns undefined when no occurrence has a key before it.
 */
function inlineKeyMatcher(
	scope: string,
	target: string,
	paramName: string,
	valueClass: string,
	hash?: OprfMode,
	xPath?: string,
): MatcherSynthesis | undefined {
	const candidates = [target, ...normalizeCandidates(target)]
		.filter((c) => c && !c.startsWith('"'))
	let ambiguous: { key: string, count: number } | undefined
	for(const cand of new Set(candidates)) {
		for(
			let idx = scope.indexOf(cand);
			idx >= 0;
			idx = scope.indexOf(cand, idx + 1)
		) {
			const kv = keyBefore(scope, idx, cand)
			if(!kv) {
				continue
			}

			const others = valuesForKey(scope, kv.key)
				.filter((v) => v !== cand)
			if(others.length) {
				ambiguous ??= { key: kv.key, count: others.length + 1 }
				continue
			}

			// A single-quoted free-form value must stop at its own quote.
			const cls = kv.close === '\'' && valueClass === '[^"<>\\n]+'
				? '[^\'<>\\n]+'
				: valueClass
			return keyValueResult(
				kv.prefix, kv.close, cand, paramName, cls,
				xPath ? { xPath } : {}, hash,
			)
		}
	}

	assert(
		!ambiguous,
		badRequest(
			`target value "${target}" sits under key "${ambiguous?.key}", but that `
			+ `key occurs ${ambiguous?.count} times with different values, so a `
			+ 'match on it would not pin this value. Pick a request where the key '
			+ 'is unique (for example, a JSON API that returns only this object).',
		),
	)
	return undefined
}

/** The key + opening-quote prefix directly before the value at `idx`, when the
 *  value is a complete quoted string (or a bare token) under that key. */
function keyBefore(
	scope: string,
	idx: number,
	value: string,
): { key: string, prefix: string, close: string } | undefined {
	const head = scope.slice(Math.max(0, idx - MAX_KEY_LOOKBACK), idx)
	const m = KEY_BEFORE_VALUE.exec(head)
	const key = m?.[1] ?? m?.[2] ?? m?.[3]
	if(!m || !key || key.length < 2) {
		return undefined
	}

	// A bare key before a bare value (`score: 5`) is prose as often as code;
	// require a quoted key or a quoted value.
	const quote = m[4] ?? ''
	const after = scope[idx + value.length] ?? ''
	const complete = quote ? after === quote : /^$|[\s,;}\]]/.test(after)
	if(!complete || (!quote && m[3])) {
		return undefined
	}

	return { key, prefix: m[0], close: quote }
}

/** Every value written under `key` in `scope` (JSON or JS-object syntax),
 *  raw — quoted strings without their quotes, bare tokens as-is. */
function valuesForKey(scope: string, key: string): string[] {
	const re = new RegExp(
		`(?<![\\w$])(["']?)${escapeRegex(key)}\\1\\s*:\\s*`, 'g',
	)
	const values: string[] = []
	for(const m of scope.matchAll(re)) {
		const start = m.index + m[0].length
		const quote = scope[start]
		if(quote === '"' || quote === '\'') {
			let j = start + 1
			while(j < scope.length && scope[j] !== quote) {
				j += scope[j] === '\\' ? 2 : 1
			}

			values.push(scope.slice(start + 1, j))
			continue
		}

		values.push(/^[^\s,;}\]]*/.exec(scope.slice(start))?.[0] ?? '')
	}

	return values
}

/**
 * `contains` a PORTABLE window of the element around the value, with the value
 * swapped for `{{paramName}}`. "Portable" = it anchors only on stable structure
 * (allow-listed attributes + tag boundaries) and excludes per-user / volatile
 * bytes (`href`/`value`/`id`/`data-*` attribute values, sibling elements), so a
 * published provider reproduces for ANY user, not just the author. The
 * redaction reveals + captures the value over the same window (xPath + regex,
 * whitespace flexed); `contains` is required for extractBareParams + OPRF.
 */
function elementResult(
	xPath: string,
	markup: string,
	target: string,
	paramName: string,
	valueClass: string,
	hash?: OprfMode,
): MatcherSynthesis | undefined {
	const { idx, value } = firstIndex(markup, target)
	if(idx < 0) {
		return undefined
	}

	const { left, right } = portableWindow(markup, idx, value.length)

	const redaction: ResponseRedaction = {
		xPath,
		regex:
			`${escapeRegexFlexWs(left)}(?<${paramName}>${valueClass})`
			+ escapeRegexFlexWs(right),
	}
	if(hash) {
		redaction.hash = hash
	}

	return {
		match: { type: 'contains', value: `${left}{{${paramName}}}${right}` },
		redaction,
		paramValues: { [paramName]: target },
	}
}

/** Attribute NAMES safe to bake into a match — stable across users. Everything
 *  else (`href`, `src`, `value`, `id`, `data-*`, `style`, `content`, nonces, …)
 *  carries per-user / per-render data and is excluded from the anchor. */
const STABLE_ATTRS = new Set([
	'class', 'type', 'rel', 'role', 'name', 'property', 'itemprop', 'for',
	'scope', 'lang', 'dir', 'selected', 'checked', 'disabled', 'readonly',
	'required', 'multiple', 'open', 'headers',
])

/** A portable literal window `{ left, right }` around the value in `markup`:
 *  anchored on stable structure, stripped of volatile/per-user bytes. */
function portableWindow(
	markup: string,
	valueIdx: number,
	valueLen: number,
): { left: string, right: string } {
	const valueEnd = valueIdx + valueLen
	const lastLt = markup.lastIndexOf('<', valueIdx - 1)
	const lastGt = markup.lastIndexOf('>', valueIdx - 1)

	// A `<` with no `>` after it before the value ⇒ value sits in an attribute.
	return lastLt > lastGt
		? attributeWindow(markup, valueIdx, valueEnd, lastLt)
		: textWindow(markup, valueIdx, valueEnd, lastGt)
}

/** Value is element text content. Left anchor: if only punctuation/whitespace
 *  sits between the opening tag and the value, fold the stable opening tag in;
 *  but if WORDS precede the value in the same text node they may be per-user
 *  (for example, `<li>Full Name ( {{id}} )` — the name), so drop through the
 *  last alphanumeric and keep only the trailing punctuation as the anchor.
 *  Right: include a closing tag, but stop at a sibling. */
function textWindow(
	markup: string,
	valueIdx: number,
	valueEnd: number,
	openTagGt: number,
): { left: string, right: string } {
	const openTagStart = markup.lastIndexOf('<', openTagGt)
	const openTag = openTagStart >= 0
		? markup.slice(openTagStart, openTagGt + 1)
		: ''
	const between = markup.slice(openTagGt + 1, valueIdx)
	const left = /[A-Za-z0-9]/.test(between)
		// Words before the value could be per-user — anchor on the punctuation
		// after the last one (drops the words AND the tag they'd drag in).
		? between.replace(/[\s\S]*[A-Za-z0-9]/, '')
		// Only punctuation/whitespace — safe to fold the stable opening tag.
		: stableOpeningTail(openTag) + between

	const nextLt = markup.indexOf('<', valueEnd)
	const inter = nextLt < 0
		? markup.slice(valueEnd)
		: markup.slice(valueEnd, nextLt)

	// Trailing words after the value may be per-user too — keep only the
	// punctuation up to the first alphanumeric, and drop the closing tag with
	// them (contains is contiguous, so it can't be reached past a word).
	if(/[A-Za-z0-9]/.test(inter)) {
		return { left, right: inter.replace(/[A-Za-z0-9][\s\S]*/, '') }
	}

	// Punctuation/whitespace only: fold the stable closing tag if present.
	if(nextLt >= 0 && markup.startsWith('</', nextLt)) {
		const close = markup.indexOf('>', nextLt)
		const end = close < 0 ? nextLt : close + 1
		return { left, right: markup.slice(valueEnd, end) }
	}

	// Sibling opening tag (or end of markup) — stop at it.
	return { left, right: inter }
}

/** Value is an attribute value: anchor on the nearest STABLE identifying
 *  attribute (`name`/`property`/…) plus the value attribute's `name="`. */
function attributeWindow(
	markup: string,
	valueIdx: number,
	valueEnd: number,
	openTagStart: number,
): { left: string, right: string } {
	const gt = markup.indexOf('>', valueEnd)
	const openTag = markup.slice(openTagStart, gt < 0 ? markup.length : gt + 1)
	const rel = valueIdx - openTagStart

	const attrRe = /\s+([a-zA-Z][\w:-]*)(\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g
	let anchorStart = -1
	let valueAttrStart = -1
	let m: RegExpExecArray | null
	while((m = attrRe.exec(openTag)) !== null) {
		const start = m.index
		if(start < rel && rel < start + m[0].length) {
			valueAttrStart = start
			break
		}

		if(STABLE_ATTRS.has(m[1].toLowerCase())) {
			anchorStart = start
		}
	}

	const from = anchorStart >= 0 ? anchorStart : valueAttrStart
	const left = from >= 0 ? openTag.slice(from, rel).replace(/^\s+/, '') : ''
	const quote = markup[valueEnd]
	return { left, right: quote === '"' || quote === "'" ? quote : '' }
}

/** The portable suffix of an opening tag (ending at `>`): the trailing run of
 *  allow-listed attributes. Everything up to and including the last volatile
 *  attribute is dropped, so `<a href="/user" class="x">` → `class="x">`. */
function stableOpeningTail(openTag: string): string {
	const attrRe = /\s+([a-zA-Z][\w:-]*)(\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g
	let cut = -1
	let m: RegExpExecArray | null
	while((m = attrRe.exec(openTag)) !== null) {
		if(!STABLE_ATTRS.has(m[1].toLowerCase())) {
			cut = m.index + m[0].length
		}
	}

	return (cut < 0 ? openTag : openTag.slice(cut)).replace(/^\s+/, '')
}

/** If `markup` is a single `<script>…</script>` element, return its text
 *  content (the JSON body the attestor exposes when a jsonPath is paired with
 *  the script's xPath); otherwise undefined. */
function scriptJsonContent(markup: string): string | undefined {
	const match = /^<script\b[^>]*>([\s\S]*)<\/script\b[^>]*>\s*$/i.exec(markup)
	if(!match) {
		return undefined
	}

	const content = match[1].trim()
	return content.length > 0 ? content : undefined
}

// ---------------------------------------------------------------------------
// Content-anchored fallback (no stable structural anchor)
// ---------------------------------------------------------------------------

/** Longest opening/closing HTML tag folded into the match context. */
const MAX_TAG_BYTES = 256

/** Bytes the left context grows per step while searching for uniqueness. */
const CONTEXT_STEP = 4

/**
 * Matcher for a value with no JSON key and no stable xPath anchor: a
 * content-anchored regex redaction (position-independent) paired with a match
 * carrying surrounding literal context, so it is never a bare — hence
 * spoofable — `{{value}}`. When there is genuinely no literal context, the
 * value-isolating regex itself becomes the (regex-type) match.
 */
function contentMatcher(
	body: string,
	target: string,
	paramName: string,
	valueClass: string,
	hash?: OprfMode,
): MatcherSynthesis | undefined {
	const regex = buildContentRegex(body, target, paramName, valueClass)
	if(!regex) {
		return undefined
	}

	const redaction: ResponseRedaction = { regex }
	if(hash) {
		redaction.hash = hash

		// OPRF needs a `contains {{v}}` match — the attestor substitutes the
		// nullifier into it (a regex match can't express that). Anchor on the
		// surrounding literal context so it's never a bare, spoofable `{{v}}`.
		return {
			match: {
				type: 'contains',
				value: buildContextualTemplate(body, target, paramName, valueClass),
			},
			redaction,
			paramValues: { [paramName]: target },
		}
	}

	// The value-isolating regex IS the match: grown to uniquely capture THIS
	// occurrence, so it's position-independent, self-extracting (the attestor
	// reads its named group — verification's `extractBareParams` can't grab a
	// same-shaped earlier occurrence, as a `contains "key":"{{v}}"` would), and
	// never a bare, spoofable `{{v}}`.
	return {
		match: { type: 'regex', value: regex },
		redaction,
		paramValues: { [paramName]: target },
	}
}

/**
 * A value-isolating regex around the first occurrence of `target`, matched by
 * CONTENT so it reproduces regardless of DOM position: leading literal context
 * (grown until the first whole-body match captures THIS occurrence) + a
 * `(?<paramName>valueClass)` group + any trailing delimiter. The revealed span
 * must CONTAIN the match template (buildContextualTemplate), so the trailing
 * delimiter is kept unless it's whitespace (which the template also drops).
 */
/** Indices where `cand` occurs in `body` as a WHOLE match of `valueClass` —
 * that is, not a substring inside a longer run of the same class (the digit "5"
 * inside "354.85" is never a whole `\d+` match; "354" and "85" are). Only
 * meaningful for a structural (non-free-form) class. */
function wholeTokenIndices(
	body: string,
	cand: string,
	valueClass: string,
): number[] {
	const indices: number[] = []
	let re: RegExp
	try {
		re = new RegExp(valueClass, 'g')
	} catch{
		return indices
	}

	let m: RegExpExecArray | null
	while((m = re.exec(body))) {
		if(m[0] === cand) {
			indices.push(m.index)
		}

		if(re.lastIndex === m.index) {
			re.lastIndex++
		}
	}

	return indices
}

function buildContentRegex(
	body: string,
	target: string,
	paramName: string,
	valueClass: string,
): string | undefined {
	const structural = inferValueClass(target) !== undefined
	for(const cand of normalizeCandidates(target)) {
		const occurrences = structural
			? wholeTokenIndices(body, cand, valueClass)
			: undefined
		const idx = occurrences ? occurrences[0] ?? -1 : body.indexOf(cand)
		if(idx < 0) {
			continue
		}

		if(occurrences && occurrences.length > 1
			&& cand.replace(/[^A-Za-z0-9]/g, '').length < 4) {
			throw new Error(
				`target value "${target}" occurs ${occurrences.length} times as a `
				+ 'standalone token with no JSON key or HTML anchor to '
				+ "disambiguate — capture a request where it's unique, or use a "
				+ 'longer/more specific target.',
			)
		}

		const endIdx = idx + cand.length
		const rawRight = findRightContext(body, endIdx)
		const right = /^\s/.test(rawRight) ? '' : escapeRegexFlexWs(rawRight)
		const baseStart = idx - findLeftContext(body, idx).length
		for(let start = baseStart; ; start -= CONTEXT_STEP) {
			const from = Math.max(0, start)
			const before = escapeRegexFlexWs(body.slice(from, idx))
			const re = `${before}(?<${paramName}>${valueClass})${right}`
			let found = false
			try {
				found = new RegExp(re).exec(body)?.groups?.[paramName] === cand
			} catch{
				break
			}

			if(found) {
				const problem = contextProblem(
					body.slice(from, idx), right ? rawRight : '',
				)
				assert(
					!problem,
					badRequest(
						`target value "${target}" has no key name or element next to `
						+ `it; the shortest window that pins it, "${body.slice(from, idx)}`
						+ `{{${paramName}}}${right ? rawRight : ''}", ${problem}. That `
						+ 'would pin the provider to this user or match the wrong value. '
						+ 'This happens with positional arrays such as SvelteKit '
						+ '`__data.json`. Use a request where the value sits under its '
						+ 'own key (the HTML page or another JSON API), or stop and '
						+ 'report.',
					),
				)
				return re
			}

			if(from === 0) {
				break
			}
		}
	}

	return undefined
}

/** A standalone number token (`33` in `:33},`) — a points balance, count, or
 *  id that differs per user; not a digit inside a word or class (`mb-2`). */
const VOLATILE_NUMBER = /(?<![\w.-])\d+(?:\.\d+)?(?![\w.])/

/** The closing quote of a string followed by a separator — the end of a
 *  neighbouring VALUE (keys are followed by `:`), usually user-specific. */
const NEIGHBOUR_STRING = /"\s*[,\]}]/

/** Why a content window around a value isn't portable, or undefined when it
 *  is: only punctuation (pins nothing), a number next to the value, or a
 *  neighbouring string value. */
function contextProblem(left: string, right: string): string | undefined {
	if(VOLATILE_NUMBER.test(left) || VOLATILE_NUMBER.test(right)) {
		return 'contains a number next to the value, which is likely '
			+ 'user-specific (for example, a points balance)'
	}

	if(NEIGHBOUR_STRING.test(left)) {
		return 'contains a neighbouring value, which is likely user-specific'
	}

	if(!/[A-Za-z]/.test(left + right)) {
		return 'is only punctuation and matches almost any value'
	}

	return undefined
}

/**
 * The literal `contains` template: surrounding structural context with the
 * value replaced by `{{paramName}}`. Whitespace-adjacent context is dropped (a
 * literal contains can't flex whitespace); stable context (a JSON key, an HTML
 * opening tag) is kept so the match anchors on it.
 */
function buildContextualTemplate(
	body: string,
	target: string,
	paramName: string,
	valueClass: string,
): string {
	const idx = wholeTokenIndices(body, target, valueClass)[0]
		?? body.indexOf(target)
	if(idx < 0) {
		return `{{${paramName}}}`
	}

	const endIdx = idx + target.length
	const leftCtx = /\s$/.test(findLeftContext(body, idx))
		? '' : findLeftContext(body, idx)
	const rightCtx = /^\s/.test(findRightContext(body, endIdx))
		? '' : findRightContext(body, endIdx)
	return `${leftCtx}{{${paramName}}}${rightCtx}`
}

/**
 * Walk left up to 32 bytes to the nearest meaningful anchor, stopping at the
 * first structural delimiter. On an HTML tag boundary (`>`) fold in the whole
 * opening tag — its class/id is the anchor; `>{{value}}<` alone would let a
 * prover surface the value from any element. A leading run of volatile
 * whitespace is skipped first so the anchor lands on the tag, not on `\s*`.
 */
function findLeftContext(body: string, idx: number): string {
	const MAX_CONTEXT_BYTES = 32
	const stop = Math.max(0, idx - MAX_CONTEXT_BYTES)
	let scan = idx - 1
	while(scan >= stop && /\s/.test(body[scan] ?? '')) {
		scan--
	}

	for(let i = scan; i >= stop; i--) {
		const c = body[i]
		if(c === '>') {
			const tagStart = body.lastIndexOf('<', i)
			if(tagStart >= 0 && i - tagStart <= MAX_TAG_BYTES
				&& body[tagStart + 1] !== '/') {
				return body.slice(tagStart, idx)
			}

			return body.slice(i, idx)
		}

		if(c === '{' || c === '}' || c === ',' || c === ';') {
			return body.slice(i + 1, idx)
		}
	}

	return body.slice(stop, idx)
}

function findRightContext(body: string, endIdx: number): string {
	const MAX_CONTEXT_BYTES = 16
	const stop = Math.min(body.length, endIdx + MAX_CONTEXT_BYTES)
	for(let i = endIdx; i < stop; i++) {
		const c = body[i]
		if(c === '<') {
			const tagEnd = body.indexOf('>', i)
			if(tagEnd >= 0 && tagEnd - i <= MAX_TAG_BYTES) {
				return body.slice(endIdx, tagEnd + 1)
			}

			return body.slice(endIdx, i + 1)
		}

		if(c === '{' || c === '}' || c === ',' || c === ';' || c === '\n') {
			return body.slice(endIdx, i)
		}
	}

	return body.slice(endIdx, stop)
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Escape `s` as a regex literal but match any run of whitespace flexibly
 *  (`\s*`): HTML varies inter-token whitespace, so literal whitespace baked
 *  into a redaction's capture regex would make it miss at proof time. */
function escapeRegexFlexWs(s: string): string {
	return s.split(/\s+/).map(escapeRegex).join('\\s*')
}

/** Derive a regex character class from the target's shape. Returns
 *  `undefined` for free-form values — those can't be OPRF'd because we
 *  can't write a regex capture that reliably matches arbitrary unicode /
 *  punctuation. Caller refuses the hash request. */
function inferValueClass(target: string): string | undefined {
	if(/^[0-9]+$/.test(target)) {
		return '\\d+'
	}

	// Numbers with thousands separators / decimals, for example, "1,908" or
	// "12,345.6".
	if(/^[0-9][0-9,.]*[0-9]$/.test(target)) {
		return '[0-9,.]+'
	}

	if(/^[A-Za-z0-9_-]+$/.test(target)) {
		return '[A-Za-z0-9_-]+'
	}

	if(/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(target)) {
		return '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'
	}

	return undefined
}

/** True when `target` has a character class safe to OPRF-hash. Free-form values
 *  (names with spaces, arbitrary unicode/punctuation) return false — the caller
 *  must NOT default them to a hash (it would throw in synthesizeMatcher). */
export function isOprfHashable(target: string): boolean {
	return inferValueClass(target) !== undefined
}
