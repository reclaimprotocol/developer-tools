/**
 * Who is using which browser container (`src/cdp/claims.ts`).
 *
 * This is reference counting across separate OS processes, so the interesting
 * cases are the ones where a naive count gets it wrong: one session holding a
 * slot twice, and a session that died without letting go. Both have a concrete
 * cost — the first stops a browser another handle is still using, the second
 * strands 2 GB of container forever.
 *
 * Pure file and pid work, so no Docker and no container needed.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
	busySlots,
	claim,
	ownSlots,
	processAlive,
	release,
} from '../src/cdp/claims.ts'

const SLOT = 'reclaim-browser-0'
const OTHER = 'reclaim-browser-1'

describe('browser slot claims', () => {
	let home: string
	let previous: string | undefined

	before(() => {
		// Claims live under the Reclaim home directory; point it at a temp dir so
		// the test never touches a real one.
		home = mkdtempSync(join(tmpdir(), 'claims-'))
		previous = process.env.RECLAIM_HOME
		process.env.RECLAIM_HOME = home
	})

	after(() => {
		if(previous === undefined) {
			delete process.env.RECLAIM_HOME
		} else {
			process.env.RECLAIM_HOME = previous
		}

		rmSync(home, { recursive: true, force: true })
	})

	it('reports a slot as busy once claimed, and free once released', () => {
		const token = claim(SLOT)
		assert.ok(busySlots().has(SLOT))
		assert.equal(release(SLOT, token), true, 'nobody left, so stop it')
		assert.ok(!busySlots().has(SLOT))
	})

	it('keeps the container alive while a SECOND handle still holds it', () => {
		// The re-attach case: a session adopts the container it is already
		// running, so for a moment the new handle and the old one both hold the
		// slot. Releasing the old one must NOT stop the browser the new one just
		// adopted — which is what happens if claims are counted per process.
		const first = claim(SLOT)
		const second = claim(SLOT)
		assert.notEqual(first, second, 'two handles, two tokens')

		assert.equal(release(SLOT, first), false,
			'someone else still holds it, so leave it running')
		assert.ok(busySlots().has(SLOT))

		assert.equal(release(SLOT, second), true, 'now it can stop')
		assert.ok(!busySlots().has(SLOT))
	})

	it('does not let its own claim push it onto another slot', () => {
		// Re-attaching should come back to the browser this session is already
		// running, not start a second one beside it.
		const token = claim(SLOT)
		assert.ok(ownSlots().has(SLOT))
		assert.ok(!ownSlots().has(OTHER))
		release(SLOT, token)
	})

	it('frees a slot whose session died without releasing it', () => {
		// A killed session runs no cleanup. Liveness of the owning pid is what
		// makes the slot reusable instead of stranding a container.
		const token = claim(SLOT)
		assert.ok(busySlots().has(SLOT))

		// Rewrite the claim as one belonging to a pid that cannot exist.
		writeFileSync(join(home, 'browser-runtime-claims.json'),
			JSON.stringify({ [SLOT]: ['999999999.1'] }))

		assert.ok(!busySlots().has(SLOT),
			'a dead owner does not hold the slot')
		release(SLOT, token)
	})

	it('treats a missing or corrupt file as nobody holding anything', () => {
		const path = join(home, 'browser-runtime-claims.json')
		writeFileSync(path, 'not json at all')
		assert.equal(busySlots().size, 0)

		rmSync(path, { force: true })
		assert.equal(busySlots().size, 0)
	})

	it('knows whether a pid is alive, and rejects nonsense', () => {
		assert.equal(processAlive(process.pid), true)
		assert.equal(processAlive(999_999_999), false)
		assert.equal(processAlive(0), false)
		assert.equal(processAlive(-1), false)
		assert.equal(processAlive(1.5), false)
	})
})
