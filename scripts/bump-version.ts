#!/usr/bin/env node

import assert from 'assert'
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
 * 3. Every `version` in the plugin and marketplace manifests (`MANIFESTS`).
 *    The plugins run the published agent through npx, so they track its
 *    version.
 * 4. `package-lock.json`.
 *
 * Only `version` values and dependency pins are rewritten, so each file keeps
 * its formatting.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = ['packages/client/package.json', 'packages/agent/package.json']
// Marketplace files hold two `version` keys (the marketplace and the plugin
// entry); both are set. The Codex marketplace has no version, so only its
// plugin manifest is listed. The root plugin.json is the Antigravity plugin,
// and gemini-extension.json is the Gemini CLI extension manifest.
const MANIFESTS = [
	'.claude-plugin/marketplace.json',
	'.cursor-plugin/marketplace.json',
	'.github/plugin/marketplace.json',
	'.omp-plugin/marketplace.json',
	'gemini-extension.json',
	'plugin.json',
	'reclaim/.claude-plugin/plugin.json',
	'reclaim/.codex-plugin/plugin.json',
	'reclaim/.cursor-plugin/plugin.json',
	'reclaim/.github/plugin/plugin.json',
]
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

	for(const rel of MANIFESTS) {
		const abs = join(ROOT, rel)
		const text = readFileSync(abs, 'utf8')
		assert(/"version"\s*:/.test(text), `${rel} has no "version" field.`)
		writeFileSync(
			abs,
			text.replace(/("version"\s*:\s*")[^"]*(")/g, `$1${version}$2`),
		)
		console.log(`  ✓ ${rel}`)
	}

	execFileSync(
		'npm',
		['install', '--package-lock-only', '--ignore-scripts'],
		{ cwd: ROOT, stdio: 'inherit' },
	)
	console.log(`\nDone. Every package and manifest is at ${version}.`)
}
