/**
 * Centralized environment access for `@reclaimprotocol/agent`.
 *
 * This is the ONLY non-test source file under `src/` that reads
 * `process.env`. Every other module imports a getter from here instead of
 * touching `process.env` directly.
 *
 * Almost everything is exposed as a LAZY GETTER FUNCTION rather than an eager
 * `const`, on purpose: several tests mutate env at runtime (mcp-credentials
 * sets/deletes RECLAIM_PRIVATE_KEY / RECLAIM_PRIVATE_KEY_FILE / RECLAIM_HOME;
 * old-devtools sets/deletes USE_OLD_DEVTOOLS), and most of these vars are read
 * at call time anyway. An eager const captured at import time would freeze the
 * value and break those tests. The one eager const that's safe is `LOG_LEVEL`,
 * which is read once at logger construction.
 *
 * Each var's default/fallback literal is co-located with its getter.
 */
import { DEFAULT_BASE_URL } from '@reclaimprotocol/client/api'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_OLD_API_URL, DEFAULT_OLD_LOGS_URL } from './old/client.ts'
import { DEFAULT_SDK_API_URL } from './old/sdk-client.ts'

// ---------------------------------------------------------------------------
// Default / fallback literals (used only as env fallbacks).
// ---------------------------------------------------------------------------

/** Public attestor websocket URL — fallback for `RECLAIM_ATTESTOR_URL`. */
export const FALLBACK_ATTESTOR_URL = 'wss://attestor.reclaimprotocol.org:444/ws'

/** The devtools dashboard login page — fallback for `RECLAIM_OLD_LOGIN_URL`. */
export const DEFAULT_LOGIN_URL = 'https://dev.reclaimprotocol.org'

// Re-export the non-env-fallback defaults so callers can keep importing
// their URL defaults from a single place if they wish.
export {
	DEFAULT_BASE_URL,
	DEFAULT_OLD_API_URL,
	DEFAULT_OLD_LOGS_URL,
	DEFAULT_SDK_API_URL,
}

// ---------------------------------------------------------------------------
// Logging.
// ---------------------------------------------------------------------------

/** Pino log level. Read once at logger construction, so an eager const is
 *  safe (no test mutates LOG_LEVEL at runtime). */
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info'

// ---------------------------------------------------------------------------
// Paths.
// ---------------------------------------------------------------------------

/** Reclaim cache directory (`~/.reclaim`). `RECLAIM_HOME` overrides it so
 *  tests can sandbox writes. */
export function reclaimHome(): string {
	return process.env.RECLAIM_HOME || join(homedir(), '.reclaim')
}

// ---------------------------------------------------------------------------
// Mode flag.
// ---------------------------------------------------------------------------

/**
 * `USE_OLD_DEVTOOLS` — single source of truth for which backend the MCP
 * server targets. Builder is the default. Set `USE_OLD_DEVTOOLS=true` to
 * explicitly use the legacy backend.
 */
export function useOldDevtools(): boolean {
	return ['true', '1'].includes(
		(process.env.USE_OLD_DEVTOOLS ?? '').trim().toLowerCase(),
	)
}

/** True when `USE_OLD_DEVTOOLS` is set to a non-empty value (explicit). */
function oldDevtoolsEnvSet(): boolean {
	return (process.env.USE_OLD_DEVTOOLS ?? '').trim() !== ''
}

/**
 * Effective mode, layering the persisted preference under the env var:
 * explicit `USE_OLD_DEVTOOLS` wins → persisted config `mode` →
 * default (builder).
 * The persisted value comes from `~/.reclaim/config.json` (set via the
 * `set_devtools_mode` tool); the caller reads it so this module needn't import
 * `ConfigStore` (which would create an import cycle).
 */
export function resolveOldMode(persisted?: 'old' | 'builder'): boolean {
	if(oldDevtoolsEnvSet()) {
		return useOldDevtools()
	}

	if(persisted) {
		return persisted === 'old'
	}

	return false
}

/**
 * Where the effective mode came from — the same precedence as
 * `resolveOldMode`: explicit `USE_OLD_DEVTOOLS` env var → persisted config
 * `mode` → default (builder). Surfaced by the `get_devtools_mode` tool so the
 * user can tell why the server is in the mode it reports.
 */
export function oldModeSource(
	persisted?: 'old' | 'builder',
): 'env' | 'config' | 'default' {
	if(oldDevtoolsEnvSet()) {
		return 'env'
	}

	if(persisted) {
		return 'config'
	}

	return 'default'
}

// ---------------------------------------------------------------------------
// Chrome / CDP launcher.
// ---------------------------------------------------------------------------

/** `%LOCALAPPDATA%` on Windows, used to probe a per-user Chrome install. */
export function localAppData(): string | undefined {
	return process.env['LOCALAPPDATA']
}

/** Explicit Chrome/Edge/Chromium binary path override. */
export function chromePath(): string | undefined {
	return process.env.RECLAIM_AGENT_CHROME_PATH
}

// ---------------------------------------------------------------------------
// MCP server / API clients.
// ---------------------------------------------------------------------------

/** Agent tools (Chrome CDP capture, synthesis, proof) are disabled in hosted
 *  deployments by setting `RECLAIM_AGENT_DISABLED=1`. Shared by mcp/start and
 *  the old-mode authenticate tool. */
export function agentDisabled(): boolean {
	return process.env.RECLAIM_AGENT_DISABLED === '1'
}

/**
 * Whether the server may send anonymous usage data. Off when you set
 * `RECLAIM_TELEMETRY=0` or the cross-tool `DO_NOT_TRACK=1` convention.
 */
export function telemetryEnabled(): boolean {
	const doNotTrack = process.env.DO_NOT_TRACK?.toLowerCase()
	return process.env.RECLAIM_TELEMETRY !== '0'
		&& doNotTrack !== '1'
		&& doNotTrack !== 'true'
}

/** Old-devtools backend base URL. */
export function oldApiUrl(): string {
	return process.env.RECLAIM_OLD_API_URL || DEFAULT_OLD_API_URL
}

/** Old-devtools analytics-logs service base URL (separate host). */
export function oldLogsUrl(): string {
	return process.env.RECLAIM_OLD_LOGS_URL || DEFAULT_OLD_LOGS_URL
}

/** Public production SDK-backend base URL — the service the verification
 *  SDK/attestor itself reads a provider's recipe from at runtime. A
 *  DIFFERENT host from the old-devtools dashboard backend (`oldApiUrl`). */
export function sdkApiUrl(): string {
	return process.env.RECLAIM_SDK_API_URL || DEFAULT_SDK_API_URL
}

/** Builder backend base URL. Shared by mcp/start and the verification tool. */
export function apiUrl(): string {
	return process.env.RECLAIM_API_URL || DEFAULT_BASE_URL
}

/** Explicit builder API token (overrides the cached session token). */
export function apiToken(): string | undefined {
	return process.env.RECLAIM_API_TOKEN
}

// ---------------------------------------------------------------------------
// Proof tracing.
// ---------------------------------------------------------------------------

/** Diagnostic trace capture (`RECLAIM_AGENT_TRACE=1`). Shared by the attestor
 *  logger capture and the proof-run dump. */
export function agentTraceEnabled(): boolean {
	return process.env['RECLAIM_AGENT_TRACE'] === '1'
}

/** Attestor websocket URL override (`RECLAIM_ATTESTOR_URL`). */
export function attestorUrlOverride(): string | undefined {
	return process.env['RECLAIM_ATTESTOR_URL']
}

// ---------------------------------------------------------------------------
// Eth proof-owner key resolution.
// ---------------------------------------------------------------------------

/** Raw 0x-hex Ethereum private key (`RECLAIM_PRIVATE_KEY`). */
export function privateKey(): string | undefined {
	return process.env.RECLAIM_PRIVATE_KEY
}

/** Path to a raw-hex key file (`RECLAIM_PRIVATE_KEY_FILE`). */
export function privateKeyFile(): string | undefined {
	return process.env.RECLAIM_PRIVATE_KEY_FILE
}

// ---------------------------------------------------------------------------
// Verification reads.
// ---------------------------------------------------------------------------

/** Per-org bearer secret (`rorg_…`) used to authenticate verification reads. */
export function orgSecret(): string | undefined {
	return process.env.RECLAIM_ORG_SECRET
}

// ---------------------------------------------------------------------------
// Old-devtools identity / login.
// ---------------------------------------------------------------------------

/** Dashboard Firebase bearer token for the old backend. */
export function oldApiToken(): string | undefined {
	return process.env.RECLAIM_OLD_API_TOKEN
}

/** An `eth:<addr>` (or bare `0x…`) uid for the old backend. */
export function oldEthUid(): string | undefined {
	return process.env.RECLAIM_OLD_ETH_UID
}

/** Override for the old-devtools dashboard login URL. */
export function oldLoginUrl(): string | undefined {
	return process.env.RECLAIM_OLD_LOGIN_URL
}
