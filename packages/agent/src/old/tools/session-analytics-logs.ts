import { defineTool, type RegisteredTool } from '../../mcp/server.ts'
import type { ReclaimOldClient } from '../client.ts'

/**
 * Fetch analytics logs for a verification session from the OLD-devtools logs
 * service (`GET https://logs.reclaimprotocol.org/api/analytics-logs/session/
 * :sessionId`). Old mode only — useful for diagnosing why a session failed or
 * stalled. The logs service is a separate host from the devtools API.
 */
export function sessionAnalyticsLogsTool(
	client: ReclaimOldClient,
): RegisteredTool {
	return defineTool<{ sessionId: string }>(
		{
			name: 'session_analytics_logs',
			description:
				'Fetch analytics logs for a verification session by id from the '
				+ 'old-devtools logs service — use to diagnose what happened in a '
				+ 'session (matches, claims, failures). Pass the `sessionId`.',
			inputSchema: {
				type: 'object',
				properties: {
					sessionId: {
						type: 'string',
						description: 'The verification session id to fetch logs for.',
					},
				},
				required: ['sessionId'],
			},
		},
		async(args) => client.getSessionAnalyticsLogs(args.sessionId),
	)
}
