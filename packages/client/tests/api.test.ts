import { Boom, isBoom } from '@hapi/boom'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as api from '../src/api.ts'
import {
	getBooleanFeatureFlag,
	getFeatureFlag,
	getNumberFeatureFlag,
	getStringFeatureFlag,
	isProblemError,
	ReclaimClient,
} from '../src/api.ts'
import * as root from '../src/index.ts'
import type { VerificationRuntimeConfig } from '../src/types/openapi.ts'
import { stubFetch } from './fetch.ts'

function jsonResponse(body: unknown) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	})
}

describe('@reclaimprotocol/client/api', () => {
	it('shares the client and error contract with the package root', () => {
		assert.equal(root.ReclaimClient, api.ReclaimClient)
		assert.equal(root.throwProblemError, api.throwProblemError)
	})

	it('does not expose proof, signing, or encryption helpers', () => {
		assert.equal('verifyRequestProof' in api, false)
		assert.equal('verifyResultFull' in api, false)
		assert.equal('signResultJws' in api, false)
		assert.equal('encryptForEthPublicKey' in api, false)
	})

	it('reads typed session flags with safe local fallbacks', () => {
		const config: VerificationRuntimeConfig = {
			schemaVersion: 1,
			revision: 4,
			resolvedAt: '2026-09-02T00:00:00.000Z',
			values: {
				diagnostics: true,
				transport: 'webview',
				retries: 2,
			},
			evaluations: {},
		}

		assert.equal(getFeatureFlag(config, 'transport'), 'webview')
		assert.equal(getBooleanFeatureFlag(config, 'diagnostics'), true)
		assert.equal(getBooleanFeatureFlag(config, 'transport'), false)
		assert.equal(
			getStringFeatureFlag(config, 'transport', 'browser'),
			'webview',
		)
		assert.equal(getStringFeatureFlag(config, 'missing', 'browser'), 'browser')
		assert.equal(getNumberFeatureFlag(config, 'retries', 0), 2)
		assert.equal(getNumberFeatureFlag(config, 'diagnostics', 0), 0)
	})

	it('calls generated routes without sending a browser-forbidden user agent',
		async() => {
			const { calls, fetch } = stubFetch(() => (
				jsonResponse({ id: 'session-1' })
			))
			const client = new ReclaimClient({
				baseUrl: 'https://builder.test',
				fetch,
			})

			await client.call('GetVerificationSession', {
				params: { sessionId: 'session-1' },
			})

			const [{ url, init }] = calls
			const headers = new Headers(init.headers)
			assert.equal(url, 'https://builder.test/verifications/sessions/session-1')
			assert.equal(headers.get('Accept'), 'application/json')
			assert.equal(headers.has('User-Agent'), false)
		}
	)

	it('throws a structured browser-safe problem error', async() => {
		const { fetch } = stubFetch(() => new Response(JSON.stringify({
			type: 'https://builder.test/problems/not-found',
			title: 'Session not found',
			status: 404,
		}), {
			status: 404,
			headers: { 'Content-Type': 'application/problem+json' },
		}))
		const client = new ReclaimClient({ baseUrl: 'https://builder.test', fetch })

		await assert.rejects(
			client.call('GetVerificationSession', {
				params: { sessionId: 'missing' },
			}),
			(error) => {
				assert.ok(isProblemError(error))
				assert.equal(isBoom(error), true)
				assert.equal(error instanceof Boom, true)
				assert.equal(error.output.statusCode, 404)
				assert.equal(error.data.title, 'Session not found')
				return true
			},
		)
	})
})
