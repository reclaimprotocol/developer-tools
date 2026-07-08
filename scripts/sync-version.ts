import { execFileSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

/**
 * Copy a version into every plugin/marketplace file in this repo. The plugin
 * just runs `npx @reclaimprotocol/agent`, so the source of truth is that
 * package's published version — fetched from npm by default:
 *
 *   node scripts/sync-version.ts            # use latest @reclaimprotocol/agent from npm
 *   node scripts/sync-version.ts 0.2.0      # set an explicit version instead
 *
 * Only the `version` field values are rewritten (targeted string replace), so
 * each file keeps its existing formatting.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE = '@reclaimprotocol/agent'

// Files that carry a version, relative to the repo root. `marketplace.json`
// holds two `version` keys (marketplace metadata + the plugin entry); both are
// set, along with the plugin manifest.
const TARGETS = [
	'.claude-plugin/marketplace.json',
	'reclaim/.claude-plugin/plugin.json',
]

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

main()

function main() {
	const arg = process.argv.slice(2).find((a) => !a.startsWith('--'))
	const version = arg ? explicit(arg) : latestFromNpm()

	console.log(
		`Syncing version ${version}`
			+ (arg ? ' (explicit)' : ` (latest ${PACKAGE} on npm)`) + '\n',
	)

	for(const rel of TARGETS) {
		const abs = join(ROOT, rel)
		const before = readFileSync(abs, 'utf8')
		let count = 0
		const after = before.replace(
			/("version"\s*:\s*")[^"]*(")/g,
			(_m, pre, post) => {
				count++
				return `${pre}${version}${post}`
			},
		)
		if(!count) {
			console.warn(`  ! ${rel} — no "version" field found, skipped`)
			continue
		}

		if(after !== before) {
			writeFileSync(abs, after)
		}

		console.log(`  ✓ ${rel} (${count} field${count > 1 ? 's' : ''})`)
	}

	console.log(`\nDone — everything set to ${version}.`)
}

function explicit(arg: string) {
	if(!SEMVER.test(arg)) {
		fail(`"${arg}" is not a valid version (expected x.y.z[-pre]).`)
	}

	return arg
}

function latestFromNpm() {
	try {
		const v = execFileSync('npm', ['view', PACKAGE, 'version'], {
			encoding: 'utf8',
		}).trim()
		if(!SEMVER.test(v)) {
			fail(`npm returned an unexpected version for ${PACKAGE}: "${v}"`)
		}

		return v
	} catch(err) {
		fail(
			`could not read the latest ${PACKAGE} version from npm `
				+ `(${(err as Error).message}). Pass a version explicitly instead.`,
		)
	}
}

function fail(message: string): never {
	console.error(`sync-version: ${message}`)
	process.exit(1)
}
