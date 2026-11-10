import { ConfigStore } from '../../../config/store.ts'

/**
 * Save an organization API key (`rorg_…`) in the local config (mode 0600), so
 * the org-key tools can use it without the key passing through a transcript.
 */
export function saveOrgKey(orgId: string, secret: string) {
	const saved = new ConfigStore().read()?.org_keys
	new ConfigStore().write({
		org_keys: {
			byOrg: { ...saved?.byOrg, [orgId]: secret },
			recent: orgId,
		},
	})
}

/**
 * The saved key for `orgId`, or the most recently saved key when no org is
 * given. Returns `undefined` when none is saved.
 */
export function savedOrgKey(orgId?: string): string | undefined {
	const saved = new ConfigStore().read()?.org_keys
	const id = orgId || saved?.recent
	return id ? saved?.byOrg[id] : undefined
}
