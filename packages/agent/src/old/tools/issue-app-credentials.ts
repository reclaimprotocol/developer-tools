import { defineTool, type RegisteredTool } from '../../mcp/server.ts'
import type { ReclaimOldClient } from '../client.ts'

/**
 * Mint a brand-new eth-keypair APP (as opposed to authenticating as a
 * dashboard user). `appId` is the eth address, `appSecret` the raw private
 * key — this is the pair `@reclaimprotocol/js-sdk`'s `ReclaimProofRequest.init`
 * expects. No auth required: the app starts unassociated (`creatorUid: null`)
 * and sandboxed (`sandboxLimit: 100` sessions). Use `link_app_to_account` to
 * attach it to your dashboard account, or `check_app_status` to inspect it.
 */
export function issueAppCredentialsTool(
	client: ReclaimOldClient,
): RegisteredTool {
	return defineTool<Record<string, never>>(
		{
			name: 'issue_app_credentials',
			description:
				'Mint a new Reclaim APP (eth keypair) on the old devtools backend — ' +
				'no authentication required. Returns `{ appId, appSecret }`: ' +
				'`appId` is the eth address, `appSecret` the raw private key. This ' +
				'is the appId/appSecret pair for @reclaimprotocol/js-sdk ' +
				'(`ReclaimProofRequest.init(appId, appSecret, providerId)`). The app ' +
				'starts UNLINKED and sandboxed (100 sessions) — call ' +
				'link_app_to_account to attach it to your dashboard account and ' +
				'check_app_status to check its state. Store `appSecret` like a ' +
				'password (for example, in a gitignored .env as ' +
				'RECLAIM_APP_SECRET) — it is returned once and cannot be ' +
				'recovered from the server.',
			inputSchema: { type: 'object', properties: {} },
		},
		async() => {
			const { appId, appSecret } = await client.issueCredentials()
			return {
				appId,
				appSecret,
				note:
					'Unlinked, sandboxed app (100 session limit). Set RECLAIM_APP_ID ' +
					'and RECLAIM_APP_SECRET in your .env (gitignored). Run ' +
					'link_app_to_account to attach it to your dashboard account and ' +
					'lift the sandbox limit.',
			}
		},
	)
}
