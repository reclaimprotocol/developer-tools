import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { ConfigStore } from '../src/config/store.ts'
import { resolveOldMode } from '../src/consts.ts'
import { buildModeTools } from '../src/mcp/tools/mode/mode.ts'

describe('resolveOldMode precedence', () => {
	const prev = process.env.USE_OLD_DEVTOOLS
	afterEach(() => {
		if(prev === undefined) {
			delete process.env.USE_OLD_DEVTOOLS
		} else {
			process.env.USE_OLD_DEVTOOLS = prev
		}
	})

	it('defaults to builder when nothing is set', () => {
		delete process.env.USE_OLD_DEVTOOLS
		assert.equal(resolveOldMode(undefined), false)
	})

	it('uses the persisted preference when no env var is set', () => {
		delete process.env.USE_OLD_DEVTOOLS
		assert.equal(resolveOldMode('builder'), false)
		assert.equal(resolveOldMode('old'), true)
	})

	it('lets an explicit env var override the persisted preference', () => {
		process.env.USE_OLD_DEVTOOLS = 'false'
		assert.equal(resolveOldMode('old'), false, 'env=false forces builder')
		process.env.USE_OLD_DEVTOOLS = 'true'
		assert.equal(resolveOldMode('builder'), true, 'env=true forces old')
	})

	it('ignores an empty env var (not an explicit override)', () => {
		process.env.USE_OLD_DEVTOOLS = '   '
		assert.equal(resolveOldMode('builder'), false, 'blank env falls through')
	})
})

describe('set_devtools_mode tool', () => {
	let dir: string
	let config: ConfigStore
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'reclaim-mode-'))
		config = new ConfigStore(join(dir, 'config.json'))
	})

	const tool = (oldMode: boolean) => {
		const [t] = buildModeTools(config, oldMode)
		return t
	}

	it('persists the mode and flags a restart when it changes', async() => {
		// Currently old mode; switch to builder.
		const res = (await tool(true).handler({ mode: 'builder' })) as {
			saved: boolean
			mode: string
			effectiveNow: string
			restartRequired: boolean
			configPath: string
		}
		assert.equal(res.saved, true)
		assert.equal(res.mode, 'builder')
		assert.equal(res.effectiveNow, 'old')
		assert.equal(res.restartRequired, true)
		assert.match(res.configPath, /config\.json$/)
		assert.equal(config.read()?.mode, 'builder')
	})

	it('saves without a restart when the mode is already active', async() => {
		const res = (await tool(true).handler({ mode: 'old' })) as {
			restartRequired: boolean
		}
		assert.equal(res.restartRequired, false)
		assert.equal(config.read()?.mode, 'old')
	})
})

describe('get_devtools_mode tool', () => {
	let dir: string
	let config: ConfigStore
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'reclaim-mode-'))
		config = new ConfigStore(join(dir, 'config.json'))
	})

	const prev = process.env.USE_OLD_DEVTOOLS
	afterEach(() => {
		if(prev === undefined) {
			delete process.env.USE_OLD_DEVTOOLS
		} else {
			process.env.USE_OLD_DEVTOOLS = prev
		}
	})

	const tool = (oldMode: boolean) => {
		const t = buildModeTools(config, oldMode)
			.find((e) => e.definition.name === 'get_devtools_mode')
		assert(t, 'get_devtools_mode is registered')
		return t
	}

	type ModeReport = {
		mode: string
		source: string
		persistedMode: string | null
		configPath: string
		builderAuthenticated: boolean
		oldDevtoolsAuthenticated: boolean
		oldDevtoolsIdentityKind: string | null
	}

	it('reports the default builder mode when nothing is set', async() => {
		delete process.env.USE_OLD_DEVTOOLS
		const res = (await tool(false).handler({})) as ModeReport
		assert.equal(res.mode, 'builder')
		assert.equal(res.source, 'default')
		assert.equal(res.persistedMode, null)
		assert.match(res.configPath, /config\.json$/)
	})

	it('reports the persisted builder mode as the config source', async() => {
		delete process.env.USE_OLD_DEVTOOLS
		config.write({ mode: 'builder' })
		const res = (await tool(false).handler({})) as ModeReport
		assert.equal(res.mode, 'builder')
		assert.equal(res.source, 'config')
		assert.equal(res.persistedMode, 'builder')
	})

	it('flags the env override when it disagrees with the persisted mode',
		async() => {
			// The persisted preference says builder, but the env var won at
			// server start (resolveOldMode) — get must surface both facts.
			process.env.USE_OLD_DEVTOOLS = 'true'
			config.write({ mode: 'builder' })
			const res = (await tool(true).handler({})) as ModeReport
			assert.equal(res.mode, 'old')
			assert.equal(res.source, 'env')
			assert.equal(res.persistedMode, 'builder')
		},
	)

	it('reports both auth systems as unauthenticated when neither is set',
		async() => {
			const res = (await tool(true).handler({})) as ModeReport
			assert.equal(res.builderAuthenticated, false)
			assert.equal(res.oldDevtoolsAuthenticated, false)
			assert.equal(res.oldDevtoolsIdentityKind, null)
		},
	)

	it('reports builderAuthenticated only for a still-valid session token',
		async() => {
			config.write({
				session: {
					token: 'tok',
					expiresAt: new Date(Date.now() + 60_000).toISOString(),
				},
			})
			const res = (await tool(true).handler({})) as ModeReport
			assert.equal(res.builderAuthenticated, true)
		},
	)

	it('reports builderAuthenticated as false for an expired session token',
		async() => {
			config.write({
				session: {
					token: 'tok',
					expiresAt: new Date(Date.now() - 60_000).toISOString(),
				},
			})
			const res = (await tool(true).handler({})) as ModeReport
			assert.equal(res.builderAuthenticated, false)
		},
	)

	it('reports oldDevtoolsAuthenticated + identity kind once set', async() => {
		config.write({ old_devtools: { kind: 'eth', uid: 'eth:0xabc' } })
		const res = (await tool(true).handler({})) as ModeReport
		assert.equal(res.oldDevtoolsAuthenticated, true)
		assert.equal(res.oldDevtoolsIdentityKind, 'eth')
	})
})
