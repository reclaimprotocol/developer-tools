import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SHEBANG = '#!/usr/bin/env node\n'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN_FILES = ['mcp-bin.js']

for(const file of BIN_FILES) {
	const path = join(ROOT, 'lib', file)
	const content = await readFile(path, 'utf8')
	if(content.startsWith('#!')) {
		continue
	}

	await writeFile(path, SHEBANG + content)
}
