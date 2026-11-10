import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool, type RegisteredTool } from '../../mcp/server.ts'
import { findProjectRoot } from '../../paths.ts'

/** The demo's source files live in `samples/demo-server/` so they can be
 *  edited (and even run) as plain files without touching code — same pattern
 *  as `skill/*.md`. The path resolves the same from `src/old/tools` (dev) and
 *  `lib/old/tools` (published): both are three levels below the package root.
 *
 *  `server.js` there is corrected against `@reclaimprotocol/js-sdk` v5.8.1
 *  (`Reclaim.ts`): awaits `getRequestUrl()`, uses `setContext` (not deprecated
 *  `addContext`), JSON-parses the raw webhook body before `verifyProof`,
 *  passes the required `{ providerId, providerVersion }` config, and reads
 *  `result.isVerified` (not `is_verified`). `providerVersion` is left unpinned
 *  by default — the built-in "example" providerId isn't versioned, so pinning
 *  one is only meaningful once you swap in your own provider. */
const SAMPLE_DIR = fileURLToPath(
	new URL('../../../samples/demo-server', import.meta.url),
)

function readSample(name: string): string {
	return readFileSync(join(SAMPLE_DIR, name), 'utf8')
}

/** `server.js` with its `__PROVIDER_ID__` / `__PROVIDER_VERSION__` tokens
 *  substituted with JS literals. */
function serverJs(
	providerId: string,
	providerVersion: string | undefined,
): string {
	return readSample('server.js')
		.replace('__PROVIDER_ID__', JSON.stringify(providerId))
		.replace(
			'__PROVIDER_VERSION__',
			providerVersion ? JSON.stringify(providerVersion) : 'undefined',
		)
}

/**
 * Scaffold a small, runnable Express demo that exercises the full
 * @reclaimprotocol/js-sdk flow end-to-end: request a proof (backend), open it
 * (frontend), and verify the async webhook callback (backend). Corrected
 * against the CURRENT SDK API (see js-sdk-integration-guide) rather than
 * older examples that predate several signature changes.
 */
const DEFAULT_PROVIDER_ID = 'example'

export function scaffoldDemoServerTool(): RegisteredTool {
	return defineTool<{
		targetDir: string
		providerId?: string
		providerVersion?: string
	}>(
		{
			name: 'scaffold_reclaim_demo_server',
			description:
				'Write a small runnable Express demo (server.js, package.json, ' +
				'.env.example, README.md) that requests a Reclaim proof and ' +
				'verifies the async webhook callback, using the CURRENT ' +
				'@reclaimprotocol/js-sdk API. Defaults `providerId` to the built-in ' +
				'"example" smoke-test provider so you can confirm the whole loop ' +
				'without authoring one first. The webhook callback needs a URL ' +
				'Reclaim\'s servers can reach — localhost never works — via EITHER ' +
				'a tunnel (ngrok or similar) OR quickly deploying this demo to a ' +
				'dev/staging server the user already has; ASK THE USER which they\'d ' +
				'rather use before assuming ngrok, since either sets `PUBLIC_URL` in ' +
				'.env (the generated README covers both). Use ' +
				'get_js_sdk_integration_guide for the annotated write-up of the ' +
				'same flow.',
			inputSchema: {
				type: 'object',
				properties: {
					targetDir: {
						type: 'string',
						description:
							'Directory to write the demo into (created if missing). ' +
							'Relative paths resolve against the project root.',
					},
					providerId: {
						type: 'string',
						description:
							'Provider id the demo requests a proof for (default ' +
							'"example", a built-in smoke-test provider — good for ' +
							'confirming the flow works before wiring in a real one).',
					},
					providerVersion: {
						type: 'string',
						description:
							'Provider version to pin (default: unpinned — "example" ' +
							'isn\'t versioned, so only set this once you swap in your ' +
							'own provider).',
					},
				},
				required: ['targetDir'],
			},
		},
		async({ targetDir, providerId, providerVersion }) => {
			const dir = isAbsolute(targetDir)
				? targetDir
				: join(findProjectRoot(process.cwd()), targetDir)
			mkdirSync(dir, { recursive: true })

			const id = providerId ?? DEFAULT_PROVIDER_ID
			writeFileSync(join(dir, 'server.js'), serverJs(id, providerVersion))
			writeFileSync(join(dir, 'package.json'), readSample('package.json'))
			writeFileSync(join(dir, '.env.example'), readSample('.env.example'))
			writeFileSync(join(dir, 'README.md'), readSample('README.md'))

			return {
				dir,
				providerId: id,
				files: ['server.js', 'package.json', '.env.example', 'README.md'],
				next: 'cd into the directory, npm install, copy .env.example to .env ' +
					'and fill it in (including PUBLIC_URL from ngrok), then npm start.',
			}
		},
	)
}
