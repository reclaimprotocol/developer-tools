#!/usr/bin/env node

import { execFileSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

/**
 * Sets one release version everywhere. The root `package.json` `version` is
 * the source of truth: edit it, then run
 *
 *   npm run version:bump             # propagate the root version
 *   npm run version:bump -- 0.2.0    # or set the root version and propagate it
 *
 * It updates:
 *
 * 1. The `version` of `@reclaimprotocol/client` and `@reclaimprotocol/agent`.
 * 2. The agent's dependency on the client, pinned to that exact version, so a
 *    published agent always installs its matching client.
 * 3. The plugin and marketplace manifests, through `scripts/sync-version.ts`.
 * 4. `package-lock.json`.
 *
 * Only `version` values and dependency pins are rewritten, so each file keeps
 * its formatting.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = ['packages/client/package.json', 'packages/agent/package.json']
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

main()

function main() {
	const rootPath = join(ROOT, 'package.json')
	const arg = process.argv.slice(2).find((a) => !a.startsWith('--'))
	if(arg) {
		if(!SEMVER.test(arg)) {
			console.error(`"${arg}" isn't a valid version. Expected x.y.z[-pre].`)
			process.exit(1)
		}

		writeFileSync(
			rootPath,
			readFileSync(rootPath, 'utf8')
				.replace(/("version"\s*:\s*")[^"]*(")/, `$1${arg}$2`),
		)
	}

	const { version } = JSON.parse(readFileSync(rootPath, 'utf8'))
	if(typeof version !== 'string' || !SEMVER.test(version)) {
		console.error(
			`The root package.json version "${version}" isn't valid. `
				+ 'Expected x.y.z[-pre].',
		)
		process.exit(1)
	}

	const names = PACKAGES.map(
		(rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')).name as string,
	)
	for(const rel of PACKAGES) {
		const abs = join(ROOT, rel)
		let text = readFileSync(abs, 'utf8')
			.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`)
		for(const name of names) {
			text = text.replace(
				new RegExp(`("${name}"\\s*:\\s*")[^"]*(")`, 'g'),
				`$1${version}$2`,
			)
		}

		writeFileSync(abs, text)
		console.log(`  ✓ ${rel}`)
	}

	execFileSync(
		process.execPath,
		[join(ROOT, 'scripts/sync-version.ts'), version],
		{ stdio: 'inherit' },
	)
	execFileSync(
		'npm',
		['install', '--package-lock-only', '--ignore-scripts'],
		{ cwd: ROOT, stdio: 'inherit' },
	)
	console.log(`\nDone. Every package and manifest is at ${version}.`)
}
