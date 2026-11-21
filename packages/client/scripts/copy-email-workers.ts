/**
 * The email document workers are plain ES modules that run in a sandbox, so
 * `tsc` doesn't emit them. Copy them next to the compiled modules that
 * resolve them by URL.
 */
import { cp, mkdir, readdir } from 'node:fs/promises'

const from = new URL('../src/email/lib/email/', import.meta.url)
const to = new URL('../lib/email/lib/email/', import.meta.url)
// `tsc` excludes `.mjs`, so the destination tree doesn't exist on a clean
// build; create it before copying, or `cp` throws ENOENT for each file.
await mkdir(to, { recursive: true })
for(const name of await readdir(from)) {
	if(name.endsWith('.mjs')) {
		await cp(new URL(name, from), new URL(name, to))
	}
}
