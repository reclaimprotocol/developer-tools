import { defineTool, type RegisteredTool } from '../../mcp/server.ts'
import type { ReclaimOldClient } from '../client.ts'

/**
 * Public, unauthenticated app status lookup — works for any `appId`, owned
 * or not, linked or sandboxed. Mirrors the backend's
 * `GET /api/applications/status/:appId`.
 */
export function checkAppStatusTool(client: ReclaimOldClient): RegisteredTool {
	return defineTool<{ appId: string }>(
		{
			name: 'check_app_status',
			description:
				'Check a Reclaim app\'s link/sandbox status by appId — no ' +
				'authentication required. Returns whether the app is linked to a ' +
				'dashboard account (`isLinked`), and for linked apps, remaining ' +
				'session quota. A 404 means the appId has never been used yet — ' +
				'it is created lazily on the first ReclaimProofRequest.init() call ' +
				'or via issue_app_credentials.',
			inputSchema: {
				type: 'object',
				properties: {
					appId: {
						type: 'string',
						description: 'The eth-address appId to check.',
					},
				},
				required: ['appId'],
			},
		},
		async({ appId }) => client.getApplicationStatus(appId),
	)
}
