import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
	exampleAppTool,
	isLoopbackPortFree,
} from '../src/mcp/tools/agent/example-app.ts'

const COMMIT = 'c'.repeat(40)
const FILES: Record<string, string> = {
	'README.md': '# Builder example\n',
	'AGENTS.md': '# Working in this repository\n',
	'.gitignore': 'node_modules/**\n.env\n',
	'packages/backend/package.json':
		'{\n  "dependencies": {\n    "@reclaimprotocol/client": "^0.1.36"\n'
		+ '  }\n}\n',
}

describe('create_example_app', () => {
	it('keeps port 3000 when it is free', async() => {
		const dir = mkdtempSync(join(tmpdir(), 'reclaim-ws-'))
		const result = await run(makeTool(), dir)

		assert.equal(result.backendPort, 3000)
		assert.match(
			readFileSync(join(dir, 'packages/backend/.env'), 'utf8'),
			/^PORT=3000$/m,
		)
		const next = result.next.join('\n')
		assert.match(next, /`npm run dev`/)
		assert.match(next, /port: 3000,/)
		assert.match(next, /frontend URL Vite prints/)
		assert.match(next, /reclaim-dev\.log/)
		assert.match(next, /in memory/)
	})

	it('moves the backend to the next free port when 3000 is busy',
		async() => {
			const dir = mkdtempSync(join(tmpdir(), 'reclaim-ws-'))
			const result = await run(makeTool({}, [3000]), dir)

			assert.equal(result.backendPort, 3001)
			assert.match(
				readFileSync(join(dir, 'packages/backend/.env'), 'utf8'),
				/^PORT=3001$/m,
			)
			const next = result.next.join('\n')
			assert.match(next, /API_URL=http:\/\/localhost:3001 npm run dev/)
			assert.match(next, /port: 3001,/)
		})

	it('keeps the AGENTS.md and .gitignore the workspace already has',
		async() => {
			const dir = mkdtempSync(join(tmpdir(), 'reclaim-ws-'))
			writeFileSync(join(dir, 'AGENTS.md'), '# Mine\n')
			writeFileSync(join(dir, '.gitignore'), 'dist\n')
			const result = await makeTool().handler({ projectDir: dir })

			assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), '# Mine\n')
			assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^dist$/m)
			assert.partialDeepStrictEqual(
				result, { kept: ['AGENTS.md', '.gitignore'] },
			)
			assert.ok(existsSync(join(dir, 'README.md')))
		})

	it('sees a port taken by a server bound to every address', async() => {
		const server = createServer().listen(0, '0.0.0.0')
		await once(server, 'listening')
		const address = server.address()
		assert(typeof address === 'object' && address)
		try {
			assert.equal(await isLoopbackPortFree(address.port), false)
		} finally {
			server.close()
		}
	})

	it('writes the example at the workspace root with the latest client',
		async() => {
			const dir = mkdtempSync(join(tmpdir(), 'reclaim-ws-'))
			const result = await makeTool().handler({ projectDir: dir })

			assert.partialDeepStrictEqual(result, {
				commit: COMMIT, files: 4, kept: [], clientVersion: '0.2.0',
			})
			assert.equal(
				readFileSync(join(dir, 'README.md'), 'utf8'), FILES['README.md'],
			)
			assert.match(
				readFileSync(join(dir, 'packages/backend/package.json'), 'utf8'),
				/"@reclaimprotocol\/client": "\^0\.2\.0"/,
			)
			// The staging dir is gone; only the example's files remain, plus the
			// `.gitignore` entry that keeps `packages/backend/.env` out of git.
			assert.deepEqual(
				readdirSync(dir).sort(),
				['.gitignore', 'AGENTS.md', 'README.md', 'packages'],
			)
		})

	it('runs again over its own output, but not over different files',
		async() => {
			const dir = mkdtempSync(join(tmpdir(), 'reclaim-ws-'))
			await makeTool().handler({ projectDir: dir })
			await makeTool().handler({ projectDir: dir })

			writeFileSync(join(dir, 'README.md'), '# My app\n')
			await assert.rejects(
				makeTool().handler({ projectDir: dir }),
				/already exist with different content: README\.md/,
			)
			assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), '# My app\n')
		})

	it('refuses to write through a symlinked directory', async() => {
		const dir = mkdtempSync(join(tmpdir(), 'reclaim-ws-'))
		const outside = mkdtempSync(join(tmpdir(), 'reclaim-outside-'))
		mkdirSync(join(outside, 'backend'))
		symlinkSync(outside, join(dir, 'packages'))
		await assert.rejects(
			makeTool().handler({ projectDir: dir }),
			/packages is a symlink/,
		)
		assert.deepEqual(readdirSync(join(outside, 'backend')), [])
	})

	it('refuses to write PORT through a symlinked env file', async() => {
		const dir = mkdtempSync(join(tmpdir(), 'reclaim-ws-'))
		const outside = join(mkdtempSync(join(tmpdir(), 'reclaim-outside-')), 'f')
		writeFileSync(outside, 'keep\n')
		mkdirSync(join(dir, 'packages', 'backend'), { recursive: true })
		symlinkSync(outside, join(dir, 'packages', 'backend', '.env'))
		await assert.rejects(
			makeTool().handler({ projectDir: dir }),
			/\.env is a symlink/,
		)
		assert.equal(readFileSync(outside, 'utf8'), 'keep\n')
		assert.deepEqual(readdirSync(dir), ['packages'])
	})

	it('rejects a file that fails its integrity check, writing nothing',
		async() => {
			const dir = mkdtempSync(join(tmpdir(), 'reclaim-ws-'))
			await assert.rejects(
				makeTool({ 'README.md': 'tampered' }).handler({ projectDir: dir }),
				/README\.md failed its integrity check/,
			)
			assert.equal(existsSync(join(dir, 'README.md')), false)
		})
})

/** Runs the tool and narrows its result to the fields these tests read. */
async function run(tool: ReturnType<typeof makeTool>, projectDir: string) {
	const result: unknown = await tool.handler({ projectDir })
	assert(
		typeof result === 'object' && result !== null
		&& 'backendPort' in result && typeof result.backendPort === 'number'
		&& 'next' in result && Array.isArray(result.next),
	)
	return { backendPort: result.backendPort, next: result.next.map(String) }
}

/** The tool over a fake GitHub and npm; `served` overrides file bodies and
 *  `busyPorts` are the ports the fake probe reports as taken. */
function makeTool(
	served: Record<string, string> = {},
	busyPorts: number[] = [],
) {
	const fetch: typeof globalThis.fetch = async(input) => {
		const url = new URL(String(input))
		if(url.pathname.endsWith('/commits/main')) {
			return new Response(COMMIT)
		}

		if(url.pathname.includes('/git/trees/')) {
			return Response.json({
				tree: Object.entries(FILES).map(([path, text]) => ({
					path, type: 'blob', sha: blobSha(text), size: text.length,
				})),
			})
		}

		if(url.hostname === 'registry.npmjs.org') {
			return Response.json({ version: '0.2.0' })
		}

		const path = url.pathname.split(`/${COMMIT}/`)[1]
		return new Response(served[path] ?? FILES[path])
	}

	return exampleAppTool(fetch, async(port) => !busyPorts.includes(port))
}

function blobSha(text: string) {
	const bytes = Buffer.from(text)
	return createHash('sha1')
		.update(`blob ${bytes.length}\0`)
		.update(bytes)
		.digest('hex')
}
