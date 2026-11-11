import assert from 'node:assert/strict'
import { test } from 'node:test'
import { claimRejection } from '../src/proof/proof-core.ts'

const signed = {
	claim: { provider: 'http' },
	signatures: { claimSignature: new Uint8Array([1, 2, 3]) },
}

test('a signed claim with no error is not a rejection', () => {
	assert.equal(claimRejection(signed), undefined)
})

test('an attestor error is a rejection, even with a claim present', () => {
	const message = 'error in handling packet at idx 8: Error: invalid proof'
	assert.equal(
		claimRejection({ ...signed, error: { code: 5, message, data: '' } }),
		message,
	)
	assert.equal(
		claimRejection({ ...signed, error: { code: 5, message: '', data: '' } }),
		'attestor error code 5',
	)
})

test('a response without a claim or a claim signature is a rejection', () => {
	assert.equal(claimRejection(undefined), 'attestor returned no claim')
	assert.equal(
		claimRejection({ signatures: signed.signatures }),
		'attestor returned no claim',
	)
	assert.equal(
		claimRejection({ claim: signed.claim, signatures: {} }),
		'attestor did not sign the claim',
	)
	assert.equal(
		claimRejection({
			claim: signed.claim,
			signatures: { claimSignature: new Uint8Array() },
		}),
		'attestor did not sign the claim',
	)
})
