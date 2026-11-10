import { defineTool, type RegisteredTool } from '../../server.ts'
import type { AttachState } from './attach.ts'

/** The one browser tool that isn't session-bound: enumerate tabs so the caller
 *  can pick one to `start_capture` on. Navigate/eval/wait are the shared
 *  authoring tools (keyed by captureId — see `shared.ts`). */
export function listTabsTool(attachRef: {
	current?: AttachState
}): RegisteredTool {
	return defineTool<Record<string, never>>(
		{
			name: 'list_tabs',
			description:
				'Returns the open tabs of the attached browser, each with its tabId, '
				+ 'title, and URL. Call it after `attach_browser` to pick the tabId '
				+ 'for `start_capture`.',
			inputSchema: { type: 'object', properties: {} },
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		async() => {
			if(!attachRef.current) {
				throw new Error('Not attached. Call attach_browser first.')
			}

			return { tabs: await attachRef.current.handles.listTabs() }
		},
	)
}
