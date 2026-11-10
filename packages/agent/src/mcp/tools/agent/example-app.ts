/**
 * `create_example_app` — write reclaimprotocol/builder-example into the
 * developer's workspace, so a project with no app starts from a ready-to-run
 * backend and frontend instead of agent-written code. The MCP server fetches
 * the files itself (each checked against its git blob hash) and writes them at
 * the workspace root: the coding agent's later `npm install` and `npm run dev`
 * then run in the workspace it started in, not in a clone. The backend's
 * `@reclaimprotocol/client` is set to the latest published version.
 */
import { badGateway, badRequest, conflict } from '@hapi/boom'
import assert from 'node:assert'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { isAbsolute, join, relative, sep } from 'node:path'
import { defineTool, type RegisteredTool } from '../../server.ts'
import { assertNoSymlinks, upsertEnvVar } from '../authenticate/eth-key.ts'

const REPO = 'reclaimprotocol/builder-example'
/** GitHub tree paths are always `/`-separated, on every OS. */
const BACKEND_PACKAGE = 'packages/backend/package.json'
const CLIENT_PACKAGE = '@reclaimprotocol/client'
/** The example is ~50 small files; anything far past that isn't it. */
const MAX_FILES = 500
const MAX_BYTES = 10_000_000
const BACKEND_ENV_FILE = 'packages/backend/.env'
const DEFAULT_BACKEND_PORT = 3000
/** Ports probed for the backend: 3000, then 3001 through 3020. */
const BACKEND_PORT_TRIES = 21
const LOOPBACK_HOSTS = ['127.0.0.1', '::1']
const PROBE_TIMEOUT_MS = 500
/** Files a workspace may already have. An existing copy is kept, not a
 *  conflict. The env-file tools add their own entries to `.gitignore`. */
const KEEP_EXISTING = new Set(['AGENTS.md', '.gitignore'])

export function exampleAppTool(
	fetchFn: typeof fetch = fetch,
	isPortFree: (port: number) => Promise<boolean> = isLoopbackPortFree,
): RegisteredTool {
	return defineTool<{ projectDir: string }>(
		{
			name: 'create_example_app',
			description:
				'Writes the Reclaim example app (reclaimprotocol/builder-example: '
				+ 'a Fastify backend and a Vite frontend that create sessions, '
				+ 'verify callbacks, and render every verification state) into '
				+ '`projectDir`, and sets its backend to the latest '
				+ '`@reclaimprotocol/client`. It picks a free backend port (3000, else '
				+ 'the next free one, written to `packages/backend/.env`). Use it '
				+ 'when the workspace has no app '
				+ 'yet, with the workspace root you were started in as '
				+ '`projectDir`; don\'t clone the repository yourself. Refuses '
				+ 'when a file it would write already exists with different '
				+ 'content. Returns the commit, file count, client version, '
				+ '`backendPort`, and next steps.',
			inputSchema: {
				type: 'object',
				required: ['projectDir'],
				properties: {
					projectDir: {
						type: 'string',
						description:
							'Absolute path of the workspace root you were started in.',
					},
				},
			},
			annotations: { openWorldHint: true, destructiveHint: false },
		},
		async(args) => {
			assert(
				isAbsolute(args.projectDir),
				badRequest('`projectDir` must be an absolute path.'),
			)
			const projectDir = await realpath(args.projectDir)
			const commit = await latestCommit()
			const files = await listFiles(commit)
			const clientVersion = await latestClientVersion()
			const staged = await Promise.all(files.map(async(file) => {
				const bytes = await download(commit, file)
				return {
					path: file.path,
					bytes: file.path === BACKEND_PACKAGE
						? withClientVersion(bytes, clientVersion)
						: bytes,
				}
			}))
			for(const path of [...staged.map((f) => f.path), BACKEND_ENV_FILE]) {
				assertNoSymlinks(projectDir, path)
			}

			const kept = staged
				.filter(({ path }) => {
					return KEEP_EXISTING.has(path) && existsSync(join(projectDir, path))
				})
				.map(({ path }) => path)
			const toWrite = staged.filter(({ path }) => !kept.includes(path))
			const conflicts = toWrite
				.filter(({ path, bytes }) => {
					const dest = join(projectDir, path)
					return existsSync(dest) && !readFileSync(dest).equals(bytes)
				})
				.map(({ path }) => path)
			assert(
				!conflicts.length,
				conflict(
					'These files already exist with different content: '
					+ `${conflicts.join(', ')}. Ask the developer whether to use `
					+ 'another directory or move them.',
				),
			)

			for(const { path, bytes } of toWrite) {
				await installFile(projectDir, path, bytes)
			}

			const backendPort = await findBackendPort()
			// Always written, so a re-run never leaves a stale port behind.
			upsertEnvVar(projectDir, BACKEND_ENV_FILE, 'PORT', String(backendPort))

			const dev = backendPort === DEFAULT_BACKEND_PORT
				? 'npm run dev'
				: `API_URL=http://localhost:${backendPort} npm run dev`

			return {
				projectDir,
				repository: `https://github.com/${REPO}`,
				commit,
				files: toWrite.length,
				kept,
				clientVersion,
				backendPort,
				next: [
					'Call issue_org_token with this projectDir and envFile '
					+ '"packages/backend/.env".',
					'Run `npm install` from projectDir, then start the dev '
					+ `server with \`${dev}\`. The backend listens on port `
					+ `${backendPort}`
					+ (backendPort === DEFAULT_BACKEND_PORT
						? '.'
						: ` (port ${DEFAULT_BACKEND_PORT} is in use; the frontend `
						+ 'proxy needs `API_URL`).'),
					'Run the dev server in the background and send its output to a '
					+ 'log file in projectDir, for example `npm run dev > '
					+ 'reclaim-dev.log 2>&1`, so callback errors stay readable even '
					+ 'when a shell output filter buffers output.',
					'Give the developer the frontend URL Vite prints in that log. '
					+ 'Don\'t assume port 5173: Vite moves to the next free port '
					+ 'when it is taken.',
					`Call proxy_callback_events({ port: ${backendPort}, path: `
					+ '"/reclaim/callback" }).',
					'If get_org_keypair shows `canEncryptResult: true`, the '
					+ 'callback needs `orgEthPrivateKey`; see the plan.',
					'Put the provider in packages/backend/config.json and restart '
					+ 'the backend.',
					'The backend stores verifications in memory: restarting it '
					+ 'drops sessions in progress, so start a new verification '
					+ 'after any restart.',
				],
			}
		},
	)

	async function findBackendPort() {
		for(let i = 0; i < BACKEND_PORT_TRIES; i++) {
			const port = DEFAULT_BACKEND_PORT + i
			if(await isPortFree(port)) {
				return port
			}
		}

		throw conflict(
			`No free port from ${DEFAULT_BACKEND_PORT} to `
			+ `${DEFAULT_BACKEND_PORT + BACKEND_PORT_TRIES - 1}. Ask the developer `
			+ 'to stop another dev server.',
		)
	}

	async function latestCommit() {
		const res = await fetchFn(
			`https://api.github.com/repos/${REPO}/commits/main`,
			{ headers: { Accept: 'application/vnd.github.sha' } },
		)
		assert(res.ok, badGateway(`${REPO} commit lookup: HTTP ${res.status}`))
		const text = await res.text()
		const commit = text.trim()
		assert(/^[0-9a-f]{40}$/.test(commit), badGateway('invalid commit SHA'))
		return commit
	}

	async function listFiles(commit: string) {
		const res = await fetchFn(
			`https://api.github.com/repos/${REPO}/git/trees/${commit}?recursive=1`,
			{ headers: { Accept: 'application/vnd.github+json' } },
		)
		assert(res.ok, badGateway(`${REPO} file listing: HTTP ${res.status}`))
		const tree: unknown = await res.json()
		assert(
			typeof tree === 'object' && tree !== null && 'tree' in tree
			&& Array.isArray(tree.tree) && !('truncated' in tree && tree.truncated),
			badGateway(`unexpected ${REPO} file listing`),
		)
		const files = tree.tree
			.filter((e: unknown) => {
				return typeof e === 'object' && e !== null && 'type' in e
					&& e.type === 'blob'
			})
			.map((entry: unknown) => {
				assert(
					typeof entry === 'object' && entry !== null
					&& 'path' in entry && typeof entry.path === 'string'
					&& entry.path.split('/').every((s) => /^[\w@.-]+$/.test(s)
						&& s !== '.' && s !== '..' && s !== '.git')
					&& 'sha' in entry && typeof entry.sha === 'string'
					&& 'size' in entry && typeof entry.size === 'number',
					badGateway(`unexpected entry in the ${REPO} file listing`),
				)
				return { path: entry.path, sha: entry.sha, size: entry.size }
			})
		assert(
			files.length > 0 && files.length <= MAX_FILES
			&& files.reduce((n, f) => n + f.size, 0) <= MAX_BYTES,
			badGateway(`unexpected ${REPO} size`),
		)
		return files
	}

	async function download(commit: string, file: { path: string, sha: string }) {
		const res = await fetchFn(
			`https://raw.githubusercontent.com/${REPO}/${commit}/${file.path}`,
		)
		assert(res.ok, badGateway(`${file.path}: HTTP ${res.status}`))
		const bytes = Buffer.from(await res.arrayBuffer())
		assert(
			gitBlobSha(bytes) === file.sha,
			badGateway(`${file.path} failed its integrity check`),
		)
		return bytes
	}

	async function latestClientVersion() {
		const res = await fetchFn(
			`https://registry.npmjs.org/${encodeURIComponent(CLIENT_PACKAGE)}/latest`,
		)
		assert(res.ok, badGateway(`npm ${CLIENT_PACKAGE}: HTTP ${res.status}`))
		const body: unknown = await res.json()
		assert(
			typeof body === 'object' && body !== null && 'version' in body
			&& typeof body.version === 'string'
			&& /^\d+\.\d+\.\d+$/.test(body.version),
			badGateway(`npm ${CLIENT_PACKAGE}: no version`),
		)
		return body.version
	}
}

/**
 * Write one file under `root` without following a symlink out of it or
 * replacing anything: each parent is created one level at a time and must be
 * a real directory, the file is created exclusively (`wx` fails on any path
 * that appeared since the conflict scan, symlinks included), and its real
 * path is checked to still be inside `root` afterwards. A file already there
 * with the same bytes (a re-run) is left as is.
 */
async function installFile(root: string, path: string, bytes: Buffer) {
	const parts = path.split('/')
	let dir = root
	for(const part of parts.slice(0, -1)) {
		dir = join(dir, part)
		await mkdir(dir).catch((err: unknown) => {
			if(!isEexist(err)) {
				throw err
			}
		})
		assertNoSymlinks(root, relative(root, dir))
	}

	const dest = join(dir, parts.at(-1)!)
	try {
		await writeFile(dest, bytes, { flag: 'wx' })
	} catch(err) {
		if(!isEexist(err)) {
			throw err
		}

		assertNoSymlinks(root, path)
		assert(
			readFileSync(dest).equals(bytes),
			conflict(`${path} appeared with different content; nothing replaced`),
		)
		return
	}

	const real = await realpath(dest)
	if(!real.startsWith(root + sep)) {
		await rm(dest, { force: true })
		throw badRequest(`${path} resolved outside the workspace; removed it`)
	}
}

function isEexist(err: unknown) {
	return err instanceof Error && 'code' in err && err.code === 'EEXIST'
}

/** The backend's package.json with the client range set to `^version`. */
function withClientVersion(bytes: Buffer, version: string) {
	const text = bytes.toString('utf8')
	const next = text.replace(
		/("@reclaimprotocol\/client"\s*:\s*")[^"]*(")/,
		(_, open: string, close: string) => `${open}^${version}${close}`,
	)
	assert(
		next !== text || text.includes(`"^${version}"`),
		badGateway(`${BACKEND_PACKAGE} has no ${CLIENT_PACKAGE} dependency`),
	)
	return Buffer.from(next)
}

/** Git's blob object id: sha1 of `blob <size>\0<content>`. */
function gitBlobSha(bytes: Buffer) {
	return createHash('sha1')
		.update(`blob ${bytes.length}\0`)
		.update(bytes)
		.digest('hex')
}

/** True when nothing accepts connections on `port` at 127.0.0.1 or ::1.
 *  Connecting, rather than binding, also catches servers bound to `0.0.0.0`:
 *  macOS lets a loopback bind succeed alongside them. Exported for tests. */
export async function isLoopbackPortFree(port: number) {
	const results = await Promise.all(LOOPBACK_HOSTS.map((host) => {
		return new Promise<boolean>((resolve) => {
			const socket = connect({ port, host, timeout: PROBE_TIMEOUT_MS })
			socket.once('connect', () => {
				socket.destroy()
				resolve(false)
			})
			socket.once('timeout', () => {
				socket.destroy()
				resolve(true)
			})
			socket.once('error', () => resolve(true))
		})
	}))
	return results.every(Boolean)
}
