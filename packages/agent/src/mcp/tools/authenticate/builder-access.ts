import type { ReclaimClient } from '@reclaimprotocol/client/api'
import { defineTool, type RegisteredTool } from '../../server.ts'
import { authenticateTool, waitForSignInTool } from './authenticate.ts'

/** Legacy-devtools mode needs a distinct Builder login for its two
 * Builder-exclusive features: allocating quota-accounted Popcorn sessions
 * (see `buildBuilderOrganizationTools` below) and listing Builder
 * organizations. Builder mode needs neither — its native auth tool alone
 * covers both, org listing included (via its generated `list_orgs`). */
export function buildBuilderAuthenticationTools(
	client: ReclaimClient,
): RegisteredTool[] {
	return [
		authenticateTool(client, 'authenticate_builder'),
		waitForSignInTool(client, 'authenticate_builder'),
	]
}

/** Legacy-devtools mode lacks generated Builder API tools, so it needs this
 * narrow organization-discovery bridge — an org id is required to allocate a
 * remote-browser (Popcorn) session. Builder mode's own `list_orgs` already
 * covers this under its native auth. */
export function buildBuilderOrganizationTools(
	client: ReclaimClient,
): RegisteredTool[] {
	return [
		defineTool<{ cursor?: string }>(
			{
				name: 'list_builder_organizations',
				description:
					'List organizations available to the authenticated Builder user. '
					+ 'Use an organization id from this result when calling '
					+ 'attach_browser with mode="builder". Available only in '
					+ 'legacy-devtools publishing mode; Builder mode uses list_orgs.',
				inputSchema: {
					type: 'object',
					properties: {
						cursor: { type: 'string', maxLength: 500 },
					},
				},
				annotations: { readOnlyHint: true, openWorldHint: true },
			},
			async({ cursor }) => {
				const { data } = await client.call('ListOrgs', {
					query: { ...(cursor ? { cursor } : {}) },
				})
				return data
			},
		),
	]
}
