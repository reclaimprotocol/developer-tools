import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	assertSecretParamValuesFitUrlBudget,
	classifyHeader,
	classifyParamName,
	secretUrlCharBudget,
	splitSecretParamValues,
	splitSecrets,
} from '../src/provider/secrets.ts'

const CASES: Array<[string, boolean]> = [
	['cookie', true],
	['Cookie', true],
	['authorization', true],
	['Authorization', true],
	['x-csrf-token', true],
	['X-Api-Key', true],
	['x-auth-token', true],
	// Allowlist, not a denylist: even an inert-looking header is secret by
	// default unless it's in the exact public list (same list reclaim-inapp-sdk
	// / reclaim-portal use — see classifyHeader's doc comment).
	['content-type', true],
	['referer', true],
	['x-custom-header', true],
	['accept', false],
	['user-agent', false],
	['accept-language', false],
	['accept-encoding', false],
	['sec-fetch-mode', false],
	['sec-fetch-site', false],
	['sec-fetch-user', false],
	['origin', false],
	['x-requested-with', false],
	['sec-ch-ua', false],
	['sec-ch-ua-mobile', false],
	['Accept', false],
	['User-Agent', false],
]

describe('classifyHeader', () => {
	for(const [name, secret] of CASES) {
		it(`${name} -> secret=${secret}`, () => {
			assert.equal(classifyHeader(name), secret)
		})
	}
})

describe('splitSecrets', () => {
	it('separates secret and public headers', () => {
		const { secrets, publics } = splitSecrets({
			Cookie: 'session=abc',
			Authorization: 'Bearer xyz',
			Accept: 'application/json',
			'User-Agent': 'Mozilla',
		})
		assert.deepEqual(Object.keys(secrets).sort(), ['Authorization', 'Cookie'])
		assert.deepEqual(Object.keys(publics).sort(), ['Accept', 'User-Agent'])
	})
})

describe('classifyParamName', () => {
	it('flags a name containing SECRET, case-insensitively', () => {
		assert.equal(classifyParamName('SECRET_apiKey'), true)
		assert.equal(classifyParamName('secret_apiKey'), true)
		assert.equal(classifyParamName('context.SECRET_apiKey'), true)
		assert.equal(classifyParamName('apiKeySECRET'), true)
	})

	it('leaves an ordinary name public', () => {
		assert.equal(classifyParamName('username'), false)
		assert.equal(classifyParamName('context.orderId'), false)
	})
})

describe('splitSecretParamValues', () => {
	it('routes SECRET-named keys to secrets, the rest to publics', () => {
		const { secrets, publics } = splitSecretParamValues({
			username: 'octocat',
			'context.SECRET_apiKey': 'sk_live_abc',
			orderId: '123',
		})
		assert.deepEqual(secrets, { 'context.SECRET_apiKey': 'sk_live_abc' })
		assert.deepEqual(publics, { username: 'octocat', orderId: '123' })
	})

	it('returns empty maps for an empty input', () => {
		assert.deepEqual(splitSecretParamValues({}), { secrets: {}, publics: {} })
	})
})

describe('secretUrlCharBudget', () => {
	it('is 2 for key-update (the default) and unset', () => {
		assert.equal(secretUrlCharBudget('key-update'), 2)
		assert.equal(secretUrlCharBudget(undefined), 2)
	})

	it('is 12 for zk', () => {
		assert.equal(secretUrlCharBudget('zk'), 12)
	})
})

describe('assertSecretParamValuesFitUrlBudget', () => {
	it('allows a SECRET param in the URL within budget', () => {
		assert.doesNotThrow(() => assertSecretParamValuesFitUrlBudget(
			'https://api.example.com/{{context.SECRET_pin}}',
			undefined,
			{ 'context.SECRET_pin': 'ab' },
			undefined,
		))
	})

	it('throws once the value exceeds the default budget', () => {
		assert.throws(
			() => assertSecretParamValuesFitUrlBudget(
				'https://api.example.com/{{context.SECRET_apiKey}}',
				undefined,
				{ 'context.SECRET_apiKey': 'sk_live_abc' },
				undefined,
			),
			/character budget/,
		)
	})

	it('checks geoLocation too', () => {
		assert.throws(
			() => assertSecretParamValuesFitUrlBudget(
				'https://api.example.com/user',
				'{{context.SECRET_region}}',
				{ 'context.SECRET_region': 'us-east-1-secret' },
				undefined,
			),
			/character budget/,
		)
	})

	it('ignores a SECRET param not actually used in the URL/geoLocation', () => {
		assert.doesNotThrow(() => assertSecretParamValuesFitUrlBudget(
			'https://api.example.com/user',
			undefined,
			{ 'context.SECRET_apiKey': 'sk_live_a_very_long_secret_value' },
			undefined,
		))
	})

	it('raises the budget to 12 under zk', () => {
		const value = 'a'.repeat(12)
		assert.doesNotThrow(() => assertSecretParamValuesFitUrlBudget(
			'https://api.example.com/{{context.SECRET_x}}',
			undefined,
			{ 'context.SECRET_x': value },
			'zk',
		))
	})

	it('sums multiple SECRET params used in the same URL', () => {
		assert.throws(
			() => assertSecretParamValuesFitUrlBudget(
				'https://api.example.com/{{context.SECRET_a}}/{{context.SECRET_b}}',
				undefined,
				{ 'context.SECRET_a': 'ab', 'context.SECRET_b': 'cd' },
				undefined,
			),
			/character budget/,
		)
	})
})
