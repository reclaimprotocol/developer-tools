import { ReclaimClient } from '@reclaimprotocol/client'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { providerToRegisterBody } from '../src/old/to-register.ts'
import type { ReclaimProvider } from '../src/provider/schema.ts'
import {
	deriveRequiredContext,
	nextVersion,
	providerToCreateVersionRequest,
} from '../src/provider/to-version.ts'

function draft(overrides: Partial<ReclaimProvider> = {}): ReclaimProvider {
	return {
		name: 'github-username',
		url: 'https://api.github.com/user',
		method: 'GET',
		responseMatches: [
			{ type: 'contains', value: '"login":"{{username}}"' },
		],
		responseRedactions: [{ xPath: '//script[@id="client-env"]' }],
		paramValues: { username: 'octocat' },
		...overrides,
	}
}

describe('deriveRequiredContext', () => {
	it('requires each {{context.*}} placeholder from url and body', () => {
		const schema = deriveRequiredContext([draft({
			url: 'https://github.com/{{context.username}}/repos',
			body: '{"order":"{{context.orderId}}"}',
		})])
		assert.deepEqual(schema, {
			type: 'object',
			required: ['username', 'orderId'],
			properties: {
				username: { type: 'string' },
				orderId: { type: 'string' },
			},
		})
	})

	it('merges {{context.*}} across every request', () => {
		const schema = deriveRequiredContext([
			draft({ url: 'https://github.com/{{context.username}}/repos' }),
			draft({ url: 'https://api.github.com/orgs/{{context.org}}' }),
		])
		assert.deepEqual(schema?.required, ['username', 'org'])
	})

	it('picks up {{context.*}} from injected requests and the script', () => {
		const schema = deriveRequiredContext([draft()], {
			allowedJsRequests: [{
				url: 'https://api.github.com/users/{{context.handle}}/repos',
				method: 'GET',
			}],
			jsUserScripts: 'fetch("/api/{{context.page}}")',
		})
		assert.deepEqual(schema?.required, ['handle', 'page'])
	})

	it('ignores bare {{name}} extraction params (no requiredContext)', () => {
		// The match template's {{username}} and a bare URL param are provider
		// params, not consumer context — no schema is derived for them.
		const body = providerToCreateVersionRequest(
			[draft({ url: 'https://api.github.com/{{username}}' })],
			'https://github.com',
		)
		assert.equal(body.requiredContext, undefined)
	})

	it('flows the derived schema into the create-version body', () => {
		const body = providerToCreateVersionRequest(
			[draft({ url: 'https://github.com/{{context.username}}/repos' })],
			'https://github.com',
		)
		assert.deepEqual(body.requiredContext?.required, ['username'])
	})

	it('derives a SECRET-named context param from the URL without throwing',
		() => {
			// Whether it fits the write-redaction budget depends on the
			// consumer's real value, which doesn't exist yet at publish time —
			// that check runs at verification time instead (verify/run.ts).
			const schema = deriveRequiredContext([draft({
				url: 'https://api.example.com/{{context.SECRET_apiKey}}',
			})])
			assert.deepEqual(schema?.required, ['SECRET_apiKey'])
		})

	it('derives a SECRET-named context param from the body', () => {
		const schema = deriveRequiredContext([draft({
			url: 'https://api.example.com/user',
			body: '{"key":"{{context.SECRET_apiKey}}"}',
		})])
		assert.deepEqual(schema?.required, ['SECRET_apiKey'])
	})

	it('derives a SECRET-named context param from an injected request URL',
		() => {
			const schema = deriveRequiredContext([draft()], {
				allowedJsRequests: [{
					url: 'https://api.example.com/{{context.SECRET_token}}',
					method: 'GET',
				}],
			})
			assert.deepEqual(schema?.required, ['SECRET_token'])
		})
})

describe('providerToCreateVersionRequest request shape', () => {
	it('preserves an explicit major/minor/patch version', () => {
		const body = providerToCreateVersionRequest(
			[draft()],
			'https://github.com',
			{ version: { major: 7, minor: 4, patch: 2 } },
		)
		assert.deepEqual(body.version, { major: 7, minor: 4, patch: 2 })
	})

	it('uses a complete requiredContext supplied for the new version', () => {
		const requiredContext = {
			type: 'object',
			required: ['username'],
			properties: {
				username: {
					type: 'string',
					description: 'GitHub username to verify',
				},
			},
		}
		const body = providerToCreateVersionRequest(
			[draft({ url: 'https://github.com/{{context.username}}' })],
			'https://github.com',
			{ requiredContext },
		)
		assert.deepEqual(body.requiredContext, requiredContext)
	})

	it('emits parallel responseMatches + responseRedactions (no nested extract)',
		() => {
			const body = providerToCreateVersionRequest(
				[draft()],
				'https://github.com',
			)
			const req = body.requests[0] as Record<string, unknown>
			assert.deepEqual(req.responseMatches, [
				{
					type: 'contains',
					value: '"login":"{{username}}"',
					isOptional: false,
				},
			])
			assert.deepEqual(req.responseRedactions, [
				{ xPath: '//script[@id="client-env"]' },
			])
			// The old nested shape must be gone.
			assert.equal('matches' in req, false)
			assert.equal('extract' in (req.responseMatches as object[])[0], false)
		})

	it('forwards writeRedactionMode/additionalClientOptions/geoLocation', () => {
		const body = providerToCreateVersionRequest(
			[draft({
				writeRedactionMode: 'zk',
				additionalClientOptions: { supportedProtocolVersions: ['TLS1_3'] },
			})],
			'https://github.com',
		)
		const req = body.requests[0] as Record<string, unknown>
		assert.equal(req.writeRedactionMode, 'zk')
		assert.deepEqual(req.additionalClientOptions, {
			supportedProtocolVersions: ['TLS1_3'],
		})
	})

	it('emits one request per provider, in order', () => {
		const body = providerToCreateVersionRequest(
			[
				draft({ url: 'https://api.github.com/user' }),
				draft({ url: 'https://api.github.com/orgs' }),
			],
			'https://github.com',
		)
		assert.equal(body.requests.length, 2)
		assert.equal(body.requests[0].url, 'https://api.github.com/user')
		assert.equal(body.requests[1].url, 'https://api.github.com/orgs')
	})

	it('keeps responseMatches/Redactions independent (no padding)', () => {
		// Builder treats the arrays as independent: redactions reveal slices,
		// matches run over the revealed union. A lopsided draft is passed through
		// verbatim — the builder never pads matches to the redaction count.
		const body = providerToCreateVersionRequest(
			[draft({
				responseMatches: [{ type: 'contains', value: 'a' }],
				responseRedactions: [
					{ jsonPath: '$.a' },
					{ jsonPath: '$.b' },
					{ jsonPath: '$.c' },
				],
			})],
			'https://github.com',
		)
		const req = body.requests[0] as Record<string, unknown>
		assert.equal((req.responseMatches as unknown[]).length, 1)
		assert.equal((req.responseRedactions as unknown[]).length, 3)
	})

	it('picks the first provider declaring a non-default geoLocation', () => {
		const body = providerToCreateVersionRequest(
			[draft(), draft({ geoLocation: 'US' })],
			'https://github.com',
		)
		assert.equal(body.webSettings.geoLocation, 'US')
	})

	it('defaults geoLocation to DYNAMIC_GEO when none declare one', () => {
		const body = providerToCreateVersionRequest([draft()], 'https://github.com')
		assert.equal(body.webSettings.geoLocation, '{{DYNAMIC_GEO}}')
	})

	it('forwards isOptional on matches and per-request credentials', () => {
		const body = providerToCreateVersionRequest(
			[draft({
				credentials: 'same-origin',
				responseMatches: [
					{ type: 'contains', value: 'a', isOptional: true },
					{ type: 'regex', value: 'b' },
				],
			})],
			'https://github.com',
		)
		const req = body.requests[0] as Record<string, unknown>
		assert.equal(req.credentials, 'same-origin')
		assert.deepEqual(req.responseMatches, [
			{ type: 'contains', value: 'a', isOptional: true },
			{ type: 'regex', value: 'b', isOptional: false },
		])

		// Defaults preserved when unset: include + false.
		const plain = providerToCreateVersionRequest(
			[draft()],
			'https://github.com',
		)
		assert.equal(plain.requests[0].credentials, 'include')
	})

	it(
		'sets inapp.interceptorOptions ONLY when explicitly requested, ' +
		'defaulting document replay to disabled',
		() => {
			const body = providerToCreateVersionRequest(
				[draft()],
				'https://github.com',
				{ interceptorOptions: { interceptorType: 'HAWKEYE' } },
			)
			const inapp = (
				body.webSettings.clientOptions as Record<string, unknown>
			).inapp as { interceptorOptions: Record<string, unknown> }
			assert.deepEqual(inapp.interceptorOptions, {
				interceptorType: 'HAWKEYE',
				isDocumentRequestReplayEnabled: false,
			})

			const typed = providerToCreateVersionRequest(
				[draft()],
				'https://github.com',
				{ interceptorOptions: { interceptorType: 'CDP' } },
			)
			const inapp2 = (
				typed.webSettings.clientOptions as Record<string, unknown>
			).inapp as { interceptorOptions: Record<string, unknown> }
			assert.deepEqual(inapp2.interceptorOptions, {
				interceptorType: 'CDP',
				isDocumentRequestReplayEnabled: false,
			})

			// ABSENT when the author passed no interceptorOptions at all —
			// builder's schema has no "NONE" interceptorType, so omitting
			// `inapp` entirely IS the no-interception signal. Defaulting
			// `interceptorType` to HAWKEYE here would be a regression: every
			// standard (non-interception) provider would incorrectly publish
			// as a live-interception one.
			const plain = providerToCreateVersionRequest(
				[draft()],
				'https://github.com',
			)
			assert.equal('inapp' in plain.webSettings.clientOptions!, false)
		},
	)

	it(
		'isDocumentRequestReplayEnabled is author-overridable to true',
		() => {
			const body = providerToCreateVersionRequest(
				[draft()],
				'https://github.com',
				{
					interceptorOptions: {
						interceptorType: 'HAWKEYE',
						isDocumentRequestReplayEnabled: true,
					},
				},
			)
			const inapp = (
				body.webSettings.clientOptions as Record<string, unknown>
			).inapp as { interceptorOptions: Record<string, unknown> }
			assert.deepEqual(inapp.interceptorOptions, {
				interceptorType: 'HAWKEYE',
				isDocumentRequestReplayEnabled: true,
			})
		},
	)
})

describe('nextVersion', () => {
	it('bumps only the patch above the highest existing semver', async() => {
		const client = new ReclaimClient({
			baseUrl: 'https://builder.example',
			fetch: async() => new Response(JSON.stringify({
				items: [
					{ version: { major: 1, minor: 8, patch: 3 } },
					{ version: { major: 2, minor: 0, patch: 1 } },
					{ version: { major: 1, minor: 9, patch: 99 } },
				],
			}), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		})

		assert.deepEqual(await nextVersion(client, 'provider-id'), {
			major: 2,
			minor: 0,
			patch: 2,
		})
	})
})

describe('providerToCreateVersionRequest injection', () => {
	it('stores jsUserScripts only when non-empty', () => {
		const withScript = providerToCreateVersionRequest(
			[draft()],
			'https://github.com',
			{ jsUserScripts: 'window.Reclaim?.requestClaim()' },
		)
		assert.equal(
			withScript.webSettings.jsUserScripts,
			'window.Reclaim?.requestClaim()',
		)

		const blank = providerToCreateVersionRequest(
			[draft()],
			'https://github.com',
			{ jsUserScripts: '   ' },
		)
		assert.equal('jsUserScripts' in blank.webSettings, false)
	})

	it('folds allowedJsRequests, multiple/required default true', () => {
		const pageUrl = 'https://api.github.com/page/{{p}}'
		const body = providerToCreateVersionRequest(
			[draft()],
			'https://github.com',
			{
				allowedJsRequests: [
					{ url: pageUrl, method: 'GET' },
					{
						url: 'https://api.github.com/once',
						method: 'GET',
						required: false,
					},
				],
			},
		)
		assert.equal(body.allowedJsRequests.length, 2)
		assert.equal(body.allowedJsRequests[0].multiple, true)
		assert.equal(body.allowedJsRequests[0].required, true)
		assert.equal(body.allowedJsRequests[1].required, false)
		assert.equal(body.allowedJsRequests[0].url, pageUrl)
	})

	it('forwards templateParams/templateParamsMode on allowedJsRequests', () => {
		const body = providerToCreateVersionRequest(
			[draft()],
			'https://github.com',
			{
				allowedJsRequests: [
					{
						url: 'https://api.github.com/item/${id}',
						method: 'GET',
						templateParams: ['id'],
						templateParamsMode: 'merge',
					},
					// no params → templateParams omitted, mode mirrors the default
					{ url: 'https://api.github.com/plain', method: 'GET' },
				],
			},
		)
		assert.deepEqual(body.allowedJsRequests[0].templateParams, ['id'])
		assert.equal(body.allowedJsRequests[0].templateParamsMode, 'merge')
		assert.equal('templateParams' in body.allowedJsRequests[1], false)
		assert.equal(body.allowedJsRequests[1].templateParamsMode, 'separate')
	})

	it('defaults allowedJsRequests to [] when omitted', () => {
		const body = providerToCreateVersionRequest([draft()], 'https://github.com')
		assert.deepEqual(body.allowedJsRequests, [])
	})

	it('stores declared portal browser actions without rewriting them', () => {
		const action = {
			id: 'verify-account',
			origin: 'https://example.com',
			path: '/api/account',
			method: 'POST' as const,
			userAgent: 'Reclaim Browser Action/1.0',
			omitOriginHeader: true,
			inputKeys: ['otp'],
			bodyTemplate: '{"otp":{{otp}}}',
			responseFields: ['status'],
		}
		const body = providerToCreateVersionRequest(
			[draft()],
			'https://example.com',
			{ browserRequestActions: [action] },
		)

		assert.deepEqual(body.webSettings.browserRequestActions, [action])
	})
})

describe('old-devtools context params', () => {
	it('rejects dotted {{context.*}} placeholders with a clear error', () => {
		assert.throws(
			() => providerToRegisterBody(
				[draft({ url: 'https://github.com/{{context.username}}/repos' })],
				{ initialUrl: 'https://github.com' },
			),
			/\{\{context_<name>\}\}/,
		)
	})

	it('accepts the {{context_<name>}} form as a TEMPLATE url', () => {
		const body = providerToRegisterBody(
			[draft({ url: 'https://github.com/{{context_username}}/repos' })],
			{ initialUrl: 'https://github.com' },
		)
		assert.equal(
			(body as { requestData: { urlType: string }[] }).requestData[0].urlType,
			'TEMPLATE',
		)
	})
})
