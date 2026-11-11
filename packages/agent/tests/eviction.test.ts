import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BodyStore } from '../src/cdp/eviction.ts'

describe('BodyStore', () => {
	it('stores and retrieves bodies under the cap', () => {
		const s = new BodyStore({ maxBytes: 1000 })
		s.set('r1', 'hello')
		assert.deepEqual(s.get('r1'), { available: true, body: 'hello' })
	})

	it('evicts LRU entries when the cap is exceeded', () => {
		const s = new BodyStore({ maxBytes: 10 })
		s.set('r1', '12345') // 5 bytes
		s.set('r2', '67890') // 5 bytes — total 10, at cap
		s.set('r3', 'abcde') // 5 bytes — pushes r1 out
		assert.equal(s.get('r1').available, false)
		assert.equal(s.get('r2').available, true)
		assert.equal(s.get('r3').available, true)
	})

	it('records eviction reason in failed lookups', () => {
		const s = new BodyStore({ maxBytes: 5 })
		s.set('r1', '12345')
		s.set('r2', '12345') // evicts r1
		const out = s.get('r1')
		assert.equal(out.available, false)
		if(!out.available) {
			assert.match(out.reason, /evicted/i)
		}
	})

	it('refreshes LRU position on get', () => {
		const s = new BodyStore({ maxBytes: 10 })
		s.set('r1', '12345')
		s.set('r2', '12345')
		s.get('r1') // touch r1, making r2 oldest
		s.set('r3', '12345') // should evict r2, not r1
		assert.equal(s.get('r1').available, true)
		assert.equal(s.get('r2').available, false)
	})
})
