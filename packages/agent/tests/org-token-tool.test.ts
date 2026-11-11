import { ReclaimClient } from '@reclaimprotocol/client'
import assert from 'node:assert/strict'
import {
	mkdtempSync,
	readFileSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
	issueOrgTokenTool
} from '../src/mcp/tools/authenticate/issue-org-token.ts'
import { savedOrgKey } from '../src/mcp/tools/authenticate/org-key-store.ts'

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '22222222-2222-4222-8222-222222222222'
const SECRET = 'rorg_supersecretvalue1234'

describe('issue_org_token', () => {
	let home: string
	let saved: string | undefined
	const calls: string[] = []
	const fetch: typeof globalThis.fetch = async(input, init) => {
		calls.push(`${init?.method} ${String(input)}`)
		return new Response(JSON.stringify({
			orgSecret: SECRET,
			id: ORG,
			last4: '1234',
			createMetadata: {},
		}), { status: 201, headers: { 'Content-Type': 'application/json' } })
	}

	const tool = issueOrgTokenTool(
		new ReclaimClient({ baseUrl: 'https://builder.example', fetch }),
	)

	before(() => {
		saved = process.env.RECLAIM_HOME
		home = mkdtempSync(join(tmpdir(), 'reclaim-home-'))
		process.env.RECLAIM_HOME = home
	})
	after(() => {
		if(saved === undefined) {
			delete process.env.RECLAIM_HOME
		} else {
			process.env.RECLAIM_HOME = saved
		}
	})

	it('writes the key to the env file and never returns it', async() => {
		const dir = mkdtempSync(join(tmpdir(), 'reclaim-app-'))
		writeFileSync(join(dir, '.env'), 'A=1\nRECLAIM_ORG_SECRET=old\n')
		const result = await tool.handler({ orgId: ORG, projectDir: dir })

		assert.deepEqual(result, {
			orgId: ORG,
			envFile: join(dir, '.env'),
			envVar: 'RECLAIM_ORG_SECRET',
			last4: '1234',
			backupFile: join(dir, '.env.backup'),
		})
		const backup = readFileSync(join(dir, '.env.backup'), 'utf8')
		assert.match(
			backup,
			/^# \S+ replaced by issue_org_token\nRECLAIM_ORG_SECRET=old\n$/,
		)
		assert.equal(statSync(join(dir, '.env.backup')).mode & 0o777, 0o600)
		assert.match(
			readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.env\.backup$/m,
		)
		assert.doesNotMatch(JSON.stringify(result), /rorg_/)
		assert.equal(
			readFileSync(join(dir, '.env'), 'utf8'),
			`A=1\nRECLAIM_ORG_SECRET=${SECRET}\n`,
		)
		assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600)
		assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.env$/m)
		assert.deepEqual(calls, [`POST https://builder.example/orgs/${ORG}/token`])
	})

	it('appends to the backup on re-issue and skips it when nothing changed',
		async() => {
			const dir = mkdtempSync(join(tmpdir(), 'reclaim-app3-'))
			writeFileSync(join(dir, '.env'), 'RECLAIM_ORG_SECRET=first\n')
			await tool.handler({ orgId: ORG, projectDir: dir })
			writeFileSync(join(dir, '.env'), 'RECLAIM_ORG_SECRET=second\n')
			await tool.handler({ orgId: ORG, projectDir: dir })
			const backup = readFileSync(join(dir, '.env.backup'), 'utf8')
			assert.match(
				backup, /SECRET=first\n[\s\S]*SECRET=second\n/,
			)
			// The env file now holds the same value the API returns again.
			writeFileSync(join(dir, '.env'), `RECLAIM_ORG_SECRET=${SECRET}\n`)
			const result = await tool.handler({ orgId: ORG, projectDir: dir })
			assert.partialDeepStrictEqual(result, { backupFile: null })
			assert.equal(readFileSync(join(dir, '.env.backup'), 'utf8'), backup)
		})

	it('refuses to write the backup through a symlink', async() => {
		const dir = mkdtempSync(join(tmpdir(), 'reclaim-app4-'))
		const outside = join(mkdtempSync(join(tmpdir(), 'reclaim-out-')), 'f')
		writeFileSync(outside, 'keep\n')
		writeFileSync(join(dir, '.env'), 'RECLAIM_ORG_SECRET=old\n')
		symlinkSync(outside, join(dir, '.env.backup'))
		await assert.rejects(
			tool.handler({ orgId: ORG, projectDir: dir }),
			/\.env\.backup is a symlink/,
		)
		assert.equal(readFileSync(outside, 'utf8'), 'keep\n')
	})

	it('saves the key for the org-key tools, per org and most recent',
		() => {
			assert.equal(savedOrgKey(ORG), SECRET)
			assert.equal(savedOrgKey(), SECRET)
			assert.equal(savedOrgKey(OTHER_ORG), undefined)
			assert.equal(statSync(join(home, 'config.json')).mode & 0o777, 0o600)
		})

	it('honours envFile and envVar, and rejects paths outside the project',
		async() => {
			const dir = mkdtempSync(join(tmpdir(), 'reclaim-app2-'))
			await tool.handler({
				orgId: ORG, projectDir: dir, envFile: 'server/.env.local', envVar: 'K',
			})
			assert.equal(
				readFileSync(join(dir, 'server/.env.local'), 'utf8'), `K=${SECRET}\n`,
			)
			assert.match(
				readFileSync(join(dir, '.gitignore'), 'utf8'),
				/^server\/\.env\.local$/m,
			)
			await assert.rejects(
				tool.handler({ orgId: ORG, projectDir: dir, envFile: '../x' }),
				/inside/,
			)
			await assert.rejects(
				tool.handler({ orgId: ORG, projectDir: 'relative' }),
				/absolute/,
			)
		})
})
