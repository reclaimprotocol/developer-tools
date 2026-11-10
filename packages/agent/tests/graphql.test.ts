import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	extractGraphqlOp,
	looksLikeGraphqlEndpoint,
} from '../src/provider/graphql.ts'

describe('extractGraphqlOp', () => {
	it('returns operationName from a standard graphql POST body', () => {
		const body = JSON.stringify({
			operationName: 'GetUser',
			query: 'query GetUser($id: ID!) { user(id:$id) { id name } }',
			variables: { id: '1' },
		})
		assert.equal(extractGraphqlOp(body), 'GetUser')
	})

	it('parses operationName out of the query when not provided explicitly',
		() => {
			const body = JSON.stringify({
				query: `query GetStars {
					viewer {
						starredRepositories(first:1) {
							totalCount
						}
					}
				}`,
			})
			assert.equal(extractGraphqlOp(body), 'GetStars')
		}
	)

	it('returns undefined for non-graphql bodies', () => {
		assert.equal(extractGraphqlOp('{"foo":1}'), undefined)
		assert.equal(extractGraphqlOp('not json'), undefined)
		assert.equal(extractGraphqlOp(undefined), undefined)
	})
})

describe('looksLikeGraphqlEndpoint', () => {
	it('matches paths containing /graphql', () => {
		assert.equal(
			looksLikeGraphqlEndpoint('https://api.github.com/graphql'),
			true,
		)
		assert.equal(
			looksLikeGraphqlEndpoint('https://x.com/i/api/graphql/abc/MyOp'),
			true,
		)
	})
	it('rejects unrelated paths', () => {
		assert.equal(looksLikeGraphqlEndpoint('https://api.github.com/user'), false)
	})
})
