import { ReclaimClient } from '@reclaimprotocol/client'
import type { ProviderVersionRef } from '@reclaimprotocol/client/openapi'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createVersionFromCaptureTool } from '../src/mcp/tools/agent/publish.ts'
import type { ReclaimProvider } from '../src/provider/schema.ts'
import { bumpVersion } from '../src/provider/to-version.ts'

function draft(): ReclaimProvider {
	return {
		name: 'github-username',
		url: 'https://api.github.com/user',
		method: 'GET',
		responseMatches: [{ type: 'contains', value: '"login":"{{username}}"' }],
		responseRedactions: [{ jsonPath: '$.login' }],
	}
}

function clientWithResponses(
	responses: unknown[],
): {
	client: ReclaimClient
	calls: Array<{ url: string, init?: RequestInit }>
} {
	const calls: Array<{ url: string, init?: RequestInit }> = []
	let index = 0
	const fetch: typeof globalThis.fetch = async(input, init) => {
		calls.push({ url: String(input), init })
		const body = responses[index++]
		assert.notEqual(body, undefined, `unexpected request ${String(input)}`)
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		})
	}

	return {
		client: new ReclaimClient({
			baseUrl: 'https://builder.example',
			fetch,
		}),
		calls,
	}
}

describe('builder provider authoring version semantics', () => {
	it('supports major, minor, and patch bumps', () => {
		const versions = [{
			major: 3,
			minor: 5,
			patch: 8,
			branch: 'draft',
			buildNumber: 4,
		}] satisfies ProviderVersionRef[]
		assert.deepEqual(bumpVersion(versions, 'major'), {
			major: 4,
			minor: 0,
			patch: 0,
		})
		assert.deepEqual(bumpVersion(versions, 'minor'), {
			major: 3,
			minor: 6,
			patch: 0,
		})
		assert.deepEqual(bumpVersion(versions, 'patch'), {
			major: 3,
			minor: 5,
			patch: 9,
		})
	})

	it('creates a new patch version by default, never PATCHes or deletes',
		async() => {
			const { client, calls } = clientWithResponses([
				{
					items: [
						{ version: { major: 1, minor: 0, patch: 0 } },
						{ version: { major: 1, minor: 2, patch: 4 } },
					],
				},
				{ version: { major: 1, minor: 2, patch: 5 } },
			])
			const tool = createVersionFromCaptureTool(client)

			await tool.handler({
				providerId: 'provider-id',
				provider: draft(),
				initialUrl: 'https://github.com',
			})

			assert.deepEqual(
				calls.map((call) => call.init?.method),
				['GET', 'POST'],
			)
			assert.equal(
				calls[1].url,
				'https://builder.example/providers/provider-id/versions',
			)
			const body = JSON.parse(String(calls[1].init?.body)) as {
				version: { major: number, minor: number, patch: number }
			}
			assert.deepEqual(body.version, { major: 1, minor: 2, patch: 5 })
		})

	it('uses an explicit user-directed major/minor/patch version', async() => {
		const { client, calls } = clientWithResponses([
			{
				items: [{ version: { major: 3, minor: 5, patch: 8 } }],
			},
			{ version: { major: 7, minor: 4, patch: 2 } },
		])
		const tool = createVersionFromCaptureTool(client)

		await tool.handler({
			providerId: 'provider-id',
			provider: draft(),
			initialUrl: 'https://github.com',
			version: { major: 7, minor: 4, patch: 2 },
		})

		assert.equal(calls.length, 2)
		assert.equal(calls[1].init?.method, 'POST')
		const body = JSON.parse(String(calls[1].init?.body)) as {
			version: { major: number, minor: number, patch: number }
		}
		assert.deepEqual(body.version, { major: 7, minor: 4, patch: 2 })
	})

	it('rejects an exact version that would reuse or precede existing history',
		async() => {
			const { client, calls } = clientWithResponses([{
				items: [{ version: { major: 3, minor: 5, patch: 8 } }],
			}])
			const tool = createVersionFromCaptureTool(client)

			await assert.rejects(
				tool.handler({
					providerId: 'provider-id',
					provider: draft(),
					initialUrl: 'https://github.com',
					version: { major: 3, minor: 5, patch: 8 },
				}),
				/must be higher than the current highest version/,
			)
			assert.equal(calls.length, 1, 'no create request is sent')
		})
})
