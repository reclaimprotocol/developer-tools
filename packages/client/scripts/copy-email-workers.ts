/**
 * The email document workers are plain ES modules that run in a sandbox, so
 * `tsc` doesn't emit them. Copy them next to the compiled modules that
 * resolve them by URL.
 */
import { cp, readdir } from 'node:fs/promises'

const from = new URL('../src/email/lib/email/', import.meta.url)
const to = new URL('../lib/email/lib/email/', import.meta.url)
for(const name of await readdir(from)) {
	if(name.endsWith('.mjs')) {
		await cp(new URL(name, from), new URL(name, to))
	}
}
