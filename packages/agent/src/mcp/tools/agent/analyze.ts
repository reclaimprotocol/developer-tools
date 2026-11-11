import { detectConcerns } from '../../../provider/constraints.ts'
import { defineTool, type RegisteredTool } from '../../server.ts'
import type { CaptureStore } from './capture.ts'

export function analyzeTool(captures: CaptureStore): RegisteredTool {
	return defineTool<{ captureId: string, requestId: string }>(
		{
			name: 'analyze_request_constraints',
			description:
				'Returns provider-authoring concerns for one captured request: '
				+ 'signed request, CSRF dependency, bot challenge, short-lived '
				+ 'token, or GraphQL. Call it on each top candidate from '
				+ '`find_requests_containing` before drafting, and relay the '
				+ '`concerns` to the developer verbatim.',
			inputSchema: {
				type: 'object',
				properties: {
					captureId: { type: 'string' },
					requestId: { type: 'string' },
				},
				required: ['captureId', 'requestId'],
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async({ captureId, requestId }) => {
			const entry = captures.sessions.get(captureId)
			if(!entry) {
				throw new Error(`no capture ${captureId}`)
			}

			const r = entry.session.requests.get(requestId)
			if(!r) {
				throw new Error(`no request ${requestId} in capture ${captureId}`)
			}

			return { concerns: detectConcerns(r) }
		},
	)
}
