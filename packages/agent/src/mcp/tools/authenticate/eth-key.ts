/**
 * Eth proof-owner key resolution — the raw secp256k1 private key passed to
 * attestor-core when the agent creates a local claim. It's a plain 0x-hex
 * Ethereum private key (no PEM), resolved from, in order:
 *
 *   1. `process.env.RECLAIM_PRIVATE_KEY` — a 0x-hex 32-byte scalar.
 *   2. A `.env` file in the project root — its `RECLAIM_PRIVATE_KEY=0x…` line.
 *   3. A key file holding the raw 0x-hex scalar, at `RECLAIM_PRIVATE_KEY_FILE`
 *      (absolute or project-relative).
 *   4. Absent — `resolveOrCreateEthKey` generates a local test key; nobody is
 *      asked.
 *
 * Generated/imported keys are written to the project `.env` (mode 0600, and the
 * file is added to `.gitignore`). NO `~/.reclaim` caching. This is a LOCAL
 * signing key only — unrelated to org auth (the org secret) or encryption
 * (the eth decrypt key).
 */
import { badRequest } from '@hapi/boom'
import { deriveFromPrivateKey, generateKeypair } from '@reclaimprotocol/client'
import assert from 'node:assert'
import {
	closeSync,
	constants,
	existsSync,
	fchmodSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	writeFileSync,
} from 'node:fs'
import {
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep
} from 'node:path'
import { privateKey, privateKeyFile } from '../../../consts.ts'
import { findProjectRoot } from '../../../paths.ts'

const ENV_VAR = 'RECLAIM_PRIVATE_KEY'
/** The dotenv file the agent reads from / writes the key to. */
export const ENV_FILE = '.env'

/** Where the resolved eth key came from. `generated`: created just now
 *  because none existed. */
export type EthKeySource = 'env' | 'dotenv' | 'file' | 'generated'

/** Tells the agent to inform the developer once, after the fact. */
export const GENERATED_KEY_NOTE =
	'No proof signing key existed, so a local test signing key was created and '
	+ 'saved to the project .env as RECLAIM_PRIVATE_KEY (mode 0600, '
	+ 'gitignored). Tell the developer once, in one sentence, that you created '
	+ 'it; do not ask for approval. It is a local signing key only: not '
	+ 'registered anywhere and unrelated to org auth. A developer who wants '
	+ 'their own key can use import_credentials.'

export type ResolvedEthKey = {
	/** Raw 0x-hex 32-byte scalar. */
	privateKey: string
	/** Lowercase eth address derived from the scalar. */
	address: string
	source: EthKeySource
	/** Absolute path the key was read from (for `dotenv` / `file` sources). */
	path?: string
}

/** Validate + normalize a raw Ethereum private key to lowercase 0x-hex. */
export function normalizeEthHex(value: string): string {
	const v = value.trim().replace(/^['"]|['"]$/g, '')
	assert(
		/^(0x)?[0-9a-fA-F]{64}$/.test(v),
		new Error(
			'not a valid Ethereum private key (expected a 32-byte / 64-hex scalar)',
		),
	)

	return '0x' + v.replace(/^0x/, '').toLowerCase()
}

/** Read `name` (default `RECLAIM_PRIVATE_KEY`) from a dotenv file (simple
 *  KEY=VALUE parse). */
export function readDotenvKey(
	path: string,
	name = ENV_VAR,
): string | undefined {
	if(!existsSync(path)) {
		return undefined
	}

	const re = new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`)
	for(const line of readFileSync(path, 'utf8').split('\n')) {
		const m = line.match(re)
		if(m) {
			return m[1]
		}
	}

	return undefined
}

/** The explicit raw-hex key-file path, if `RECLAIM_PRIVATE_KEY_FILE` is set. */
function ethKeyFilePath(
	projectDir = findProjectRoot(process.cwd()),
): string | undefined {
	const p = privateKeyFile()
	if(!p) {
		return undefined
	}

	return isAbsolute(p) ? p : join(projectDir, p)
}

function resolved(
	privateKey: string,
	source: EthKeySource,
	path?: string,
): ResolvedEthKey {
	return {
		privateKey,
		address: deriveFromPrivateKey(privateKey).address,
		source,
		...(path ? { path } : {}),
	}
}

/**
 * Resolve the eth proof-owner key without prompting. Returns `undefined` when
 * no key is configured anywhere — the caller decides whether to generate or
 * ask for one (see `resolve_owner_key`).
 */
export function resolveEthKey(
	projectDir = findProjectRoot(process.cwd()),
): ResolvedEthKey | undefined {
	const env = privateKey()
	if(env?.trim()) {
		return resolved(normalizeEthHex(env), 'env')
	}

	const envPath = join(projectDir, ENV_FILE)
	const fromDotenv = readDotenvKey(envPath)
	if(fromDotenv) {
		return resolved(normalizeEthHex(fromDotenv), 'dotenv', envPath)
	}

	const keyFile = ethKeyFilePath(projectDir)
	if(keyFile && existsSync(keyFile)) {
		return resolved(
			normalizeEthHex(readFileSync(keyFile, 'utf8')),
			'file',
			keyFile,
		)
	}

	return undefined
}

/**
 * Resolve the eth proof-owner key, or generate a local test key and write it
 * to the project `.env` when none is configured. Never prompts.
 */
export function resolveOrCreateEthKey(
	projectDir = findProjectRoot(process.cwd()),
): ResolvedEthKey {
	const existing = resolveEthKey(projectDir)
	if(existing) {
		return existing
	}

	const { path } = writeEthKey(generateKeypair().privateKey, projectDir)
	const created = resolveEthKey(projectDir)
	assert(created, `generated key not readable from ${path}`)
	return { ...created, source: 'generated' }
}

/** Append `entry` to the project `.gitignore` if not already present. */
export function ensureGitignored(projectDir: string, entry: string) {
	const path = join(projectDir, '.gitignore')
	const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
	if(current.split('\n').some((l) => l.trim() === entry)) {
		return
	}

	const prefix = current && !current.endsWith('\n') ? '\n' : ''
	writeInside(projectDir, path, current + prefix + entry + '\n')
}

/**
 * Set `name=value` in a dotenv file, replacing an existing line or appending
 * one. Writes with mode 0600 and adds the file to the project `.gitignore`.
 * `envFile` is relative to `projectDir`.
 */
export function upsertEnvVar(
	projectDir: string,
	envFile: string,
	name: string,
	value: string,
): string {
	const envPath = resolve(projectDir, envFile)
	const line = `${name}=${value}`
	const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
	const re = new RegExp(`^\\s*${name}\\s*=.*$`, 'm')
	let next: string
	if(re.test(existing)) {
		// A function replacer keeps `$` sequences in the value literal.
		next = existing.replace(re, () => line)
	} else {
		const prefix = existing && !existing.endsWith('\n') ? '\n' : ''
		next = existing + prefix + line + '\n'
	}

	writeInside(projectDir, envPath, next, { secret: true })
	ensureGitignored(projectDir, relative(projectDir, envPath))
	return envPath
}

/** Remove the `name=` line from a dotenv file, if there is one. */
export function removeEnvVar(
	projectDir: string,
	envFile: string,
	name: string,
) {
	const envPath = resolve(projectDir, envFile)
	if(!existsSync(envPath)) {
		return
	}

	const existing = readFileSync(envPath, 'utf8')
	const re = new RegExp(`^\\s*${name}\\s*=.*(\\n|$)`, 'm')
	writeInside(projectDir, envPath, existing.replace(re, ''), { secret: true })
}

/**
 * Before `name` is overwritten, append its current value to
 * `<envFile>.backup` (same directory) as a timestamped comment plus the
 * `NAME=value` line. Appends, so repeated rotations keep history. Writes with
 * mode 0600 and adds the backup to `.gitignore`. Returns the backup's absolute
 * path, or `undefined` when the env file holds no value for `name`. Never
 * returns or logs the value.
 */
export function backupEnvVar(
	projectDir: string,
	envFile: string,
	name: string,
	reason: string,
): string | undefined {
	const envPath = resolve(projectDir, envFile)
	assertNoSymlinks(projectDir, relative(projectDir, envPath))
	const value = readDotenvKey(envPath, name)
	if(!value) {
		return undefined
	}

	const backupPath = `${envPath}.backup`
	const stamp = new Date().toISOString()
	writeInside(
		projectDir,
		backupPath,
		`# ${stamp} ${reason}\n${name}=${value}\n`,
		{ secret: true, append: true },
	)
	ensureGitignored(projectDir, relative(projectDir, backupPath))
	return backupPath
}

/**
 * Persist a raw eth private key to the project `.env` as
 * `RECLAIM_PRIVATE_KEY=0x…` (upsert; mode 0600; `.env` added to `.gitignore`).
 * Used by `issue_credentials` (generate) and `import_credentials` (supplied
 * hex). Returns the derived address and the `.env` path.
 */
export function writeEthKey(
	privateKeyHex: string,
	projectDir = findProjectRoot(process.cwd()),
): { path: string, address: string } {
	const hex = normalizeEthHex(privateKeyHex)
	const path = upsertEnvVar(projectDir, ENV_FILE, ENV_VAR, hex)
	return { path, address: deriveFromPrivateKey(hex).address }
}

/** Throws when `path` (relative to `root`), or any of its existing parents
 *  under `root`, is a symlink: writing through one could land outside the
 *  project. */
export function assertNoSymlinks(root: string, path: string) {
	assert(
		path && !path.startsWith('..') && !isAbsolute(path),
		badRequest(`${path} is not inside ${root}`),
	)
	let current = root
	for(const part of path.split(/[\\/]/)) {
		current += sep + part
		const stat = lstatSync(current, { throwIfNoEntry: false })
		assert(
			!stat?.isSymbolicLink(),
			badRequest(
				`${current} is a symlink; Reclaim tools only write to real files `
				+ 'and directories inside the project',
			),
		)
	}
}

/**
 * Write `data` to `path` inside `projectDir` without following a symlink: the
 * file and its parents must be real, and the open uses `O_NOFOLLOW`, so a
 * symlink that appears after the check still fails. `secret` writes with
 * mode 0600; `append` adds to the file instead of replacing it.
 */
function writeInside(
	projectDir: string,
	path: string,
	data: string,
	{ secret = false, append = false } = {},
) {
	const rel = relative(projectDir, path)
	assertNoSymlinks(projectDir, rel)
	mkdirSync(dirname(path), { recursive: true })
	assertNoSymlinks(projectDir, rel)
	const fd = openSync(
		path,
		constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW
			| (append ? constants.O_APPEND : constants.O_TRUNC),
		secret ? 0o600 : 0o666,
	)
	try {
		if(secret) {
			fchmodSync(fd, 0o600)
		}

		writeFileSync(fd, data)
	} finally {
		closeSync(fd)
	}
}
