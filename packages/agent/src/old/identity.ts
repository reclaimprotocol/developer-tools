import { deriveFromPrivateKey } from '@reclaimprotocol/client'
import { ConfigStore } from '../config/store.ts'
import { oldApiToken, oldEthUid, privateKey } from '../consts.ts'
import type { OldIdentity } from './client.ts'

/** Normalize an eth uid input to `eth:<lowercase-address>`. Accepts a bare
 *  `0x…` address or an already-prefixed `eth:0x…`. */
export function toEthUid(addressOrUid: string): OldIdentity {
	const lower = addressOrUid.trim().toLowerCase()
	const uid = lower.startsWith('eth:') ? lower : `eth:${lower}`
	return { kind: 'eth', uid }
}

/**
 * Resolve a caller identity from the environment, in priority order:
 *   1. `RECLAIM_OLD_API_TOKEN` — a dashboard Firebase bearer token.
 *   2. `RECLAIM_OLD_ETH_UID`   — an `eth:<addr>` (or bare `0x…`) uid.
 *   3. `RECLAIM_PRIVATE_KEY`   — derive the eth uid from the local app key.
 * Returns undefined when none is set.
 */
function resolveIdentityFromEnv(): OldIdentity | undefined {
	const token = oldApiToken()?.trim()
	if(token) {
		return { kind: 'bearer', token }
	}

	const ethUid = oldEthUid()?.trim()
	if(ethUid) {
		return toEthUid(ethUid)
	}

	const key = privateKey()?.trim()
	if(key) {
		return toEthUid(deriveFromPrivateKey(key).address)
	}

	return undefined
}

/** Read the identity persisted by a prior `reclaim_authenticate` call. */
function loadPersistedIdentity(): OldIdentity | undefined {
	return new ConfigStore().read()?.old_devtools
}

/** Persist the identity so it survives an MCP-server restart. */
export function persistIdentity(identity: OldIdentity) {
	new ConfigStore().write({ old_devtools: identity })
}

/**
 * The identity the client should start with: an explicit env var wins
 * (useful for headless / CI), otherwise fall back to whatever the dev
 * authenticated with last time.
 */
export function resolveInitialIdentity(): OldIdentity | undefined {
	return resolveIdentityFromEnv() ?? loadPersistedIdentity()
}
