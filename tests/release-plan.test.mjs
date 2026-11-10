import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchPublishedVersions, planRelease, tagExistsInRepo } from '../scripts/release-plan.mjs'

const client = { name: '@reclaimprotocol/client', version: '1.2.3' }
const agent = { name: '@reclaimprotocol/agent', version: '1.2.3', dependencies: { '@reclaimprotocol/client': '1.2.3' } }

test('publishes both packages when neither is on npm', () => {
	const plan = planRelease({ client, agent, published: {} })
	assert.deepEqual(plan, {
		client_publish: true,
		agent_publish: true,
		release: true,
		version: '1.2.3',
		tag: 'v1.2.3',
		tag_needed: true,
		registry_needed: true,
	})
})

test('publishes only the missing package', () => {
	const plan = planRelease({ client, agent, published: { [client.name]: ['1.2.3'], [agent.name]: ['1.2.2'] } })
	assert.equal(plan.client_publish, false)
	assert.equal(plan.agent_publish, true)
	assert.equal(plan.release, true)
})

test('does nothing when both versions are published', () => {
	const plan = planRelease({ client, agent, published: { [client.name]: ['1.2.3'], [agent.name]: ['1.2.3'] }, tagExists: true })
	assert.equal(plan.release, false)
	assert.equal(plan.tag_needed, false)
	assert.equal(plan.registry_needed, false)
})

test('finishes tag and registry when npm has the versions but the tag is missing', () => {
	const plan = planRelease({ client, agent, published: { [client.name]: ['1.2.3'], [agent.name]: ['1.2.3'] }, tagExists: false })
	assert.equal(plan.release, false)
	assert.equal(plan.tag_needed, true)
	assert.equal(plan.registry_needed, true)
})

test('tagExistsInRepo uses the GitHub API with a token and treats 404 as missing', () => {
	const env = { GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' }
	const calls = []
	assert.equal(tagExistsInRepo('v1', { env, run: (...args) => { calls.push(args); return '' } }), true)
	assert.deepEqual(calls[0].slice(0, 2), ['gh', ['api', 'repos/o/r/git/ref/tags/v1', '--silent']])
	const notFound = () => { throw Object.assign(new Error('gh: Not Found (HTTP 404)'), { stderr: '' }) }
	assert.equal(tagExistsInRepo('v1', { env, run: notFound }), false)
	const broken = () => { throw new Error('boom') }
	assert.throws(() => tagExistsInRepo('v1', { env, run: broken }), /boom/)
})

test('tagExistsInRepo falls back to git ls-remote', () => {
	assert.equal(tagExistsInRepo('v1', { env: {}, run: () => 'abc\trefs/tags/v1\n' }), true)
	assert.equal(tagExistsInRepo('v1', { env: {}, run: () => '' }), false)
})

test('rejects version mismatch', () => {
	assert.throws(() => planRelease({ client, agent: { ...agent, version: '1.2.4' }, published: {} }), /Lockstep/)
})

test('rejects agent dependency drift', () => {
	const drifted = { ...agent, dependencies: { '@reclaimprotocol/client': '^1.2.3' } }
	assert.throws(() => planRelease({ client, agent: drifted, published: {} }), /depends on/)
})

test('fetchPublishedVersions reads the versions map, treats 404 as empty, throws otherwise', async () => {
	const respond = (status, body) => async () => ({ status, ok: status < 400, json: async () => body })
	assert.deepEqual(await fetchPublishedVersions('@a/b', respond(200, { versions: { '1.0.0': {} } })), ['1.0.0'])
	assert.deepEqual(await fetchPublishedVersions('@a/b', respond(404, {})), [])
	await assert.rejects(fetchPublishedVersions('@a/b', respond(500, {})), /500/)
})
