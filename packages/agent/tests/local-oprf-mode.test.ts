import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { localOprfMode } from '../src/mcp/tools/agent/shared.ts'

const dir = mkdtempSync(join(tmpdir(), 'oprf-mode-'))
const gnark = join(dir, 'bin', 'gnark')
mkdirSync(gnark, { recursive: true })
for(const name of ['darwin-arm64', 'linux-x86_64']) {
	for(const lib of ['libprove', 'libverify']) {
		writeFileSync(join(gnark, `${name}-${lib}.so`), '')
	}
}

// Only the prover exists for this platform.
writeFileSync(join(gnark, 'linux-arm64-libprove.so'), '')

after(() => rmSync(dir, { recursive: true, force: true }))

describe('localOprfMode', () => {
	it('uses oprf when gnark libraries exist for the platform', () => {
		assert.equal(localOprfMode(dir, 'darwin', 'arm64'), 'oprf')
		// Node reports x64; the library file name says x86_64.
		assert.equal(localOprfMode(dir, 'linux', 'x64'), 'oprf')
	})

	it('falls back to oprf-raw without a complete gnark build', () => {
		assert.equal(localOprfMode(dir, 'darwin', 'x64'), 'oprf-raw')
		assert.equal(localOprfMode(dir, 'win32', 'x64'), 'oprf-raw')
		assert.equal(localOprfMode(dir, 'linux', 'arm64'), 'oprf-raw')
		assert.equal(localOprfMode(undefined, 'darwin', 'arm64'), 'oprf-raw')
	})
})
