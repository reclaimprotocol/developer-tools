import type { ConfigStore } from '../../../config/store.ts'
import { defineTool, type RegisteredTool } from '../../server.ts'
import { type AttachState, disposeAttached } from './attach.ts'
import { type CaptureStore, resetCaptures } from './capture.ts'

export function sessionTools(
	attachRef: { current?: AttachState, config: ConfigStore },
	captures: CaptureStore,
): RegisteredTool[] {
	return [
		defineTool<Record<string, never>>(
			{
				name: 'get_session',
				description:
					'Returns the current attach state, the live captureIds, the '
					+ 'persisted browser config, and the navigation script kept by '
					+ '`test_user_script`. Call it to check whether a browser is still '
					+ 'attached before reattaching, or to recover a captureId or the '
					+ 'kept script.',
				inputSchema: { type: 'object', properties: {} },
				annotations: { readOnlyHint: true, openWorldHint: false },
			},
			async() => ({
				config: attachRef.config.read()?.browser_agent,
				attached: Boolean(attachRef.current),
				mode: attachRef.current?.mode,
				port: attachRef.current?.port,
				liveViewUrl: attachRef.current?.liveViewUrl,
				browserSessionId: attachRef.current?.browserSessionId,
				orgId: attachRef.current?.orgId,
				captures: [...captures.sessions.keys()],
				activeTab: captures.activeTab,
				keptUserScript: captures.keptScript?.script,
			}),
		),
		defineTool<Record<string, never>>(
			{
				name: 'dispose_browser',
				description:
					'Stops captures, disconnects the current browser, and deletes a '
					+ 'Builder-hosted browser session at once. Clears the kept '
					+ 'navigation script. Reclaim disconnects a custom CDP browser but '
					+ 'never deletes it.',
				inputSchema: { type: 'object', properties: {} },
				annotations: { destructiveHint: true, openWorldHint: true },
			},
			async() => {
				await resetAll(attachRef, captures)
				return { disposed: true }
			},
		),
		defineTool<Record<string, never>>(
			{
				name: 'reset_session',
				description:
					'Stops all captures and clears capture state, dropping every '
					+ 'draft and its in-memory secrets. Also disconnects the browser '
					+ 'and clears the kept navigation script.',
				inputSchema: { type: 'object', properties: {} },
				annotations: { destructiveHint: true, openWorldHint: true },
			},
			async() => {
				await resetAll(attachRef, captures)
				return { reset: true }
			},
		),
	]
}

/**
 * Release everything a session holds: the captures and the browser itself.
 *
 * Exported because a session can end WITHOUT anyone calling `dispose_browser` —
 * the developer closes their agent, the client kills the server, the transport
 * drops. Nothing runs on its own then, so `start.ts` runs this. Without it a
 * container keeps running.
 */
export async function resetAll(
	attachRef: { current?: AttachState, config: ConfigStore },
	captures: CaptureStore,
) {
	await resetCaptures(captures)
	await disposeAttached(attachRef)
}
