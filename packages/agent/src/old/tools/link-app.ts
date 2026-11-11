import { signEip191 } from '@reclaimprotocol/client'
import { defineTool, type RegisteredTool } from '../../mcp/server.ts'
import type { ReclaimOldClient } from '../client.ts'

/** Byte-for-byte the same format as the backend's `buildLinkMessage` in
 *  `application.controller.ts` — MUST stay in lockstep with it. */
function buildLinkMessage(
	appId: string,
	userId: string,
	nonce: string,
): string {
	return `Link ${appId} to account ${userId} | nonce: ${nonce}`
}

/** The uid the backend binds into the signed message — `req.user.uid` there.
 *  For a bearer identity this comes back from `POST /users/login`; for an eth
 *  identity, `OldIdentity.uid` (already `eth:<address>`) IS that uid. */
async function resolveUserId(client: ReclaimOldClient): Promise<string> {
	const identity = client.getIdentity()
	if(!identity) {
		throw new Error(
			'Not authenticated against old devtools. Call reclaim_authenticate ' +
				'first.',
		)
	}

	if(identity.kind === 'eth') {
		return identity.uid
	}

	const res = await client.loginWithToken() as { user?: { uid?: string } }
	const uid = res?.user?.uid
	if(!uid) {
		throw new Error(
			'Could not resolve your account uid from POST /users/login — ' +
			'unexpected response shape.',
		)
	}

	return uid
}

/**
 * Link an unassociated app (minted via `issue_app_credentials`, or any
 * eth-keypair app you already hold the private key for) to the currently
 * authenticated dashboard account. Proves ownership by signing a one-time
 * challenge with the app's private key — the private key itself is only
 * ever used locally to sign, never sent to the server.
 */
export function linkAppTool(client: ReclaimOldClient): RegisteredTool {
	return defineTool<{ appId: string, appSecret: string }>(
		{
			name: 'link_app_to_account',
			description:
				'Link an eth-keypair app to your authenticated dashboard account — ' +
				'use this to keep using an appId/appSecret you already have ' +
				'(instead of minting a fresh one via issue_app_credentials). ' +
				'Requires reclaim_authenticate first. Fetches a one-time nonce, ' +
				'signs `Link <appId> to account <userId> | nonce: <nonce>` locally ' +
				'with `appSecret` (EIP-191, never transmitted), and submits the ' +
				'signature. Fails with APP_ALREADY_LINKED if the app is already ' +
				'linked to a (possibly different) account.',
			inputSchema: {
				type: 'object',
				properties: {
					appId: {
						type: 'string',
						description: 'The eth-address appId to link.',
					},
					appSecret: {
						type: 'string',
						description:
							'The app\'s raw eth private key — used only locally to sign ' +
							'the link challenge, never sent to the server.',
					},
				},
				required: ['appId', 'appSecret'],
			},
		},
		async({ appId, appSecret }) => {
			const userId = await resolveUserId(client)
			const { nonce } = await client.getLinkNonce()
			const message = buildLinkMessage(appId, userId, nonce)
			const signature = signEip191(message, appSecret)
			await client.linkAppToAccount(appId, signature, nonce)
			return {
				linked: true,
				appId,
				note: 'App linked to your account. Run check_app_status to confirm.',
			}
		},
	)
}
