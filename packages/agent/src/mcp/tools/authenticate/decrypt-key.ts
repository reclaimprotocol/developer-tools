/**
 * Optional eth decryption key — only needed when testing ENCRYPTED callback
 * payloads in the consumer role. The org's results are ECIES-encrypted to its
 * eth public key; this is the matching eth PRIVATE key (`0x`-hex). Resolution:
 *
 *   1. The `RECLAIM_DECRYPT_KEY` env var (a `0x`-prefixed 32-byte hex key), or
 *   2. A file named `reclaim-decrypt.key` in the project root holding that hex.
 *   3. Absent — plaintext-only testing (no decryption key; encrypted
 *      deliveries surface a clear error).
 *
 * The hex is loaded via the client's `loadDecryptionKey` and passed straight
 * through as `ReclaimConfig.credential` / to `decryptCallback`.
 */
import { type DecryptionKey, loadDecryptionKey } from '@reclaimprotocol/client'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findProjectRoot } from '../../../paths.ts'

/** Default eth decrypt-key filename the agent looks for in the project root. */
const DEFAULT_DECRYPT_KEY_FILE = 'reclaim-decrypt.key'

/**
 * Read the raw eth decryption-key hex — from `RECLAIM_DECRYPT_KEY` or the
 * default file — without loading it. Returns `undefined` when neither is
 * present (plaintext-only).
 */
function resolveDecryptKeyInput(
	projectDir = findProjectRoot(process.cwd()),
): string | undefined {
	const fromEnv = process.env.RECLAIM_DECRYPT_KEY?.trim()
	if(fromEnv) {
		return fromEnv
	}

	const keyPath = join(projectDir, DEFAULT_DECRYPT_KEY_FILE)
	if(existsSync(keyPath)) {
		return readFileSync(keyPath, 'utf8').trim()
	}

	return undefined
}

/**
 * Load the optional decryption key. Returns `undefined` when no key is
 * configured (the consumer then handles only plaintext deliveries).
 */
export async function resolveDecryptionKey(
	projectDir = findProjectRoot(process.cwd()),
): Promise<DecryptionKey | undefined> {
	const input = resolveDecryptKeyInput(projectDir)
	if(input === undefined) {
		return undefined
	}

	return loadDecryptionKey(input)
}
