import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { CachedSession } from '../mcp/tools/authenticate/session-cache.ts'
import type { OldIdentity } from '../old/client.ts'
import { reclaimHomeDirPath } from '../paths.ts'

export interface ReclaimAgentConfig {
	attachMode: 'dedicated' | 'attach'
	port: number
}

/**
 * The single on-disk document at `~/.reclaim/config.json`. Each top-level
 * key is an independent section owned by a different subsystem:
 *   - `mode`          — persisted backend preference (old-devtools vs builder),
 *                       set via the `set_devtools_mode` tool. Applied at server
 *                       start; an explicit `USE_OLD_DEVTOOLS` env var overrides
 *                       it (see `resolveOldMode` in consts.ts).
 *   - `browser_agent` — Chrome attach mode/port (the agent tools)
 *   - `session`       — the auth bearer token (authenticate)
 *   - `old_devtools`  — externally-supplied identity for OLD-devtools mode
 *                       (USE_OLD_DEVTOOLS); independent of `session`'s
 *                       builder token. Deletable with the rest of `src/old/`.
 *   - `analytics`     — the random, anonymous client ID the usage data is
 *                       sent under (see telemetry/telemetry.ts); holds no
 *                       personal data
 *   - `org_keys`      — organization API keys saved by `issue_org_token`, so
 *                       the org-key tools work without the key in a transcript
 * Sections are persisted independently via `ConfigStore.write`, which
 * merges rather than replaces, so one subsystem never clobbers another's.
 *
 * NOTE: eth proof-owner keys are NOT cached here — they live as PEMs in the
 * project (see authenticate/eth-key.ts). This config holds no private keys
 * other than the (short-lived) session bearer token.
 */
export interface ReclaimConfig {
	version: 1
	mode?: DevtoolsMode
	browser_agent?: ReclaimAgentConfig
	session?: CachedSession
	old_devtools?: OldIdentity
	org_keys?: SavedOrgKeys
	analytics?: { clientId: string, createdAt: string }
}

/** Organization API keys (`rorg_…`) saved by `issue_org_token`. */
export interface SavedOrgKeys {
	/** Key by organization ID. */
	byOrg: Record<string, string>
	/** The organization whose key was saved last. */
	recent?: string
}

/** Which backend the MCP server targets. See `resolveOldMode` in consts.ts. */
export type DevtoolsMode = 'old' | 'builder'

/**
 * Read/write the unified Reclaim config document. The file holds the
 * (short-lived) session bearer token, so it is always locked to `0600` and
 * its directory to `0700` — the `~/.ssh` posture. `read()` returns
 * `undefined` when the file is missing or unparseable; callers layer their
 * own validation (token expiry, credential shape) on top.
 */
export class ConfigStore {
	#path: string

	constructor(path: string = defaultConfigPath()) {
		this.#path = path
	}

	read(): ReclaimConfig | undefined {
		if(!existsSync(this.#path)) {
			return undefined
		}

		try {
			return JSON.parse(readFileSync(this.#path, 'utf8')) as ReclaimConfig
		} catch{
			return undefined
		}
	}

	/**
	 * Shallow-merge `patch` over the current document and persist the
	 * result, preserving every section not named in `patch` so concurrent
	 * subsystems don't overwrite each other's keys.
	 */
	write(patch: Partial<ReclaimConfig>): ReclaimConfig {
		const next: ReclaimConfig = { ...this.read(), ...patch, version: 1 }

		const dir = dirname(this.#path)
		mkdirSync(dir, { recursive: true, mode: 0o700 })
		chmodSync(dir, 0o700)
		writeFileSync(this.#path, JSON.stringify(next, null, 2) + '\n', {
			mode: 0o600,
		})
		chmodSync(this.#path, 0o600)
		return next
	}
}

export function defaultConfigPath(): string {
	return join(reclaimHomeDirPath(), 'config.json')
}
