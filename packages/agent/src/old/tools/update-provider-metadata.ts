import { defineTool, type RegisteredTool } from '../../mcp/server.ts'
import type { ReclaimOldClient, UpdateProviderMetadataBody } from '../client.ts'

/**
 * Edit provider-level metadata on the old devtools backend
 * (`POST /api/providers/:providerId`) — a genuine PARTIAL update on the
 * PROVIDER document itself, distinct from both
 * `create_provider_version_from_capture` paths: it does NOT touch
 * `providerConfig`/versions at all, and only the fields you pass here
 * change — everything else on the provider is left untouched (no need to
 * re-supply `requestData`/`customInjection`, and so on, and
 * no new version is created).
 *
 * The backend 403s if you don't own the provider (and aren't an admin) —
 * surfaced verbatim, same as any other auth failure from this client.
 */
export function updateProviderMetadataTool(
	client: ReclaimOldClient,
): RegisteredTool {
	return defineTool<UpdateProviderMetadataBody & { providerId: string }>(
		{
			name: 'update_provider_metadata',
			description:
				'Rename, redescribe, retag, flip providerType (PRIVATE/PUBLIC), or ' +
				'toggle isActive on a provider YOU own — WITHOUT creating a new ' +
				'version. Only the fields you pass change; everything else ' +
				'(requestData, customInjection, versions, ...) is untouched. Pass ' +
				'at least one of the optional fields. Get a `providerId` from ' +
				'get_me_providers.',
			inputSchema: {
				type: 'object',
				properties: {
					providerId: {
						type: 'string',
						description: 'UUID of the provider to update.',
					},
					name: { type: 'string', description: 'New provider name.' },
					description: {
						type: 'string',
						description: 'New provider description.',
					},
					providerType: {
						type: 'string',
						enum: ['PRIVATE', 'PUBLIC'],
						description: 'Change PRIVATE/PUBLIC visibility.',
					},
					tags: {
						type: 'array',
						items: { type: 'string' },
						description: 'Replace the provider\'s tag list.',
					},
					isActive: {
						type: 'boolean',
						description: 'Whether the provider is active.',
					},
				},
				required: ['providerId'],
			},
		},
		async({ providerId, ...body }) => {
			const hasAnyField = Object.values(body).some((v) => v !== undefined)
			if(!hasAnyField) {
				throw new Error(
					'Pass at least one of: name, description, providerType, tags, ' +
					'isActive.',
				)
			}

			return client.updateProviderMetadata(providerId, body)
		},
	)
}
