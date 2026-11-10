import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// package.json lives outside `rootDir: src`, so we can't `import` it
// directly without widening rootDir and corrupting the build output
// tree. Read it at runtime instead — relative to this module's URL so
// the path resolves identically in dev (src/pkg.ts) and after build
// (build/pkg.js), both one level below the package root.
const PKG_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	'package.json',
)

const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8')) as {
	name: string
	version: string
	description?: string
}

export const NAME = pkg.name
export const VERSION = pkg.version
export const DESCRIPTION = pkg.description || ''
