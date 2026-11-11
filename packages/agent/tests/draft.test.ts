import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	assertNoSecretUrlConflict,
	assertPortableMatches,
	defaultSensitiveHash,
	draftProvider,
	editDraftProvider,
} from '../src/provider/draft.ts'
import type { CapturedRequest } from '../src/provider/schema.ts'
import { loadFixture } from './stub-cdp.ts'

const githubReq: CapturedRequest = {
	requestId: 'r1',
	method: 'GET',
	url: 'https://api.github.com/users/octocat',
	status: 200,
	contentType: 'application/json',
	size: 200,
	requestHeaders: {
		Authorization: 'token ghp_secretvalue',
		Accept: 'application/json',
		'User-Agent': 'reclaim-agent',
		'accept-encoding': 'gzip, deflate, br, zstd',
	},
	responseHeaders: { 'content-type': 'application/json' },
	responseBody: JSON.stringify({ login: 'octocat', followers: 1247 }),
	finishedAt: 0,
}

describe('draftProvider', () => {
	it('separates secret headers from public headers', () => {
		const { provider, secretRefs } = draftProvider(
			githubReq,
			[{ value: '1247', name: 'github-followers' }],
			'github-followers',
		)
		assert.equal(provider.headers?.Accept, 'application/json')
		assert.equal(provider.headers?.Authorization, undefined)
		assert.ok(
			secretRefs.some(
				(r) => r.name === 'Authorization' &&
					r.source === 'header' &&
					r.redacted === true,
			),
		)
	})

	it('emits paramValues + contains template + jsonPath redaction', () => {
		// paramName comes from the provider name's last alphanumeric token.
		const { provider } = draftProvider(
			githubReq, [{ value: '1247', name: 'github-followers' }],
			'github-followers',
		)
		assert.deepEqual(provider.paramValues, { followers: '1247' })
		assert.equal(provider.responseMatches[0].type, 'contains')
		assert.ok(provider.responseMatches[0].value.includes('{{followers}}'))
		assert.equal(provider.responseRedactions?.[0]?.jsonPath, '$.followers')
		assert.ok(
			provider.responseRedactions?.[0]?.regex?.includes('(?<followers>'),
			'jsonPath redaction should carry a value-isolating regex',
		)
	})

	it('drops accept-encoding + connection (attestor sets those)', () => {
		// The attestor builds the request with its own `Connection: close` +
		// `Accept-Encoding: identity`; passing ours would duplicate/collide with
		// what it constructs, so neither should reach the provider params.
		const req: CapturedRequest = {
			...githubReq,
			requestHeaders: {
				...githubReq.requestHeaders,
				Connection: 'keep-alive',
			},
		}
		const { provider } = draftProvider(
			req, [{ value: '1247', name: 'github-followers' }],
			'github-followers',
		)
		assert.equal(provider.headers?.['Accept-Encoding'], undefined)
		assert.equal(provider.headers?.['accept-encoding'], undefined)
		assert.equal(provider.headers?.Connection, undefined)
		assert.equal(provider.headers?.connection, undefined)
		// Other captured headers are kept so the replay looks like the browser.
		assert.equal(provider.headers?.Accept, 'application/json')
		assert.equal(provider.headers?.['User-Agent'], 'reclaim-agent')
	})

	it('strips conditional headers that would 304 at proof time', () => {
		// A browser-captured request carries `if-none-match` (a cached ETag);
		// left in, the origin answers 304 Not Modified when the attestor
		// re-issues it and the proof fails on the non-2xx status.
		const conditionalReq: CapturedRequest = {
			...githubReq,
			requestHeaders: {
				...githubReq.requestHeaders,
				'if-none-match': 'W/"abc123"',
				'If-Modified-Since': 'Mon, 01 Jan 2026 00:00:00 GMT',
			},
		}
		const { provider } = draftProvider(
			conditionalReq, [{ value: '1247', name: 'github-followers' }],
			'github-followers',
		)
		assert.equal(provider.headers?.['if-none-match'], undefined)
		assert.equal(provider.headers?.['If-Modified-Since'], undefined)
		// Non-conditional public headers are untouched.
		assert.equal(provider.headers?.Accept, 'application/json')
	})

	it('strips host / content-length / h2 pseudo-headers', () => {
		// A baked `Host` duplicates the attestor's own (`found: h,h`) → 400 /
		// failed receipt; `content-length` goes stale; `:authority`, and so on.
		// aren't real headers. All must be dropped from the provider.
		const h2Req: CapturedRequest = {
			...githubReq,
			requestHeaders: {
				...githubReq.requestHeaders,
				Host: 'api.github.com',
				'Content-Length': '0',
				'Transfer-Encoding': 'chunked',
				':authority': 'api.github.com',
				':method': 'GET',
			},
		}
		const { provider } = draftProvider(
			h2Req, [{ value: '1247', name: 'github-followers' }],
			'github-followers',
		)
		const keys = Object.keys(provider.headers ?? {}).map((k) => k.toLowerCase())
		for(const banned of [
			'host', 'content-length', 'transfer-encoding', ':authority', ':method',
		]) {
			assert.ok(!keys.includes(banned), `header ${banned} must be stripped`)
		}

		// Ordinary headers still survive.
		assert.equal(provider.headers?.Accept, 'application/json')
	})

	it('strips CSRF headers outright; treats everything else as secret',
		() => {
			// Allowlist classifier: ANY header not on the fixed public list is
			// secret by default — including a stable id like `spacid` (there's
			// no more "stable enough to be public" exception). CSRF-named
			// headers are dropped outright — never even reach secretRefs — since
			// baking in one captured user's token would replay it for everyone.
			const req: CapturedRequest = {
				...githubReq,
				requestHeaders: {
					...githubReq.requestHeaders,
					csrf: 'deadbeefdeadbeefdeadbeefdeadbeef',
					'X-csrf': 'deadbeefdeadbeefdeadbeefdeadbeef',
					'X-Request-Id': 'cafef00dcafef00dcafef00dcafef00d',
					spacid: '1237',
				},
			}
			const { provider, secretRefs } = draftProvider(
				req,
				[{ value: '1247', name: 'github-followers' }],
				'github-followers',
			)
			const keys =
				Object.keys(provider.headers ?? {}).map((k) => k.toLowerCase())
			for(const banned of ['csrf', 'x-csrf', 'x-request-id', 'spacid']) {
				assert.ok(!keys.includes(banned), `header ${banned} must not be public`)
			}

			const secretNames = secretRefs.map((r) => r.name.toLowerCase())
			assert.ok(!secretNames.includes('csrf'), 'csrf must not survive at all')
			assert.ok(!secretNames.includes('x-csrf'), 'x-csrf must not survive')
			assert.ok(secretNames.includes('spacid'), 'spacid is secret, not gone')
			assert.ok(secretNames.includes('x-request-id'), 'x-request-id is secret')

			assert.equal(provider.headers?.Accept, 'application/json')
		})

	it('throws when target value cannot be matched in the response', () => {
		assert.throws(
			() => draftProvider(
				githubReq, [{ value: 'not-present', name: 'bad' }], 'bad',
			),
			/target value/i,
		)
	})

	it('drafts one provider with a match + redaction per target', () => {
		const { provider, extractions } = draftProvider(
			githubReq,
			[
				{ value: '1247', name: 'followers' },
				{ value: 'octocat', name: 'login' },
			],
			'github-profile',
		)
		assert.equal(provider.responseMatches.length, 2)
		assert.equal(provider.responseRedactions?.length, 2)
		assert.equal(extractions.length, 2)
		assert.deepEqual(provider.paramValues, {
			followers: '1247', login: 'octocat',
		})
	})

	it(
		'collision error names both originals + the derived param they share',
		() => {
			const req: CapturedRequest = {
				...githubReq,
				responseBody: JSON.stringify({ first_name: 'Jane', last_name: 'Doe' }),
			}
			assert.throws(
				() => draftProvider(
					req,
					[
						{ value: 'Jane', name: 'first_name' },
						{ value: 'Doe', name: 'last_name' },
					],
					'profile',
				),
				(err: unknown) => {
					const message = (err as Error).message
					return message.includes('"first_name"') &&
						message.includes('"last_name"') &&
						message.includes('"name"')
				},
			)
		},
	)

	it('reports the first colliding pair in a 3-way collision', () => {
		const req: CapturedRequest = {
			...githubReq,
			responseBody: JSON.stringify({
				employer_name: 'Acme', school_name: 'MIT', pet_name: 'Rex',
			}),
		}
		assert.throws(
			() => draftProvider(
				req,
				[
					{ value: 'Acme', name: 'employer_name' },
					{ value: 'MIT', name: 'school_name' },
					{ value: 'Rex', name: 'pet_name' },
				],
				'profile',
			),
			(err: unknown) => {
				const message = (err as Error).message
				return message.includes('"employer_name"') &&
					message.includes('"school_name"') &&
					!message.includes('"pet_name"')
			},
		)
	})

	it('shortens names by default (shortenNames omitted)', () => {
		const req: CapturedRequest = {
			...githubReq,
			responseBody: JSON.stringify({ employer_name: 'Acme' }),
		}
		const { provider } = draftProvider(
			req, [{ value: 'Acme', name: 'employer_name' }], 'profile',
		)
		assert.deepEqual(provider.paramValues, { name: 'Acme' })
	})

	it('uses the name verbatim with shortenNames: false', () => {
		const req: CapturedRequest = {
			...githubReq,
			responseBody: JSON.stringify({ employer_name: 'Acme' }),
		}
		const { provider } = draftProvider(
			req,
			[{ value: 'Acme', name: 'employer_name' }],
			'profile',
			undefined,
			{ shortenNames: false },
		)
		assert.deepEqual(provider.paramValues, { employer_name: 'Acme' })
	})

	it(
		'shortenNames: false rejects a name that is not a plain identifier',
		() => {
			const req: CapturedRequest = {
				...githubReq,
				responseBody: JSON.stringify({ 'employer-name': 'Acme' }),
			}
			assert.throws(
				() => draftProvider(
					req,
					[{ value: 'Acme', name: 'employer-name' }],
					'profile',
					undefined,
					{ shortenNames: false },
				),
				/isn't safe as a param name/,
			)
		},
	)

	it(
		'shortenNames: false still catches a verbatim-name collision',
		() => {
			const req: CapturedRequest = {
				...githubReq,
				responseBody: JSON.stringify({ name: 'Jane', full_name: 'Jane Doe' }),
			}
			assert.throws(
				() => draftProvider(
					req,
					[
						{ value: 'Jane', name: 'name' },
						{ value: 'Jane', name: 'name' },
					],
					'profile',
					undefined,
					{ shortenNames: false },
				),
				(err: unknown) => {
					const message = (err as Error).message
					return message.includes('"name"') &&
						!message.includes('shortened to their last')
				},
			)
		},
	)
})

describe('assertPortableMatches', () => {
	const targets = [
		{ value: 'Utkarsh Soni', name: 'name' },
		{ value: 'LU2300047680', name: 'userid' },
	]

	it('passes when every value appears only as its {{param}}', () => {
		assert.doesNotThrow(() => assertPortableMatches(
			[
				{ type: 'contains', value: '<td>{{name}}</td>' },
				{ type: 'contains', value: '<b>{{userid}} </b>' },
			],
			[
				{ regex: '<td>(?<name>[^"<>\\n]+)</td>', xPath: '/a' },
				{ regex: '<b>(?<userid>[A-Za-z0-9_-]+)\\s*</b>', xPath: '/b' },
			],
			targets,
		))
	})

	it("throws when a match bakes a NEIGHBOUR target's value", () => {
		// The name recipe leaks the studentid that shared its text node.
		assert.throws(
			() => assertPortableMatches(
				[
					{ type: 'contains', value: '<li>{{name}} ( LU2300047680)</li>' },
					{ type: 'contains', value: '<b>{{userid}}</b>' },
				],
				[],
				targets,
			),
			/neighbouring target's per-user value.*LU2300047680/,
		)
	})

	it('throws when a match leaves its OWN value un-templated', () => {
		assert.throws(
			() => assertPortableMatches(
				[{ type: 'contains', value: '<td>Utkarsh Soni</td>' }],
				[],
				[targets[0]],
			),
			/its own value un-templated.*Utkarsh Soni/,
		)
	})

	it('catches a value baked into a redaction regex too', () => {
		assert.throws(
			() => assertPortableMatches(
				[{ type: 'contains', value: '<b>{{userid}}</b>' }],
				[{ regex: '<b>(?<userid>LU2300047680)</b>', xPath: '/b' }],
				targets,
			),
			/responseRedaction regex bakes/,
		)
	})

	it('ignores short structural runs (below the alnum threshold)', () => {
		// A 1-char value like "7" must not trip on ordinary markup digits.
		assert.doesNotThrow(() => assertPortableMatches(
			[{ type: 'contains', value: '<h1 id="col7">{{rank}}</h1>' }],
			[],
			[{ value: '7', name: 'rank' }],
		))
	})

	it('throws when an email local-part is baked (domain-only capture)', () => {
		// Proving an email DOMAIN leaves the local part baked, pinning the
		// provider to this user even though only `domain` is a param.
		assert.throws(
			() => assertPortableMatches(
				[{
					type: 'regex',
					value: '"email":"jane\\.doe@(?<domain>[^"<>\\n]+)"',
				}],
				[{ regex: '"email":"jane\\.doe@(?<domain>[^"<>\\n]+)"' }],
				[{ value: 'alumni.example.edu', name: 'domain' }],
			),
			/per-user email local-part/,
		)
	})

	it('passes a portable full-email {{param}} match', () => {
		// The whole email is the param — no local part baked, so it's portable.
		assert.doesNotThrow(() => assertPortableMatches(
			[{ type: 'contains', value: '"email":"{{email}}"' }],
			[{
				jsonPath: '$.info.email',
				regex: '"email":"(?<email>[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+'
					+ '\\.[A-Za-z]{2,})"',
			}],
			[{ value: 'ada@example.com', name: 'email' }],
		))
	})
})

describe('defaultSensitiveHash — value-shape anti-leak floor', () => {
	it('floors unambiguous PII shapes: email / SSN / IBAN', () => {
		assert.equal(defaultSensitiveHash('ada@example.com'), 'oprf-mpc')
		assert.equal(defaultSensitiveHash('123-45-6789'), 'oprf-mpc')
		assert.equal(defaultSensitiveHash('GB82WEST12345698765432'), 'oprf-mpc')
	})

	it('leaves plaintext: names, usernames, and bare numbers', () => {
		// The proven identity + anything a user can freely re-case (OPRF is
		// byte-exact, so hashing a mutable value is grindable) + ambiguous ids
		// (a private account no. vs a PUBLIC user id / count) → model's call.
		assert.equal(defaultSensitiveHash('Ada Lovelace'), undefined)
		assert.equal(defaultSensitiveHash('octocat'), undefined)
		assert.equal(defaultSensitiveHash('123456789'), undefined)
	})

	it('does not floor a value over the 62-byte OPRF (MPC) cap', () => {
		const longEmail = `${'a'.repeat(60)}@ex.com` // email-shaped but 67 bytes
		assert.equal(defaultSensitiveHash(longEmail), undefined)
	})
})

describe('draftProvider — OPRF integration', () => {
	it('auto-OPRFs an email VALUE in the drafted recipe', () => {
		const req: CapturedRequest = {
			...githubReq,
			responseBody: JSON.stringify({
				name: 'Ada Lovelace', email: 'ada@example.com',
			}),
		}
		const { provider } = draftProvider(
			req, [{ value: 'ada@example.com', name: 'contact' }], 'contact',
		)
		assert.equal(provider.responseRedactions?.[0]?.hash, 'oprf-mpc')
	})

	it('honours an explicit per-target hash over the floor', () => {
		// A bare number isn't floored, but the model can still hash it (for
		// example, a bank account number) via an explicit per-target hash.
		const req: CapturedRequest = {
			...githubReq, responseBody: JSON.stringify({ acct: '123456789' }),
		}
		const { provider } = draftProvider(
			req, [{ value: '123456789', name: 'acct', hash: 'oprf-mpc' }], 'acct',
		)
		assert.equal(provider.responseRedactions?.[0]?.hash, 'oprf-mpc')
	})

	it('throws when an explicitly-hashed value also appears in the URL', () => {
		// Hashing is pointless (and unsupported) if the attestor sees the same
		// value in the clear via the URL's signed context.
		const req: CapturedRequest = {
			...githubReq,
			url: 'https://api.github.com/users/octocat?email=ada@example.com',
			responseBody: JSON.stringify({ email: 'ada@example.com' }),
		}
		assert.throws(
			() => draftProvider(
				req,
				[{ value: 'ada@example.com', name: 'contact', hash: 'oprf-mpc' }],
				'contact',
			),
			/also appears in the request URL/,
		)
	})

	it('throws when the URL-visible value is only floor-hashed', () => {
		// The floor auto-hashes canonical PII shapes even with no explicit
		// `hash` — the URL conflict must still be caught in that case.
		const req: CapturedRequest = {
			...githubReq,
			url: 'https://api.github.com/users/octocat?email=ada@example.com',
			responseBody: JSON.stringify({ email: 'ada@example.com' }),
		}
		assert.throws(
			() => draftProvider(
				req, [{ value: 'ada@example.com', name: 'contact' }], 'contact',
			),
			/also appears in the request URL/,
		)
	})

	it('does not throw when the hashed value is absent from the URL', () => {
		// Baseline: the existing "auto-OPRFs an email" case has a URL with no
		// email in it, so the new gate must stay silent.
		const req: CapturedRequest = {
			...githubReq,
			responseBody: JSON.stringify({
				name: 'Ada Lovelace', email: 'ada@example.com',
			}),
		}
		assert.doesNotThrow(() => draftProvider(
			req, [{ value: 'ada@example.com', name: 'contact' }], 'contact',
		))
	})
})

describe('draftProvider — secret header integration', () => {
	it('throws when a secret header value exceeds the URL char budget', () => {
		// Stripping the header to secretParams only helps if write-redaction can
		// actually hide the overlap — a real secret is always over budget.
		const req: CapturedRequest = {
			...githubReq,
			url: 'https://api.github.com/users/octocat?session=sekret123abc',
			requestHeaders: {
				...githubReq.requestHeaders,
				'X-Session-Token': 'sekret123abc',
			},
			responseBody: JSON.stringify({ name: 'monalisa' }),
		}
		assert.throws(
			() => draftProvider(req, [{ value: 'monalisa', name: 'name' }], 'name'),
			/character budget/,
		)
	})

	it('does not throw when the secret value is absent from the URL', () => {
		// Baseline: githubReq's Authorization header carries a value the URL
		// never repeats, so the gate must stay silent.
		const req: CapturedRequest = {
			...githubReq,
			responseBody: JSON.stringify({ name: 'monalisa' }),
		}
		assert.doesNotThrow(() => draftProvider(
			req, [{ value: 'monalisa', name: 'name' }], 'name',
		))
	})

	it('does not throw when the overlap fits the default key-update budget',
		() => {
			// 2 characters is exactly the key-update (default) budget.
			const req: CapturedRequest = {
				...githubReq,
				url: 'https://api.github.com/users/octocat?v=ab',
				requestHeaders: {
					...githubReq.requestHeaders,
					'X-Session-Token': 'ab',
				},
				responseBody: JSON.stringify({ name: 'monalisa' }),
			}
			assert.doesNotThrow(() => draftProvider(
				req, [{ value: 'monalisa', name: 'name' }], 'name',
			))
		})
})

describe('assertNoSecretUrlConflict', () => {
	it('allows an overlap exactly at the key-update budget (2 chars)', () => {
		assert.doesNotThrow(() => assertNoSecretUrlConflict(
			'https://api.example.com/x?v=ab', { Authorization: 'ab' },
		))
	})

	it('throws once the overlap exceeds the key-update budget by 1 char', () => {
		assert.throws(
			() => assertNoSecretUrlConflict(
				'https://api.example.com/x?v=abc', { Authorization: 'abc' },
			),
			/character budget/,
		)
	})

	it('raises the budget to 12 characters under zk', () => {
		const value = 'a'.repeat(12)
		assert.doesNotThrow(() => assertNoSecretUrlConflict(
			`https://api.example.com/x?v=${value}`, { Authorization: value }, 'zk',
		))
	})

	it('still throws over 12 characters even under zk', () => {
		const value = 'a'.repeat(13)
		assert.throws(
			() => assertNoSecretUrlConflict(
				`https://api.example.com/x?v=${value}`,
				{ Authorization: value },
				'zk',
			),
			/character budget/,
		)
	})

	it('sums overlapping values across every secret, not per-value', () => {
		// Individually each fits the key-update budget; combined they exceed it.
		assert.throws(
			() => assertNoSecretUrlConflict(
				'https://api.example.com/x?a=ab&b=cd',
				{ Authorization: 'ab', Cookie: 'cd' },
			),
			/character budget/,
		)
	})
})

describe('draftProvider — SvelteKit account page', () => {
	const session = loadFixture('sveltekit-tier')
	const page = session.requests.get('page')!
	const data = session.requests.get('data')!
	const targets = [{ value: 'Atmos™ Member', name: 'alaskaStatus' }]

	it('anchors the SSR HTML value on its key name', () => {
		const { provider } = draftProvider(
			page, targets, 'status', undefined, { shortenNames: false },
		)
		assert.deepEqual(provider.responseMatches, [
			{ type: 'contains', value: 'currentTierDescription:"{{alaskaStatus}}"' },
		])
		assert.equal(
			provider.responseRedactions?.[0]?.regex,
			'currentTierDescription:"(?<alaskaStatus>[^"<>\\n]+)"',
		)
	})

	it('refuses the __data.json window anchored on the points balance', () => {
		assert.throws(
			() => draftProvider(
				data, targets, 'status', undefined, { shortenNames: false },
			),
			/number next to the value/,
		)
	})
})

describe('editDraftProvider', () => {
	const { provider, extractions } = draftProvider(
		githubReq, [{ value: '1247', name: 'followers' }], 'followers',
	)

	it('replaces matchers and pairs each extraction with its redaction', () => {
		const redaction = {
			jsonPath: '$.followers', regex: '(?<followers>\\d+)',
		}
		const edited = editDraftProvider(provider, extractions, {
			responseMatches: [{
				type: 'contains', value: '"followers":{{followers}}',
			}],
			responseRedactions: [redaction],
		})
		assert.equal(edited.provider.responseMatches[0].value,
			'"followers":{{followers}}')
		assert.deepEqual(edited.provider.paramValues, { followers: '1247' })
		assert.deepEqual(edited.extractions[0].redaction, redaction)
		assert.deepEqual(edited.warnings, [])
	})

	it('rejects a match that bakes the captured value in', () => {
		assert.throws(
			() => editDraftProvider(provider, extractions, {
				responseMatches: [{ type: 'contains', value: '"followers":1247' }],
			}),
			/its own value un-templated/,
		)
	})

	it('rejects a regex the attestor cannot compile', () => {
		assert.throws(
			() => editDraftProvider(provider, extractions, {
				responseMatches: [{ type: 'regex', value: '(?<followers>\\d+' }],
			}),
			/responseMatches\[0\]\.value is not a valid regex/,
		)
	})

	it('rejects a hashed redaction without exactly one named group', () => {
		assert.throws(
			() => editDraftProvider(provider, extractions, {
				responseRedactions: [{ jsonPath: '$.followers', hash: 'oprf' }],
			}),
			/exactly one named capture group/,
		)
	})

	it('rejects a redaction group that is not a drafted extraction', () => {
		assert.throws(
			() => editDraftProvider(provider, extractions, {
				responseRedactions: [{
					regex: '"login":"(?<login>[^"]+)"', hash: 'oprf-mpc',
				}],
			}),
			/login are not drafted extractions/,
		)
	})

	it('checks the captured value even when paramValues is edited', () => {
		assert.throws(
			() => editDraftProvider(provider, extractions, {
				responseMatches: [{ type: 'contains', value: '"followers":1247' }],
				paramValues: { followers: '9999' },
			}),
			/bakes .* \("1247"\) as a literal/,
		)
	})

	it('rejects hashing a value the URL also reveals', () => {
		const drafted = draftProvider(
			githubReq, [{ value: 'octocat', name: 'login' }], 'login',
		)
		assert.throws(
			() => editDraftProvider(drafted.provider, drafted.extractions, {
				responseRedactions: [{
					jsonPath: '$.login', regex: '(?<login>[^"]+)', hash: 'oprf-mpc',
				}],
			}),
			/OPRF-hashed \(oprf-mpc\) but its value also appears in the request URL/,
		)
	})

	it('refuses to empty the redactions or drop a hash', () => {
		const hashed = editDraftProvider(provider, extractions, {
			responseRedactions: [{
				jsonPath: '$.followers', regex: '(?<followers>\\d+)', hash: 'oprf-mpc',
			}],
		})
		assert.throws(
			() => editDraftProvider(hashed.provider, hashed.extractions, {
				responseRedactions: [],
			}),
			/can't be emptied/,
		)
		assert.throws(
			() => editDraftProvider(hashed.provider, hashed.extractions, {
				responseRedactions: [{
					jsonPath: '$.followers', regex: '(?<followers>\\d+)',
				}],
			}),
			/followers is oprf-mpc-hashed in the draft/,
		)
	})

	it('pins a country and rejects anything else', () => {
		const edited = editDraftProvider(provider, extractions, {
			geoLocation: 'us',
		})
		assert.equal(edited.provider.geoLocation, 'US')
		assert.throws(
			() => editDraftProvider(provider, extractions, { geoLocation: 'USA' }),
			/2-letter ISO country code/,
		)
	})

	it('warns about a template param nothing resolves', () => {
		const edited = editDraftProvider(provider, extractions, {
			responseMatches: [{ type: 'contains', value: '"login":"{{login}}"' }],
		})
		assert.match(edited.warnings[0] ?? '', /\{\{login\}\} has no paramValues/)
	})
})
