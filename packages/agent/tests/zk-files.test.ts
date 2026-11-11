import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { makeZkFiles, type ZkFilesDeps } from '../src/proof/zk-files.ts'

const COMMIT = 'a'.repeat(40)
const WASM = new Uint8Array([0, 97, 115, 109, 1, 2, 3])
const LISTING = [
	{
		name: 's2circuits_bg.wasm',
		type: 'file',
		size: WASM.length,
		sha: blobSha(WASM),
	},
]

describe('zk proof files', () => {
	it('fetches only the stwo files at the pinned commit', async() => {
		const pkgDir = makePackageDir()
		const urls: string[] = []
		const zk = makeZkFiles({
			...baseDeps(pkgDir),
			fetch: async(input) => {
				const url = String(input)
				urls.push(url)
				return isListingUrl(url)
					? Response.json(LISTING)
					: new Response(WASM)
			},
		})

		await zk.ensure()

		assert.deepEqual(zk.state(), { status: 'ready' })
		assert.deepEqual(
			readFileSync(join(pkgDir, 'resources', 'stwo', 's2circuits_bg.wasm')),
			Buffer.from(WASM),
		)
		assert.ok(urls.every((u) => u.includes(COMMIT)), urls.join('\n'))
		// The temp dir is renamed into place; nothing is left behind.
		assert.deepEqual(readdirSync(pkgDir).sort(), ['lib', 'resources'])
	})

	it('falls back to the package downloader, run from the package dir, '
		+ 'when a stwo file fails its integrity check', async() => {
		const pkgDir = makePackageDir()
		const spawns: Array<{ args: string[], cwd: string }> = []
		const zk = makeZkFiles({
			...baseDeps(pkgDir),
			fetch: async(input) => {
				return isListingUrl(input)
					? Response.json(LISTING)
					: new Response(new Uint8Array([9, 9, 9]))
			},
			spawn: (_command, args, { cwd }) => {
				spawns.push({ args, cwd })
				return exitWith(0, () => {
					mkdirSync(join(pkgDir, 'resources', 'stwo'), { recursive: true })
				})
			},
		})

		await zk.ensure()

		assert.equal(spawns.length, 1)
		assert.equal(spawns[0].cwd, pkgDir)
		assert.equal(
			spawns[0].args[0],
			join(pkgDir, 'lib', 'scripts', 'download-files.js'),
		)
		assert.deepEqual(zk.state(), { status: 'ready' })
	})

	it('fails when the downloader exits 0 without resources/stwo', async() => {
		const pkgDir = makePackageDir()
		const zk = makeZkFiles({
			...baseDeps(pkgDir),
			fetch: async() => new Response('rate limited', { status: 403 }),
			spawn: () => exitWith(0),
		})

		await assert.rejects(zk.ensure(), /resources\/stwo.*missing/)
		const state = zk.state()
		assert.equal(state.status, 'failed')
		assert.match(
			state.status === 'failed' ? state.reason : '',
			/resources\/stwo.*missing/,
		)
	})

	it('runs one download for concurrent callers and retries after failure',
		async() => {
			const pkgDir = makePackageDir()
			let spawned = 0
			let exitCode = 1
			const zk = makeZkFiles({
				...baseDeps(pkgDir),
				fetch: async() => new Response('', { status: 500 }),
				spawn: () => {
					spawned++
					return exitWith(exitCode, () => {
						if(exitCode === 0) {
							mkdirSync(join(pkgDir, 'resources', 'stwo'), {
								recursive: true,
							})
						}
					})
				},
			})

			const results = await Promise.allSettled([zk.ensure(), zk.ensure()])
			assert.equal(spawned, 1)
			assert.ok(results.every((r) => r.status === 'rejected'))
			const failed = zk.state()
			assert.equal(failed.status, 'failed')
			assert.match(
				failed.status === 'failed' ? failed.reason : '',
				/stwo file listing: HTTP 500.*exited with code 1/,
			)

			exitCode = 0
			await zk.ensure()
			assert.equal(spawned, 2)
			assert.deepEqual(zk.state(), { status: 'ready' })
		})

	it('reports downloading progress while the files are fetched', async() => {
		const pkgDir = makePackageDir()
		let release = () => {}

		const zk = makeZkFiles({
			...baseDeps(pkgDir),
			fetch: async(input) => {
				if(isListingUrl(input)) {
					return Response.json(LISTING)
				}

				await new Promise<void>((resolve) => {
					release = resolve
				})
				return new Response(WASM)
			},
		})

		assert.deepEqual(zk.state(), { status: 'idle' })
		const done = zk.ensure()
		await waitFor(() => zk.state().status === 'downloading')
		await waitFor(() => {
			const state = zk.state()
			return state.status === 'downloading' && state.totalBytes !== undefined
		})
		const state = zk.state()
		assert.equal(state.status, 'downloading')
		assert.equal(state.status === 'downloading' && state.method, 'stwo-files')
		assert.equal(
			state.status === 'downloading' && state.totalBytes,
			WASM.length,
		)
		release()
		await done
		assert.deepEqual(zk.state(), { status: 'ready' })
	})

	it('is ready at once when resources/stwo already exists', async() => {
		const pkgDir = makePackageDir()
		mkdirSync(join(pkgDir, 'resources', 'stwo'), { recursive: true })
		const zk = makeZkFiles({
			...baseDeps(pkgDir),
			fetch: async() => assert.fail('must not fetch'),
			spawn: () => assert.fail('must not spawn'),
		})

		await zk.ensure()
		assert.deepEqual(zk.state(), { status: 'ready' })
		assert.equal(
			existsSync(join(pkgDir, 'zk-symmetric-crypto-download')),
			false,
		)
	})
})

/** A fake zk-symmetric-crypto package dir with its downloader script. */
function makePackageDir() {
	const pkgDir = mkdtempSync(join(tmpdir(), 'reclaim-zk-'))
	mkdirSync(join(pkgDir, 'lib', 'scripts'), { recursive: true })
	writeFileSync(join(pkgDir, 'lib', 'scripts', 'download-files.js'), '')
	return pkgDir
}

function baseDeps(pkgDir: string): ZkFilesDeps {
	return {
		resolvePackageDir: () => pkgDir,
		readCommit: async() => COMMIT,
		log: () => {},
		spawn: () => assert.fail('unexpected spawn'),
	}
}

/** A child process that runs `effect` and exits with `code` next tick. */
function exitWith(code: number, effect = () => {}) {
	const child = new EventEmitter()
	setImmediate(() => {
		effect()
		child.emit('exit', code)
	})
	return child
}

function blobSha(bytes: Uint8Array) {
	return createHash('sha1')
		.update(`blob ${bytes.length}\0`)
		.update(bytes)
		.digest('hex')
}

async function waitFor(condition: () => boolean) {
	for(let i = 0; i < 200 && !condition(); i++) {
		await new Promise((resolve) => setTimeout(resolve, 5))
	}

	assert.ok(condition(), 'condition never became true')
}

/** The GitHub contents API listing, as opposed to a raw file download. */
function isListingUrl(input: unknown) {
	return new URL(String(input)).hostname === 'api.github.com'
}
