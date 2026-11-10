import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { synthesizeMatcher } from '../src/provider/matcher.ts'

describe('synthesizeMatcher — no hash (default)', () => {
	it('JSON: emits jsonPath + value-isolating regex + template match', () => {
		const body = JSON.stringify({ user: { followers: 1247 } })
		const out = synthesizeMatcher(body, 'application/json', '1247', 'followers')
		// A jsonPath reveal is a byte range that includes the key
		// (`"followers":1247`), so the redaction narrows with a named-capture
		// regex — without it the extracted value carries the key.
		assert.equal(out?.redaction?.jsonPath, '$.user.followers')
		assert.ok(
			out?.redaction?.regex?.includes('(?<followers>'),
			`expected value-isolating regex, got ${out?.redaction?.regex}`,
		)
		assert.equal(out?.match.type, 'contains')
		assert.ok(
			out?.match.value.includes('{{followers}}'),
			`expected template, got ${out?.match.value}`,
		)
		assert.deepEqual(out?.paramValues, { followers: '1247' })
	})

	it('JSON numeric leaf: regex isolates the bare number, not "key":n', () => {
		// The github-copilot/chat shape that thrashed the agent: a numeric id
		// whose jsonPath reveal is `"id":33719927` (key+value), needing a regex.
		const body = JSON.stringify({ currentUser: { id: 33719927 } })
		const out = synthesizeMatcher(
			body, 'application/json', '33719927', 'userId',
		)
		assert.equal(out?.redaction?.jsonPath, '$.currentUser.id')
		assert.ok(
			out?.redaction?.regex?.includes('(?<userId>\\d+)'),
			`expected numeric named capture, got ${out?.redaction?.regex}`,
		)
	})

	it(
		'JSON: anchors on the resolved key, not a same-shaped digit elsewhere',
		() => {
			// Regression: "5" from total_records must not match the digit inside
			// investment_amount's "354.85" just because it's found first.
			const body = JSON.stringify({
				investment_amount: 354.85, total_records: 5,
			})
			const out = synthesizeMatcher(body, 'application/json', '5', 'records')
			assert.equal(out?.redaction?.jsonPath, '$.total_records')
			assert.ok(
				out?.redaction?.regex?.startsWith('"total_records"'),
				`expected anchored regex, got ${out?.redaction?.regex}`,
			)
			assert.deepEqual(out?.paramValues, { records: '5' })
		},
	)

	it(
		'JSON: rejects equal values at multiple paths instead of picking one',
		() => {
			const body = JSON.stringify({ current: { id: 5 }, previous: { id: 5 } })
			assert.throws(
				() => synthesizeMatcher(body, 'application/json', '5', 'id'),
				/multiple JSON paths.*\$\.current\.id.*\$\.previous\.id/,
			)
		},
	)

	it(
		'plain text: standalone short value repeated with no anchor throws',
		() => {
			const body = 'score: 5 rank: 5 done'
			assert.throws(
				() => synthesizeMatcher(body, 'text/plain', '5', 'score'),
				/occurs 2 times as a standalone token/,
			)
		},
	)

	it('number with separators: capture class stops at the value', () => {
		// GitHub contributions: `<h2>1,908\n contributions\n …</h2>`. The value
		// has a comma (not a plain digit run) and the surrounding text is
		// newline-separated, so the class must accept `,` yet stop at the newline.
		const body = '<h2 id="contrib">\n      1,908\n      contributions\n</h2>'
		const out = synthesizeMatcher(body, 'text/html', '1,908', 'contributions')
		assert.ok(
			out?.redaction?.regex?.includes('(?<contributions>[0-9,.]+)'),
			`expected numeric-with-separators class, got ${out?.redaction?.regex}`,
		)
		assert.deepEqual(out?.paramValues, { contributions: '1,908' })
	})

	it('HTML: xPath redaction + value-isolating regex + template match', () => {
		const body = '<script id="client-env">{"login":"octocat"}</script>'
		const out = synthesizeMatcher(body, 'text/html', 'octocat', 'username')
		// An HTML element reveal is the element's markup, never the bare value,
		// so the redaction narrows with a named-capture regex (see matcher.ts).
		assert.equal(out?.redaction?.xPath, '//script[@id="client-env"]')
		assert.ok(
			out?.redaction?.regex?.includes('(?<username>'),
			`expected value-isolating regex, got ${out?.redaction?.regex}`,
		)
		assert.equal(out?.match.type, 'contains')
		assert.ok(
			out?.match.value.includes('"login":"{{username}}"'),
			`expected JSON key context in template, got ${out?.match.value}`,
		)
		assert.deepEqual(out?.paramValues, { username: 'octocat' })
	})

	it('text/plain (no structure): content-anchored regex match', () => {
		// No JSON/HTML structure and no whitespace-free literal context → the
		// value-isolating regex itself is the match (never a bare {{v}}).
		const body = 'random plaintext with the value octocat somewhere here'
		const out = synthesizeMatcher(body, 'text/plain', 'octocat', 'username')
		assert.equal(out?.redaction?.xPath, undefined)
		assert.equal(out?.redaction?.jsonPath, undefined)
		const re = out?.redaction?.regex
		assert.ok(re?.includes('(?<username>'), `expected named capture, got ${re}`)
		assert.equal(new RegExp(re!).exec(body)?.groups?.username, 'octocat')
		assert.equal(out?.match.type, 'regex')
	})

	it('HTML with no id/class/child anchor: absolute child-indexed xPath', () => {
		// No id/class and no identified child → a Chrome-style absolute path,
		// generated from AND verified against parse5 (the attestor's parser) so it
		// provably resolves at proof time. (Counting real DOM element order, unlike
		// the old `(//span)[N]` byte-count that pointed at the wrong node.)
		const body =
			'<html><body><span>first-content-here</span><span>second-content</span>' +
			'<span>third-content-target</span></body></html>'
		const out = synthesizeMatcher(
			body, 'text/html', 'third-content-target', 'username',
		)
		assert.equal(out?.redaction?.xPath, '/html[1]/body[1]/span[3]')
		assert.equal(out?.match.type, 'contains')
		assert.equal(out?.match.value, '<span>{{username}}</span>')
	})

	it('element with an id\'d child: child-anchor xPath (non-positional)', () => {
		// The github/settings email shape: `<span>value<span id="labels">…` — the
		// value's span has no id/class, but its child does. Anchor on the child
		// (`//span[span[@id="labels"]]`): stable and position-independent, unlike a
		// positional `(//span)[N]`.
		const body = '<div><span>primary@example.com'
			+ '<span id="labels" class="ml-1">Primary</span></span></div>'
		const out = synthesizeMatcher(
			body, 'text/html', 'primary@example.com', 'email',
		)
		assert.equal(out?.redaction?.xPath, '//span[span[@id="labels"]]')
		assert.equal(out?.match.type, 'contains')
		assert.ok(out?.match.value.includes('{{email}}'), out?.match.value)
		assert.ok(out?.redaction?.regex?.includes('(?<email>'))
	})

	it('ancestor id beats the element\'s own utility class', () => {
		// The github/settings name shape: `<h1 id="settings-header"><a
		// class="color-fg-default">Alex</a>`. The value's own class is a generic
		// Primer utility token — even when it happens to be unique among <a> on
		// this page it is a fragile anchor. A stable ancestor `id` must win, so the
		// xPath is the human-authored `//h1[@id="settings-header"]/a[1]`, NOT
		// `//a[contains(@class,"color-fg-default")]`. (A decoy DIV carries the same
		// class so it is genuinely a utility token, not a unique identifier.)
		const body = '<div class="color-fg-default">decoy</div>'
			+ '<h1 id="settings-header" class="h3 lh-condensed">'
			+ '<a href="/Scratch-net" class="color-fg-default">Alex'
			+ '<span class="color-fg-muted">(Scratch-net)</span></a></h1>'
		const out = synthesizeMatcher(body, 'text/html', 'Alex', 'name')
		assert.equal(out?.redaction?.xPath, '//h1[@id="settings-header"]/a[1]')
		assert.equal(out?.match.type, 'contains')
		assert.ok(out?.match.value.includes('{{name}}'), out?.match.value)
	})

	it('repeated key in anchor-less <script>: absolute xPath + jsonPath', () => {
		// `"name"` appears in a feature-flag blob before the user's owner.name, in
		// a <script> with no id. parse5 gives an absolute path to that script and
		// jsonPath pins `$.owner.name` inside it, so the reveal is the user's name,
		// not the flag — no context-growing regex needed.
		const body = '<script type="application/json">'
			+ '{"flags":[{"name":"actions_x"}],'
			+ '"owner":{"login":"octocat","name":"Ada"}}</script>'
		const out = synthesizeMatcher(body, 'text/html', 'Ada', 'name')
		assert.ok(out?.redaction?.xPath?.startsWith('/html'))
		assert.equal(out?.redaction?.jsonPath, '$.owner.name')
		assert.equal(out?.match.type, 'contains')
		assert.equal(out?.match.value, '"name":"{{name}}"')
	})

	it('shared class among siblings → ancestor-class-anchored path', () => {
		// Every stat tile shares the wrapper class, so `contains(@class, …)` on the
		// value's own div matches all three; self-verification rejects it. Instead
		// of falling to a from-root absolute path, the synthesizer anchors on the
		// nearest DISTINCTIVE ancestor class and descends by position — stable and
		// how these are authored by hand.
		const cls = 'UserHeader__stats-value-wrapper'
		const body = '<div class="UserHeader__stats">'
			+ `<div class="${cls}"><!----> 124</div>`
			+ `<div class="${cls}"><!----> 10K</div>`
			+ `<div class="${cls}"><!----> 329</div></div>`
		const out = synthesizeMatcher(body, 'text/html', '329', 'wastedDays')
		assert.equal(
			out?.redaction?.xPath,
			'//div[contains(@class, "UserHeader__stats")]/div[3]',
		)
		assert.ok(out?.match.value.includes('{{wastedDays}}'))
		assert.deepEqual(out?.paramValues, { wastedDays: '329' })
	})

	it('anchor-less element → climbs to nearest ancestor class', () => {
		// The value's own <span> has no id/class, so the synthesizer climbs to the
		// nearest ancestor bearing a class (`card`) and descends positionally —
		// stabler than the absolute byte path, and resolves to the right node where
		// a from-root path can drift.
		const body = '<html><body><div class="card">'
			+ '<span>predator-x7-handle</span></div></body></html>'
		const out = synthesizeMatcher(
			body, 'text/html', 'predator-x7-handle', 'username',
		)
		assert.equal(
			out?.redaction?.xPath, '//div[contains(@class, "card")]/span[1]',
		)
		assert.equal(out?.match.value, '<span>{{username}}</span>')
	})

	it('anchors on an ancestor id and descends (navbar "Welcome, X")', () => {
		// The name sits in a bare <a> with no id/class, but an ancestor
		// <div id="myNavbar"> does — anchor there and descend, preferring the id
		// over the nearer <ul class="nav">. Mirrors hand-authored recipes.
		const body = '<html><body><nav><div id="myNavbar"><ul class="nav">'
			+ '<li><a href="/u">Welcome, Ada Lovelace</a></li>'
			+ '</ul></div></nav></body></html>'
		const out = synthesizeMatcher(body, 'text/html', 'Ada Lovelace', 'name')
		assert.ok(
			out?.redaction?.xPath?.startsWith('//div[@id="myNavbar"]'),
			`expected id-anchored path, got ${out?.redaction?.xPath}`,
		)
		assert.ok(out?.match.value.includes('{{name}}'))
	})

	it('returns undefined when target is not in body', () => {
		assert.equal(
			synthesizeMatcher('{}', 'application/json', '1247', 'followers'),
			undefined,
		)
	})
})

describe('synthesizeMatcher — hash (OPRF)', () => {
	it('JSON + oprf-raw: redaction carries jsonPath + regex + hash', () => {
		const body = JSON.stringify({ user: { login: 'octocat' } })
		const out = synthesizeMatcher(
			body,
			'application/json',
			'octocat',
			'username',
			'oprf-raw',
		)
		assert.equal(out?.redaction?.jsonPath, '$.user.login')
		assert.ok(
			out?.redaction?.regex?.includes('(?<username>[A-Za-z0-9_-]+)'),
			`expected named capture in regex, got ${out?.redaction?.regex}`,
		)
		assert.equal(out?.redaction?.hash, 'oprf-raw')
	})

	it('digit target produces \\d+ capture class', () => {
		const body = '{"followers":1247}'
		const out = synthesizeMatcher(
			body,
			'application/json',
			'1247',
			'count',
			'oprf',
		)
		assert.ok(
			out?.redaction?.regex?.includes('(?<count>\\d+)'),
			`expected \\d+ class, got ${out?.redaction?.regex}`,
		)
		assert.equal(out?.redaction?.hash, 'oprf')
	})

	it('throws when hash is requested for a free-form target', () => {
		const body = '<div class="name">山田 太郎</div>'
		assert.throws(
			() => synthesizeMatcher(body, 'text/html', '山田 太郎', 'name', 'oprf-raw'),
			/safe character class|free-form/i,
		)
	})
})

describe('synthesizeMatcher — reveal-size cap', () => {
	it('narrows oversized HTML element (>512B) with a regex even without hash',
		() => {
		// Mimics GitHub's `<script id="client-env">` with multi-KB JSON
		// payload. Without narrowing, the attestor would ZK the whole 7KB+
		// element and OOM Node. With the regex extension, only ~30 bytes
		// of "login":"<value>" get revealed. Free-form targets follow the
		// same narrowing path with a permissive `[^"<>\n]+` class.
			const filler = JSON.stringify({
				noise: 'x'.repeat(600),
				more: 'y'.repeat(600),
			})
			const body = `<html>
				<head>
					<script id="client-env">
						{"currentUser":{"login":"octocat"}, ${filler.slice(1)}
					</script>
				</head>
			</html>`
			const out = synthesizeMatcher(
				body,
				'text/html',
				'octocat',
				'username'
			)
			assert.equal(out?.redaction?.xPath, '//script[@id="client-env"]')
			assert.ok(out?.redaction?.regex?.includes('(?<username>[A-Za-z0-9_-]+)'))
			assert.equal(
				out?.redaction?.hash,
				undefined,
				'no hash should be set when caller did not request OPRF',
			)
		}
	)

	it('anchors a SMALL HTML element on its markup (provenance)',
		() => {
			// The myshows.me case: <div class="HeaderLogin__username">Qtilla</div>.
			// The element is well under 512B, but a bare `>value<` match would let
			// a user surface the value from any element they control. So the regex
			// spans the whole element (opening tag → closing tag) and captures the
			// value: the reveal carries the class anchor, extraction == target.
			const body =
				'<html><body><span class="name">octocat</span></body></html>'
			const out = synthesizeMatcher(
				body,
				'text/html',
				'octocat',
				'username'
			)
			assert.equal(out?.redaction?.xPath, '//span[contains(@class, "name")]')
			// Regex spans the element and captures the value; whitespace in the
			// markup is matched flexibly (\s*) so it holds across fetches.
			assert.ok(
				out?.redaction?.regex?.includes('<span\\s*class="name">')
				&& out?.redaction?.regex?.includes('(?<username>')
				&& out?.redaction?.regex?.includes('</span>'),
				`expected element-anchored regex, got ${out?.redaction?.regex}`,
			)
			// responseMatches asserts the whole element structure, not bare value.
			assert.equal(
				out?.match.value,
				'<span class="name">{{username}}</span>',
			)
		}
	)

	it('whitespace-adjacent value: contains the element, anchored (not bare)',
		() => {
			// A settings/emails-style page: the value sits inside
			// `<div class="Box-row">`, after template indentation. The match is a
			// `contains` of the element markup with the value → placeholder — the
			// anchor (`Box-row`) lives in the ENFORCED match, so it is never bare.
			// Whitespace is template-deterministic, so baking it into the contains
			// is fine; the redaction's capture regex flexes it (`\s*`) to extract.
			const body = '<div class="Box-row">\n          '
				+ 'primary@example.com\n          </div>'
			const out = synthesizeMatcher(
				body, 'text/html', 'primary@example.com', 'email',
			)
			assert.equal(out?.match.type, 'contains')
			const mv = out?.match.value ?? ''
			assert.notEqual(mv, '{{email}}', 'must not be bare')
			assert.ok(
				mv.includes('Box-row'),
				`match must anchor on the enclosing tag, got ${mv}`,
			)
			assert.ok(mv.includes('{{email}}'), `expected placeholder, got ${mv}`)
			assert.equal(out?.redaction?.xPath, '//div[contains(@class, "Box-row")]')
			assert.ok(out?.redaction?.regex?.includes('(?<email>'))
		}
	)
})

describe('synthesizeMatcher — portable matches', () => {
	it('drops a per-user attr + sibling, anchors on the stable class', () => {
		// The value's <a> carries a per-user href and a sibling holding the
		// username; a portable match keeps neither — it anchors on the class.
		const body = '<html><body>'
			+ '<a href="/octocat" class="color-fg-default">Ada'
			+ '<span class="muted">(octocat)</span></a></body></html>'
		const out = synthesizeMatcher(body, 'text/html', 'Ada', 'name')
		const mv = out?.match.value ?? ''
		assert.equal(out?.match.type, 'contains')
		assert.ok(mv.includes('class="color-fg-default">'), mv)
		assert.ok(mv.includes('{{name}}'), mv)
		assert.ok(!mv.includes('/octocat'), `must not bake href: ${mv}`)
		assert.ok(!mv.includes('(octocat)'), `must not bake sibling: ${mv}`)
	})

	it('drops a per-user attribute id (an <option> value)', () => {
		const body = '<html><body><select>'
			+ '<option class="primary-option" value="8260213">a@b.com</option>'
			+ '</select></body></html>'
		const out = synthesizeMatcher(body, 'text/html', 'a@b.com', 'email')
		const mv = out?.match.value ?? ''
		assert.ok(!mv.includes('8260213'), `must not bake the value id: ${mv}`)
		assert.ok(
			mv.includes('{{email}}') && mv.includes('</option>'),
			`expected placeholder + closing tag, got ${mv}`,
		)
	})

	it('prefers a complete-value meta over the value embedded in text', () => {
		// The userid is a COMPLETE meta attr value AND embedded in a noreply
		// address; the meta is the semantic, portable anchor.
		const body = '<html><head>'
			+ '<meta name="octolytics-actor-id" content="1234567">'
			+ '</head><body><p>Emails: 1234567+user@users.noreply.github.com</p>'
			+ '</body></html>'
		const out = synthesizeMatcher(body, 'text/html', '1234567', 'userId')
		assert.equal(out?.redaction?.xPath, '//meta[@name="octolytics-actor-id"]')
		assert.equal(
			out?.match.value, 'name="octolytics-actor-id" content="{{userId}}"',
		)
	})

	it('drops per-user text preceding the value in a shared text node', () => {
		// `<li>Full Name ( {{id}} )` — a display name precedes the id in the SAME
		// text node. The portable match must anchor on the punctuation, not bake
		// the name (which differs per user).
		const body = '<html><body><section><ul>'
			+ '<li>\n  Full Name ( ABC123 )\n</li></ul></section></body></html>'
		const out = synthesizeMatcher(body, 'text/html', 'ABC123', 'studentid')
		const mv = out?.match.value ?? ''
		assert.equal(out?.match.type, 'contains')
		assert.ok(mv.includes('{{studentid}}'), mv)
		assert.ok(!/Full|Name/.test(mv), `must not bake the name: ${mv}`)
		assert.ok(
			!/Full|Name/.test(out?.redaction?.regex ?? ''),
			`regex must not bake the name: ${out?.redaction?.regex}`,
		)
	})
})

describe('synthesizeMatcher — inline SSR data (SvelteKit and similar)', () => {
	const sveltePage = (data: string) => '<!doctype html><html><body>'
		+ `<div id="svelte"></div><script>\n\tconst data = [null,${data}];\n`
		+ '\tkit.start(app, element, { data });\n</script></body></html>'

	it('anchors a JS-object value on its key name, not on `:"…",`', () => {
		const body = sveltePage(
			'{type:"data",data:{tierStatus:{currentTierCode:"TIER_0",'
			+ 'currentTierDescription:"Atmos™ Member",tusPointsRemaining:33}}}',
		)
		const out = synthesizeMatcher(body, 'text/html', 'Atmos™ Member', 'tier')
		assert.equal(out?.match.value, 'currentTierDescription:"{{tier}}"')
		assert.equal(
			out?.redaction?.regex,
			'currentTierDescription:"(?<tier>[^"<>\\n]+)"',
		)
		assert.match(out?.redaction?.xPath ?? '', /script/)
	})

	it('anchors a quoted JSON key inside a non-JSON script', () => {
		const body = '<html><body><script>window.__STATE__ = '
			+ '{"profile":{"tier":"Gold Plus","miles":1200}};</script></body></html>'
		const out = synthesizeMatcher(body, 'text/html', 'Gold Plus', 'tier')
		assert.equal(out?.match.value, '"tier":"{{tier}}"')
	})

	it('accepts a key repeated with the same value (hydration copies)', () => {
		const body = sveltePage('{a:{status:"Gold Plus"},b:{status:"Gold Plus"}}')
		const out = synthesizeMatcher(body, 'text/html', 'Gold Plus', 'tier')
		assert.equal(out?.match.value, 'status:"{{tier}}"')
	})

	it('rejects a key that repeats with different values', () => {
		const body = sveltePage(
			'{me:{status:"Gold Plus"},partner:{status:"Silver"}}',
		)
		assert.throws(
			() => synthesizeMatcher(body, 'text/html', 'Gold Plus', 'tier'),
			/key "status", but that key occurs 2 times with different values/,
		)
	})

	it('rejects a keyless value whose only window is punctuation', () => {
		// The window `,"{{tier}}","` also matches the `"en-US"` entry.
		const body = sveltePage('null,"Atmos Member","a",null,"en-US","b"')
		assert.throws(
			() => synthesizeMatcher(body, 'text/html', 'Atmos Member', 'tier'),
			/matches 2 values in that element/,
		)
	})

	it('rejects a __data.json window anchored on a user-specific number', () => {
		// SvelteKit devalue: values sit in a positional array; the only literal
		// context before this one is the previous entry, a points balance.
		const body = '{"type":"data","nodes":[{"type":"data","data":'
			+ '[{"user":1},{"tusPointsRemaining":33},"Atmos Member","en-US"]}]}'
		assert.throws(
			() => synthesizeMatcher(
				body, 'application/json', 'Atmos Member', 'tier',
			),
			/number next to the value/,
		)
	})

	it('rejects a __data.json window anchored on a neighbouring value', () => {
		const body = '{"type":"data","nodes":[{"type":"data","data":'
			+ '[{"code":2,"description":3},"TIER_0","Atmos Member","en-US"]}]}'
		assert.throws(
			() => synthesizeMatcher(
				body, 'application/json', 'Atmos Member', 'tier',
			),
			/neighbouring value/,
		)
	})
})
