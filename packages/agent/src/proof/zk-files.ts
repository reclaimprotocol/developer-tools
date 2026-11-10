// Download of the @reclaimprotocol/zk-symmetric-crypto circuit resources the
// proof engines read from disk. Never a `postinstall`: that blocked the MCP
// server's first launch past the connect timeout. Instead the MCP server starts
// the download in the background at launch (`startZkFilesDownload`), and every
// proof awaits it (`ensureZkFiles`) as the safety net.
//
// Proofs default to the stwo engine. Its resources are ~1.5MB, so we fetch only
// `resources/stwo` file by file from the package's pinned commit and check each
// file's git blob hash against the listing for that commit. When that fails
// (GitHub API rate limit, a changed layout), we fall back to the package's own
// downloader, which fetches the whole repository archive (~350MB).
// (In zk-symmetric-crypto 5.1.x the stwo prover loads its WASM from the npm
// package itself; `resources/stwo` is kept as the readiness signal.)

import { badGateway, internal } from '@hapi/boom'
import assert from 'node:assert'
import { spawn as nodeSpawn, type StdioOptions } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import {
	mkdir,
	mkdtemp,
	rename,
	rm,
	writeFile
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO = 'reclaimprotocol/zk-symmetric-crypto'
/** The stwo resource dir; its presence means the circuits are ready. */
const STWO_DIR = join('resources', 'stwo')
/** Where the package's downloader writes the archive, relative to its cwd. */
const ARCHIVE_PATH = join('zk-symmetric-crypto-download', 'repo.zip')

export type ZkFilesState =
	| { status: 'idle' }
	| {
		status: 'downloading'
		/** `stwo-files`: the ~1.5MB stwo files. `full-archive`: the ~350MB
		 *  repository archive (fallback). */
		method: 'stwo-files' | 'full-archive'
		elapsedMs: number
		bytesDownloaded?: number
		totalBytes?: number
	}
	| { status: 'ready' }
	| { status: 'failed', reason: string }

/** Minimal child process surface `download-files.js` is driven through. */
export interface ChildLike {
	once(event: 'exit', listener: (code: number | null) => void): unknown
	once(event: 'error', listener: (err: Error) => void): unknown
}

interface Progress {
	method: 'stwo-files' | 'full-archive'
	startedAt: number
	bytesDownloaded?: number
	totalBytes?: number
	/** The archive file whose size is the progress (full-archive only). */
	archivePath?: string
}

export interface ZkFilesDeps {
	/** The zk-symmetric-crypto package root, or undefined when not installed. */
	resolvePackageDir?: () => string | undefined
	/** The pinned repository commit the package's resources come from. */
	readCommit?: (pkgDir: string) => Promise<string>
	fetch?: typeof fetch
	spawn?: (
		command: string,
		args: string[],
		options: { cwd: string, stdio: StdioOptions },
	) => ChildLike
	/** Progress lines. Defaults to stderr: stdout carries MCP JSON-RPC. */
	log?: (message: string) => void
}

/**
 * Build a downloader with its own state. The module exports one default
 * instance; tests build their own with injected `spawn` and `fetch`.
 */
export function makeZkFiles(deps: ZkFilesDeps = {}) {
	const resolvePackageDir = deps.resolvePackageDir ?? resolveZkPackageDir
	const readCommit = deps.readCommit ?? readPinnedCommit
	const fetchFn = deps.fetch ?? fetch
	const spawn = deps.spawn ?? nodeSpawn
	const log = deps.log ?? ((message: string) => {
		process.stderr.write(`[reclaim-agent] ${message}\n`)
	})

	let inFlight: Promise<void> | undefined
	let failure: string | undefined
	let ready = false
	let progress: Progress | undefined

	return { ensure, start, state }

	/**
	 * Ensure the circuit resources are on disk. Idempotent and
	 * concurrency-safe: one download runs at a time per process, and a failed
	 * attempt clears the latch so a later call retries.
	 */
	function ensure() {
		inFlight ??= download()
			.then(() => {
				ready = true
				failure = undefined
			}, (err: unknown) => {
				inFlight = undefined
				failure = messageOf(err)
				throw err
			})
			.finally(() => {
				progress = undefined
			})
		return inFlight
	}

	/** Start `ensure` in the background; `state` reports the outcome. */
	function start() {
		ensure().catch(() => {})
	}

	function state(): ZkFilesState {
		if(ready) {
			return { status: 'ready' }
		}

		if(progress) {
			const bytesDownloaded = progress.archivePath
				? fileSize(progress.archivePath)
				: progress.bytesDownloaded
			return {
				status: 'downloading',
				method: progress.method,
				elapsedMs: Date.now() - progress.startedAt,
				...(bytesDownloaded !== undefined ? { bytesDownloaded } : {}),
				...(progress.totalBytes !== undefined
					? { totalBytes: progress.totalBytes }
					: {}),
			}
		}

		if(failure !== undefined) {
			return { status: 'failed', reason: failure }
		}

		return { status: 'idle' }
	}

	async function download() {
		const pkgDir = resolvePackageDir()
		// SDK-only consumers don't install the package: nothing to prove.
		if(!pkgDir || existsSync(join(pkgDir, STWO_DIR))) {
			return
		}

		try {
			progress = { method: 'stwo-files', startedAt: Date.now() }
			await fetchStwoFiles(pkgDir, progress)
		} catch(err) {
			const stwoError = messageOf(err)
			log(
				`fetching the stwo proof files failed (${stwoError}); `
				+ 'downloading the full circuit archive (~350MB, one-time)…',
			)
			progress = {
				method: 'full-archive',
				startedAt: Date.now(),
				archivePath: join(pkgDir, ARCHIVE_PATH),
			}
			try {
				await runArchiveDownloader(pkgDir)
			} catch(archiveErr) {
				throw badGateway(
					`stwo files: ${stwoError}; full archive: ${messageOf(archiveErr)}`,
				)
			}
		}

		assert(
			existsSync(join(pkgDir, STWO_DIR)),
			internal(
				`zk circuit download finished but ${join(pkgDir, STWO_DIR)} `
				+ 'is missing; run `npm run download:zk-files` and retry.',
			),
		)
	}

	/**
	 * Fetch `resources/stwo` at the pinned commit, file by file, into a temp
	 * dir inside the package, then rename it into place (same filesystem).
	 */
	async function fetchStwoFiles(pkgDir: string, stats: Progress) {
		const commit = await readCommit(pkgDir)
		assert(/^[0-9a-f]{40}$/.test(commit), internal('invalid pinned commit'))
		const files = await listStwoFiles(commit)
		stats.bytesDownloaded = 0
		stats.totalBytes = files.reduce((sum, f) => sum + f.size, 0)
		log(
			`downloading zkTLS stwo proof files (${stats.totalBytes} bytes, `
			+ 'one-time)…',
		)

		const tmp = await mkdtemp(join(pkgDir, '.stwo-download-'))
		try {
			for(const file of files) {
				const res = await fetchFn(
					`https://raw.githubusercontent.com/${REPO}/${commit}/`
					+ `resources/stwo/${file.name}`,
				)
				assert(
					res.ok,
					badGateway(`stwo file ${file.name}: HTTP ${res.status}`),
				)
				const bytes = new Uint8Array(await res.arrayBuffer())
				assert(
					gitBlobSha(bytes) === file.sha,
					badGateway(`stwo file ${file.name} failed its integrity check`),
				)
				await writeFile(join(tmp, file.name), bytes)
				stats.bytesDownloaded = (stats.bytesDownloaded ?? 0) + bytes.length
			}

			const dest = join(pkgDir, STWO_DIR)
			await mkdir(dirname(dest), { recursive: true })
			// Another process may have finished first; its copy is as good.
			await rename(tmp, dest).catch((err: unknown) => {
				if(!existsSync(dest)) {
					throw err
				}
			})
		} finally {
			await rm(tmp, { recursive: true, force: true })
		}
	}

	/** The file listing of `resources/stwo` at `commit`, with blob hashes. */
	async function listStwoFiles(commit: string) {
		const res = await fetchFn(
			`https://api.github.com/repos/${REPO}/contents/resources/stwo`
			+ `?ref=${commit}`,
			{ headers: { Accept: 'application/vnd.github+json' } },
		)
		assert(res.ok, badGateway(`stwo file listing: HTTP ${res.status}`))
		const listing: unknown = await res.json()
		assert(
			Array.isArray(listing) && listing.length > 0,
			badGateway('stwo file listing is empty'),
		)
		return listing.map((entry: unknown) => {
			assert(
				typeof entry === 'object' && entry !== null
				&& 'type' in entry && entry.type === 'file'
				&& 'name' in entry && typeof entry.name === 'string'
				&& /^[\w.-]+$/.test(entry.name) && !entry.name.startsWith('.')
				&& 'size' in entry && typeof entry.size === 'number'
				&& 'sha' in entry && typeof entry.sha === 'string',
				badGateway('unexpected entry in the stwo file listing'),
			)
			return { name: entry.name, size: entry.size, sha: entry.sha }
		})
	}

	/**
	 * Run the package's `download-files.js`. Its temp paths are relative, so
	 * cwd is the package dir: the archive and extracted tree then sit on the
	 * same filesystem as the final `rename()` (no EXDEV) and never land in the
	 * developer's project.
	 */
	async function runArchiveDownloader(pkgDir: string) {
		const script = join(pkgDir, 'lib', 'scripts', 'download-files.js')
		assert(
			existsSync(script),
			internal(
				'zk circuit downloader not found in '
				+ '@reclaimprotocol/zk-symmetric-crypto; '
				+ 'run `npm run download:zk-files` and retry.',
			),
		)

		await new Promise<void>((resolve, reject) => {
			// stdio fd 1→2: the downloader's progress must never reach the MCP
			// server's JSON-RPC stdout.
			const child = spawn(process.execPath, [script], {
				cwd: pkgDir,
				stdio: ['ignore', 2, 2],
			})
			child.once('error', reject)
			child.once('exit', (code) => {
				if(code === 0) {
					resolve()
				} else {
					reject(internal(`zk circuit download exited with code ${code}`))
				}
			})
		})
	}
}

const DEFAULT = makeZkFiles()

/**
 * Ensure the zk circuit resources are on disk before a proof runs. Resolves
 * at once when they're present or the package isn't installed.
 */
export function ensureZkFiles() {
	return DEFAULT.ensure()
}

/** Start the download in the background (MCP server launch). */
export function startZkFilesDownload() {
	DEFAULT.start()
}

/** Where the download stands: idle, downloading, ready, or failed. */
export function zkFilesState() {
	return DEFAULT.state()
}

/**
 * The zk-symmetric-crypto copy attestor-core loads (it may be nested under
 * attestor-core), else the hoisted one.
 */
function resolveZkPackageDir() {
	const require = createRequire(import.meta.url)
	for(const from of [
		() => createRequire(require.resolve('@reclaimprotocol/attestor-core')),
		() => require,
	]) {
		try {
			// <pkg>/lib/index.js → <pkg>
			return dirname(dirname(
				from().resolve('@reclaimprotocol/zk-symmetric-crypto'),
			))
		} catch{
			// try the next resolution root
		}
	}

	return undefined
}

async function readPinnedCommit(pkgDir: string) {
	const mod: { GIT_COMMIT_HASH?: unknown } = await import(
		pathToFileURL(join(pkgDir, 'lib', 'index.js')).href
	)
	assert(
		typeof mod.GIT_COMMIT_HASH === 'string',
		internal('zk-symmetric-crypto exports no GIT_COMMIT_HASH'),
	)
	return mod.GIT_COMMIT_HASH
}

/** Git's blob object id: sha1 of `blob <size>\0<content>`. */
function gitBlobSha(bytes: Uint8Array) {
	return createHash('sha1')
		.update(`blob ${bytes.length}\0`)
		.update(bytes)
		.digest('hex')
}

function fileSize(path: string) {
	try {
		return statSync(path).size
	} catch{
		return undefined
	}
}

function messageOf(err: unknown) {
	return err instanceof Error ? err.message : String(err)
}
