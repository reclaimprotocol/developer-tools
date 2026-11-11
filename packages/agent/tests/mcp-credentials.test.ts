/**
 * Tests for the eth proof-owner key tools, plus the OAuth authenticate tool
 * registration. The eth key is a plain 0x-hex Ethereum private key (no PEM) —
 * resolved from RECLAIM_PRIVATE_KEY, a RECLAIM_PRIVATE_KEY=0x… line in the
 * project `.env`, or a raw-hex file at RECLAIM_PRIVATE_KEY_FILE.
 * Generated/imported keys are written to the project `.env` (mode 0600). No
 * `~/.reclaim` credential cache. Disk-touching pieces run in temp dirs.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { deriveFromPrivateKey, ReclaimClient } from '@reclaimprotocol/client'
import assert from 'node:assert/strict'
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	statSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { makeDraftStore } from '../src/authoring/index.ts'
import { registerToolList } from '../src/mcp/server.ts'
import type { CaptureStore } from '../src/mcp/tools/agent/capture.ts'
import { sharedAuthoringTools } from '../src/mcp/tools/agent/shared.ts'
import { buildCredentialTools } from '../src/mcp/tools/authenticate/build.ts'
import {
	buildBuilderAuthenticationTools,
	buildBuilderOrganizationTools,
} from '../src/mcp/tools/authenticate/builder-access.ts'
import {
	ENV_FILE,
	normalizeEthHex,
	resolveEthKey,
	writeEthKey,
} from '../src/mcp/tools/authenticate/eth-key.ts'
import { loadFixture } from './stub-cdp.ts'
import type { PrivateServer } from './utils.ts'

// A real secp256k1 private key (32 bytes).
const TEST_PRIVATE_KEY =
	'0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318'

/**
 * Snapshot the eth-key env vars these tests mutate, then clear them so the
 * test starts from a known-empty state. Restore with `restoreEthEnv`.
 */
function saveEthEnv(): { key?: string, keyFile?: string } {
	const saved = {
		key: process.env.RECLAIM_PRIVATE_KEY,
		keyFile: process.env.RECLAIM_PRIVATE_KEY_FILE,
	}
	delete process.env.RECLAIM_PRIVATE_KEY
	delete process.env.RECLAIM_PRIVATE_KEY_FILE
	return saved
}

function restoreEthEnv(saved: { key?: string, keyFile?: string }) {
	const set = (name: string, val: string | undefined) => {
		if(val === undefined) {
			delete process.env[name]
		} else {
			process.env[name] = val
		}
	}

	set('RECLAIM_PRIVATE_KEY', saved.key)
	set('RECLAIM_PRIVATE_KEY_FILE', saved.keyFile)
}

describe('normalizeEthHex', () => {
	it('accepts a 0x-hex key and lowercases it', () => {
		const upper = '0x' + TEST_PRIVATE_KEY.slice(2).toUpperCase()
		assert.equal(normalizeEthHex(upper), TEST_PRIVATE_KEY.toLowerCase())
	})

	it('0x-prefixes and lowercases a bare-hex key', () => {
		const bare = TEST_PRIVATE_KEY.slice(2).toUpperCase()
		assert.equal(normalizeEthHex(bare), TEST_PRIVATE_KEY.toLowerCase())
	})

	it('throws on a malformed / short value', () => {
		assert.throws(() => normalizeEthHex('not-a-key'))
		assert.throws(() => normalizeEthHex('0xabc123'))
	})
})

describe('eth proof-owner key resolution (env / .env / file / none)', () => {
	let projectDir: string
	let savedEnv: { key?: string, keyFile?: string }

	before(() => {
		projectDir = mkdtempSync(join(tmpdir(), 'reclaim-proj-'))
		savedEnv = saveEthEnv()
	})
	after(() => {
		restoreEthEnv(savedEnv)
	})

	it('returns undefined when nothing is set', () => {
		delete process.env.RECLAIM_PRIVATE_KEY
		delete process.env.RECLAIM_PRIVATE_KEY_FILE
		const empty = mkdtempSync(join(tmpdir(), 'reclaim-empty-'))
		assert.equal(resolveEthKey(empty), undefined)
	})

	it('resolves a key from the project .env (source dotenv)', () => {
		delete process.env.RECLAIM_PRIVATE_KEY
		delete process.env.RECLAIM_PRIVATE_KEY_FILE
		const { path } = writeEthKey(TEST_PRIVATE_KEY, projectDir)
		const resolved = resolveEthKey(projectDir)
		assert(resolved)
		assert.equal(resolved.source, 'dotenv')
		assert.equal(resolved.path, path)
		assert.equal(resolved.path, join(projectDir, ENV_FILE))
		assert.equal(
			resolved.address,
			deriveFromPrivateKey(TEST_PRIVATE_KEY).address,
		)
	})

	it('env (0x-hex) wins over a .env in the project', () => {
		const other =
			'0x0000000000000000000000000000000000000000000000000000000000000001'
		process.env.RECLAIM_PRIVATE_KEY = other
		try {
			const resolved = resolveEthKey(projectDir)
			assert(resolved)
			assert.equal(resolved.source, 'env')
			assert.equal(resolved.address, deriveFromPrivateKey(other).address)
		} finally {
			delete process.env.RECLAIM_PRIVATE_KEY
		}
	})

	it('resolves a raw-hex key file via RECLAIM_PRIVATE_KEY_FILE', () => {
		delete process.env.RECLAIM_PRIVATE_KEY
		const keyDir = mkdtempSync(join(tmpdir(), 'reclaim-keyfile-'))
		const keyFile = join(keyDir, 'eth.key')
		writeFileSync(keyFile, TEST_PRIVATE_KEY + '\n', { mode: 0o600 })
		process.env.RECLAIM_PRIVATE_KEY_FILE = keyFile
		try {
			const resolved = resolveEthKey(keyDir)
			assert(resolved)
			assert.equal(resolved.source, 'file')
			assert.equal(resolved.path, keyFile)
			assert.equal(
				resolved.address,
				deriveFromPrivateKey(TEST_PRIVATE_KEY).address,
			)
		} finally {
			delete process.env.RECLAIM_PRIVATE_KEY_FILE
		}
	})
})

describe('issue/import credential tools write the eth key to .env', () => {
	let server: McpServer
	let client: ReclaimClient
	let tempHome: string
	let tempProject: string
	let savedEnv: { key?: string, keyFile?: string }

	before(() => {
		tempHome = mkdtempSync(join(tmpdir(), 'reclaim-home-'))
		tempProject = mkdtempSync(join(tmpdir(), 'reclaim-proj2-'))
		process.env.RECLAIM_HOME = tempHome
		savedEnv = saveEthEnv()

		server = new McpServer({ name: 'test', version: '0.0.0' })
		// A dummy client — issue/import are local-only and never call it.
		client = new ReclaimClient({ baseUrl: 'http://localhost:1' })
		for(const tool of buildCredentialTools(client)) {
			registerToolList(server, [tool])
		}
	})
	after(() => {
		delete process.env.RECLAIM_HOME
		restoreEthEnv(savedEnv)
	})

	function callTool<T extends Record<string, unknown>>(name: string, args: T) {
		const tool = (server as unknown as PrivateServer)._registeredTools[name]
		assert(tool, `tool ${name} not registered`)
		return tool.handler(args, {})
	}

	it('issue_credentials writes a 0600 .env with RECLAIM_PRIVATE_KEY',
		async() => {
			const result = await callTool('issue_credentials', {
				projectDir: tempProject,
			})
			assert.equal(result.isError, undefined, 'should succeed')
			const payload = JSON.parse(result.content[0].text) as {
				address: string
				path: string
			}
			assert.match(payload.address, /^0x[0-9a-f]{40}$/)
			assert.equal(payload.path, join(tempProject, ENV_FILE))

			const env = readFileSync(payload.path, 'utf8')
			assert.match(env, /^RECLAIM_PRIVATE_KEY=0x[0-9a-f]{64}$/m)
			assert.equal(statSync(payload.path).mode & 0o777, 0o600)

			// The private key is never in the response.
			assert.ok(!result.content[0].text.includes('RECLAIM_PRIVATE_KEY=0x'))
			assert.equal(
				(JSON.parse(result.content[0].text) as { privateKey?: string })
					.privateKey,
				undefined,
			)

			// And resolution picks it up from the .env.
			const resolved = resolveEthKey(tempProject)
			assert.equal(resolved?.address, payload.address)
			assert.equal(resolved?.source, 'dotenv')
		})

	it('import_credentials rejects a raw privateKey', async() => {
		const dir = mkdtempSync(join(tmpdir(), 'reclaim-imp-'))
		const result = await callTool('import_credentials', {
			privateKey: TEST_PRIVATE_KEY,
			projectDir: dir,
		})
		assert.equal(result.isError, true)
		assert.equal(existsSync(join(dir, ENV_FILE)), false)
	})

	it('import_credentials (keyFile) yields the same address', async() => {
		const dir = mkdtempSync(join(tmpdir(), 'reclaim-imp2-'))
		const keyDir = mkdtempSync(join(tmpdir(), 'reclaim-imp2-key-'))
		const keyFile = join(keyDir, 'eth.key')
		writeFileSync(keyFile, TEST_PRIVATE_KEY + '\n', { mode: 0o600 })

		const result = await callTool('import_credentials', {
			keyFile,
			projectDir: dir,
		})
		assert.equal(result.isError, undefined)
		const payload = JSON.parse(result.content[0].text) as { address: string }
		assert.equal(
			payload.address,
			deriveFromPrivateKey(TEST_PRIVATE_KEY).address,
		)
	})

	it('resolve_owner_key creates and saves a key when none exists',
		async() => {
			const dir = mkdtempSync(join(tmpdir(), 'reclaim-resolve-'))
			const result = await callTool('resolve_owner_key', { projectDir: dir })
			assert.equal(result.isError, undefined)
			const payload = JSON.parse(result.content[0].text) as {
				ready: boolean
				address: string
				source: string
				path: string
				note: string
			}
			assert.equal(payload.ready, true)
			assert.equal(payload.source, 'generated')
			assert.equal(payload.path, join(dir, ENV_FILE))
			assert.match(payload.note, /Tell the developer once/)
			assert.equal(statSync(payload.path).mode & 0o777, 0o600)
			assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.env$/m)
			assert.ok(!result.content[0].text.includes('RECLAIM_PRIVATE_KEY=0x'))

			// The next call finds the saved key instead of creating another.
			const second = await callTool('resolve_owner_key', { projectDir: dir })
			const again = JSON.parse(second.content[0].text) as {
				address: string
				source: string
			}
			assert.equal(again.address, payload.address)
			assert.equal(again.source, 'dotenv')
		})

	it('import_credentials with bad hex returns an error', async() => {
		const keyFile = join(tempProject, 'bad.key')
		writeFileSync(keyFile, 'not-a-key')
		const result = await callTool('import_credentials', {
			keyFile,
			projectDir: tempProject,
		})
		assert.equal(result.isError, true)
	})
})

describe('run_proof without ownerAddress', () => {
	it('creates a local key and signs with it', async() => {
		const savedEnv = saveEthEnv()
		const savedCwd = process.cwd()
		const project = mkdtempSync(join(tmpdir(), 'reclaim-proof-proj-'))
		writeFileSync(join(project, 'package.json'), '{}')
		process.chdir(project)
		try {
			const session = loadFixture('github-followers')
			const captures: CaptureStore = {
				sessions: new Map([[
					session.captureId,
					// propose/prove never touch the tab client.
					{ session, tabClient: {} as never, drafts: makeDraftStore() },
				]]),
			}
			const proofOpts: Array<{ ownerAddress?: string }> = []
			const tools = sharedAuthoringTools(
				captures,
				async() => assert.fail('no network diagnosis expected'),
				async(_provider, _secrets, opts) => {
					proofOpts.push(opts ?? {})
					return {
						proof: undefined,
						extractedValue: '',
						extractedParameters: {},
						verified: false,
						error: 'Response does not contain X',
					}
				},
			)
			const tool = (name: string) => {
				const found = tools.find((t) => t.definition.name === name)
				assert(found, name)
				return found
			}

			const drafted = await tool('propose_provider').handler({
				captureId: session.captureId,
				requestId: (await tool('find_requests_containing').handler({
					captureId: session.captureId,
					value: '1247',
				}) as { candidates: Array<{ requestId: string }> })
					.candidates[0].requestId,
				target: '1247',
				name: 'github-followers',
			}) as { draftId: string }

			const result = await tool('run_proof').handler({
				captureId: session.captureId,
				draftId: drafted.draftId,
			}) as { ownerKey?: { address: string, source: string, note: string } }

			const saved = resolveEthKey(project)
			assert(saved, 'key saved to the project .env')
			assert.equal(saved.path, join(project, ENV_FILE))
			assert.equal(proofOpts[0].ownerAddress, saved.address)
			assert.equal(result.ownerKey?.address, saved.address)
			assert.equal(result.ownerKey?.source, 'generated')
			assert.match(result.ownerKey?.note ?? '', /Tell the developer once/)
		} finally {
			process.chdir(savedCwd)
			restoreEthEnv(savedEnv)
		}
	})
})

describe('MCP authenticate tool', () => {
	// The OAuth loopback flow itself is covered in authenticate.test.ts; here,
	// assert the tool is registered and advertises the OAuth flow.
	it('registers reclaim_authenticate for the OAuth sign-in flow', () => {
		const client = new ReclaimClient({ baseUrl: 'http://localhost:1' })
		const tool = buildCredentialTools(client)
			.find((t) => t.definition.name === 'reclaim_authenticate')
		assert.ok(tool, 'reclaim_authenticate is registered')
		assert.match(tool.definition.description ?? '', /OAuth|sign in|browser/i)
	})

	it('separates Builder authentication from organization lookup', () => {
		const client = new ReclaimClient({ baseUrl: 'http://localhost:1' })
		const authenticationNames = buildBuilderAuthenticationTools(client)
			.map((tool) => tool.definition.name)
		const organizationNames = buildBuilderOrganizationTools(client)
			.map((tool) => tool.definition.name)
		assert.deepEqual(
			authenticationNames, ['authenticate_builder', 'wait_for_sign_in'],
		)
		assert.deepEqual(organizationNames, ['list_builder_organizations'])
	})
})
