import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, it } from 'node:test'
import { ConfigStore } from '../src/config/store.ts'

let dir: string

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'reclaim-agent-cfg-'))
})

describe('ConfigStore', () => {
	it('returns undefined when no config exists', () => {
		const c = new ConfigStore(join(dir, 'config.json'))
		assert.equal(c.read(), undefined)
	})

	it('persists and reads back the browser_agent section', () => {
		const c = new ConfigStore(join(dir, 'config.json'))
		c.write({ browser_agent: { attachMode: 'dedicated', port: 9222 } })
		assert.deepEqual(c.read(), {
			version: 1,
			browser_agent: { attachMode: 'dedicated', port: 9222 },
		})
	})

	it('handles a second instance reading the same file', () => {
		const path = join(dir, 'config.json')
		new ConfigStore(path).write({
			browser_agent: { attachMode: 'attach', port: 9333 },
		})
		assert.deepEqual(new ConfigStore(path).read(), {
			version: 1,
			browser_agent: { attachMode: 'attach', port: 9333 },
		})
	})

	it('merges sections on write without clobbering existing ones', () => {
		const path = join(dir, 'config.json')
		const c = new ConfigStore(path)
		c.write({ browser_agent: { attachMode: 'attach', port: 9333 } })
		c.write({
			session: { token: 'tok', expiresAt: '2099-01-01T00:00:00.000Z' },
		})
		assert.deepEqual(new ConfigStore(path).read(), {
			version: 1,
			browser_agent: { attachMode: 'attach', port: 9333 },
			session: { token: 'tok', expiresAt: '2099-01-01T00:00:00.000Z' },
		})
	})

	it('persists the mode section without clobbering other sections', () => {
		const path = join(dir, 'config.json')
		const c = new ConfigStore(path)
		c.write({ browser_agent: { attachMode: 'dedicated', port: 9222 } })
		c.write({ mode: 'builder' })
		assert.deepEqual(new ConfigStore(path).read(), {
			version: 1,
			mode: 'builder',
			browser_agent: { attachMode: 'dedicated', port: 9222 },
		})
	})
})
