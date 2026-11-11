// Download the @reclaimprotocol/zk-symmetric-crypto circuit resources that
// @reclaimprotocol/attestor-core needs at proof time. Runs as the agent's
// `postinstall` and as `npm run download:zk-files`.
//
// This is plain JavaScript (not TypeScript) on purpose: it runs as a
// `postinstall`, where the file lives under the consumer's `node_modules`.
// Node refuses to type-strip `.ts` files in `node_modules`
// (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so the install hook must be
// runnable without any transpilation.
//
// Resolves the package via Node's algorithm (`createRequire().resolve`)
// rather than a literal `node_modules/...` path: the package is commonly
// hoisted to the workspace root, where a literal relative path from
// packages/agent (npm's cwd for a workspace postinstall) would miss.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

let mainPath
try {
	mainPath = require.resolve('@reclaimprotocol/zk-symmetric-crypto')
} catch{
	// Dependency not installed (e.g. a consumer that only wants the SDK
	// surface). Nothing to download; don't fail the install.
	process.exit(0)
}

// mainPath is <pkg>/lib/index.js → its scripts live at <pkg>/lib/scripts.
const downloadScript = join(dirname(mainPath), 'scripts', 'download-files.js')

if(!existsSync(downloadScript)) {
	console.warn(
		`[reclaim-agent] zk download script not found at ${downloadScript}; ` +
		'skipping. Run `npm run download:zk-files` once the package is installed.',
	)
	process.exit(0)
}

const child = spawn(process.execPath, [downloadScript], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
	console.warn(`[reclaim-agent] zk download failed: ${err.message}`)
	process.exit(0)
})
