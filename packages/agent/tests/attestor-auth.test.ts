import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAttestorAuthentication } from '../src/proof/attestor-auth.ts'

const TEST_PRIVATE_KEY = `0x${'11'.repeat(32)}`

test('attestor auth is optional without a configured key', async() => {
	assert.equal(
		await createAttestorAuthentication('session-1', undefined),
		undefined,
	)
})

test('attestor authentication uses the legacy base64 JSON token', async() => {
	const auth = await createAttestorAuthentication(
		'session-1',
		TEST_PRIVATE_KEY,
	)
	assert(auth)
	assert.equal(auth.request.data?.id, 'session-1')

	const json = Buffer.from(auth.token, 'base64').toString('utf8')
	assert.match(json, /"id":"session-1"/)
	assert.match(json, /"signature":"[A-Za-z0-9+/]+=*"/)
})
