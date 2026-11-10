import { deriveFromPrivateKey, ReclaimClient } from '@reclaimprotocol/client'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
	issueOrgKeypairTool
} from '../src/mcp/tools/authenticate/issue-org-keypair.ts'

const ORG = '11111111-1111-4111-8111-111111111111'
// A throwaway test key, not used anywhere real.
const KEY = `0x${'11'.repeat(32)}`

describe('issue_org_keypair', () => {
	it('writes the private key, registers only the public key, and reuses it',
		async() => {
			const { tool, bodies } = makeTool(200)
			const dir = mkdtempSync(join(tmpdir(), 'reclaim-app-'))
			const first = await tool.handler({
				orgId: ORG, projectDir: dir, envFile: 'packages/backend/.env',
			})
			const envPath = join(dir, 'packages', 'backend', '.env')
			const written = readFileSync(envPath, 'utf8')
				.match(/^RECLAIM_ORG_ETH_PRIVATE_KEY=(0x[0-9a-f]{64})$/m)?.[1]
			assert.ok(written)
			const { address } = deriveFromPrivateKey(written)
			assert.partialDeepStrictEqual(first, { address, reused: false })
			assert.doesNotMatch(JSON.stringify(first), new RegExp(written.slice(2)))
			assert.doesNotMatch(JSON.stringify(bodies), new RegExp(written.slice(2)))
			assert.match(String(bodies[0].publicKey), /^0x04[0-9a-f]{128}$/)
			assert.equal(bodies[0].canEncryptResult, false)
			assert.equal(bodies[0].replace, false)

			const second = await tool.handler({
				orgId: ORG,
				projectDir: dir,
				envFile: 'packages/backend/.env',
				encryptResults: true,
			})
			assert.partialDeepStrictEqual(second, { address, reused: true })
			assert.equal(bodies[1].publicKey, bodies[0].publicKey)
			assert.equal(bodies[1].canEncryptResult, true)
		})

	it('leaves the env file alone when the org has a different key',
		async() => {
			const { tool } = makeTool(409)
			const dir = mkdtempSync(join(tmpdir(), 'reclaim-app-'))
			writeFileSync(join(dir, '.env'), 'A=1\n')
			await assert.rejects(
				tool.handler({ orgId: ORG, projectDir: dir }),
				(err: Error & { output?: { statusCode: number } }) => {
					assert.equal(err.output?.statusCode, 409)
					assert.match(err.message, /`replace: true`/)
					assert.match(err.message, /`update_org_keypair`/)
					return true
				},
			)
			assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'A=1\n')
		})

	it('puts the old key back when the rotation fails', async() => {
		const { tool } = makeTool(500)
		const dir = mkdtempSync(join(tmpdir(), 'reclaim-app-'))
		const envPath = join(dir, '.env')
		writeFileSync(envPath, `A=1\nRECLAIM_ORG_ETH_PRIVATE_KEY=${KEY}\n`)
		await assert.rejects(
			tool.handler({ orgId: ORG, projectDir: dir, replace: true }),
		)
		assert.equal(
			readFileSync(envPath, 'utf8'),
			`A=1\nRECLAIM_ORG_ETH_PRIVATE_KEY=${KEY}\n`,
		)
	})

	it('rotates to a fresh key when replace is true', async() => {
		const { tool, bodies } = makeTool(200)
		const dir = mkdtempSync(join(tmpdir(), 'reclaim-app-'))
		const envPath = join(dir, '.env')
		writeFileSync(envPath, `RECLAIM_ORG_ETH_PRIVATE_KEY=${KEY}\n`)
		const result = await tool.handler({
			orgId: ORG, projectDir: dir, replace: true,
		})
		const written = readFileSync(envPath, 'utf8')
			.match(/^RECLAIM_ORG_ETH_PRIVATE_KEY=(0x[0-9a-f]{64})$/m)?.[1]
		assert.ok(written)
		assert.notEqual(written, KEY)
		assert.partialDeepStrictEqual(result, {
			address: deriveFromPrivateKey(written).address,
			reused: false,
		})
		assert.equal(bodies[0].replace, true)
		// The org's current `canEncryptResult` carries over to the new key.
		assert.equal(bodies[0].canEncryptResult, true)
		assert.doesNotMatch(JSON.stringify(result), new RegExp(written.slice(2)))
		assert.doesNotMatch(JSON.stringify(bodies), new RegExp(written.slice(2)))
		assert.doesNotMatch(JSON.stringify(bodies), new RegExp(KEY.slice(2)))
	})

	it('backs up the old key on each rotation and appends', async() => {
		const { tool } = makeTool(200)
		const dir = mkdtempSync(join(tmpdir(), 'reclaim-app-'))
		const envPath = join(dir, '.env')
		const backupPath = `${envPath}.backup`
		writeFileSync(envPath, `RECLAIM_ORG_ETH_PRIVATE_KEY=${KEY}\n`)
		const first = await tool.handler({
			orgId: ORG, projectDir: dir, replace: true,
		})
		assert.partialDeepStrictEqual(first, { backupFile: backupPath })
		const second = await tool.handler({
			orgId: ORG, projectDir: dir, replace: true,
		})
		const newer = readFileSync(envPath, 'utf8')
			.match(/^RECLAIM_ORG_ETH_PRIVATE_KEY=(0x[0-9a-f]{64})$/m)?.[1]
		assert.ok(newer)
		const lines = readFileSync(backupPath, 'utf8').trim().split('\n')
		assert.equal(lines.length, 4)
		assert.match(lines[0], /^# \S+ replaced by issue_org_keypair$/)
		assert.equal(lines[1], `RECLAIM_ORG_ETH_PRIVATE_KEY=${KEY}`)
		assert.match(lines[2], /^# /)
		assert.notEqual(lines[3], `RECLAIM_ORG_ETH_PRIVATE_KEY=${newer}`)
		assert.match(lines[3], /^RECLAIM_ORG_ETH_PRIVATE_KEY=0x[0-9a-f]{64}$/)
		assert.equal(statSync(backupPath).mode & 0o777, 0o600)
		assert.match(
			readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.env\.backup$/m,
		)
		const out = JSON.stringify([first, second])
		assert.doesNotMatch(out, new RegExp(KEY.slice(2)))
		assert.doesNotMatch(out, new RegExp(newer.slice(2)))
	})

	it('notes when a rotation has no old key to back up', async() => {
		const { tool } = makeTool(200)
		const dir = mkdtempSync(join(tmpdir(), 'reclaim-app-'))
		const result = await tool.handler({
			orgId: ORG, projectDir: dir, replace: true,
		})
		assert.partialDeepStrictEqual(result, { backupFile: null })
		assert.match(
			String((result as { note?: string }).note), /Nothing was backed up/,
		)
	})

	it('keeps a key the env file already holds', async() => {
		const { tool } = makeTool(200)
		const dir = mkdtempSync(join(tmpdir(), 'reclaim-app-'))
		writeFileSync(join(dir, '.env'), `RECLAIM_ORG_ETH_PRIVATE_KEY=${KEY}\n`)
		const result = await tool.handler({ orgId: ORG, projectDir: dir })
		assert.partialDeepStrictEqual(result, { reused: true })
		assert.equal(
			readFileSync(join(dir, '.env'), 'utf8'),
			`RECLAIM_ORG_ETH_PRIVATE_KEY=${KEY}\n`,
		)
	})
})

function makeTool(status: number) {
	const bodies: Array<Record<string, unknown>> = []
	const fetch: typeof globalThis.fetch = async(input, init) => {
		assert.equal(String(input), `https://builder.example/orgs/${ORG}/keypair`)
		if(init?.method === 'GET') {
			return Response.json({ canEncryptResult: true })
		}

		assert.equal(init?.method, 'PUT')
		bodies.push(JSON.parse(String(init?.body)))
		return status === 200
			? Response.json({ canEncryptResult: true })
			: Response.json(
				{ title: 'Error', status, detail: 'different key' },
				{ status, headers: { 'Content-Type': 'application/problem+json' } },
			)
	}

	const tool = issueOrgKeypairTool(
		new ReclaimClient({ baseUrl: 'https://builder.example', fetch }),
	)
	return { tool, bodies }
}
