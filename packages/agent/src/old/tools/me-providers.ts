import { defineTool, type RegisteredTool } from '../../mcp/server.ts'
import type { ReclaimOldClient } from '../client.ts'

/**
 * List the authenticated user's OWN providers on the old devtools backend
 * (`GET /api/providers/user/paginated`, filtered server-side to the caller's
 * uid). This exists ONLY in old mode: the generated provider-listing tools
 * are disabled there, so this is the way to discover a `providerId` to pass
 * back into `create_provider_version_from_capture` for a version update.
 */
export function getMeProvidersTool(client: ReclaimOldClient): RegisteredTool {
	return defineTool<{
		pageKey?: number
		pageSize?: number
		searchQuery?: string
	}>(
		{
			name: 'get_me_providers',
			description:
				'List the providers YOU own on the old devtools backend (newest ' +
				'first). Returns provider metadata including each `providerId` — ' +
				'pass one back to create_provider_version_from_capture to publish a ' +
				'new version of that provider instead of creating a duplicate. ' +
				'Requires reclaim_authenticate (old-devtools login) first — this ' +
					'is separate from authenticate_builder/Builder auth, which does ' +
					'not authorize this call. Check status with get_devtools_mode.',
			inputSchema: {
				type: 'object',
				properties: {
					pageKey: { type: 'number', description: 'Page index (default 0).' },
					pageSize: {
						type: 'number',
						description: 'Page size (default 20).',
					},
					searchQuery: {
						type: 'string',
						description: 'Filter by name or providerId.',
					},
				},
			},
		},
		async(args) => client.getMyProviders(args),
	)
}
