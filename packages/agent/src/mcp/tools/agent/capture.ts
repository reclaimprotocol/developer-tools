import {
	type DraftStore,
	type KeptScriptRef,
	makeDraftStore,
} from '../../../authoring/index.ts'
import {
	DEFAULT_MAX_CHARS,
	TEXT_WINDOW_PROPERTIES,
	textWindow,
	type TextWindowArgs,
} from '../../../authoring/util.ts'
import { type CaptureSession, startCapture } from '../../../cdp/capture.ts'
import { defineTool, type RegisteredTool } from '../../server.ts'
import type { AttachState } from './attach.ts'

/**
 * One capture == a session (network requests) + the tab CDP client it runs on +
 * a draft store. Bundling the tab client is what lets the shared authoring
 * tools treat a `captureId` as a full session (drive the browser AND read
 * capture AND hold drafts) behind one id.
 */
export interface CaptureEntry {
	session: CaptureSession
	tabClient: Awaited<ReturnType<AttachState['handles']['attachToTab']>>
	drafts: DraftStore
}

interface GetRequestArgs {
	captureId: string
	requestId: string
	maxChars?: number
	offset?: number
	full?: boolean
}

export interface CaptureStore extends KeptScriptRef {
	sessions: Map<string, CaptureEntry>
	activeTab?: string
}

export async function resetCaptures(captures: CaptureStore) {
	for(const entry of captures.sessions.values()) {
		await entry.session.stop().catch(() => {})
	}

	captures.sessions.clear()
	delete captures.activeTab
	delete captures.keptScript
}

export function captureTools(
	attachRef: { current?: AttachState },
	captures: CaptureStore,
): RegisteredTool[] {
	const requireAttached = (): AttachState => {
		if(!attachRef.current) {
			throw new Error('Not attached. Call attach_browser first.')
		}

		return attachRef.current
	}

	const startTool = defineTool<{ tabId: string }>(
		{
			name: 'start_capture',
			description:
				'Starts recording network requests on a tab. Returns a captureId, '
				+ 'the session handle that the authoring tools (`navigate`, '
				+ '`propose_provider`, `run_proof`) take.',
			inputSchema: {
				type: 'object',
				properties: { tabId: { type: 'string' } },
				required: ['tabId'],
			},
			annotations: { openWorldHint: true },
		},
		async({ tabId }) => {
			const attached = requireAttached()
			const tabClient = await attached.handles.attachToTab(tabId)
			const session = await startCapture(tabClient)
			captures.sessions.set(session.captureId, {
				session, tabClient, drafts: makeDraftStore(),
			})
			captures.activeTab = tabId
			return { captureId: session.captureId }
		},
	)

	const stopTool = defineTool<{ captureId: string }>(
		{
			name: 'stop_capture',
			description:
				'Stops recording on a capture. Captured requests stay queryable '
				+ 'until `reset_session`.',
			inputSchema: {
				type: 'object',
				properties: { captureId: { type: 'string' } },
				required: ['captureId'],
			},
			annotations: { openWorldHint: false, idempotentHint: true },
		},
		async({ captureId }) => {
			const entry = captures.sessions.get(captureId)
			if(!entry) {
				throw new Error(`no capture ${captureId}`)
			}

			await entry.session.stop()
			return { stopped: true, requestCount: entry.session.requests.size }
		},
	)

	const getTool = defineTool<GetRequestArgs>(
		{
			name: 'get_request',
			description:
				'Returns the headers and bodies of one captured request, to inspect '
				+ 'a candidate that `find_requests_containing` ranked. Each body is '
				+ `cut to ${DEFAULT_MAX_CHARS} characters by default; a cut body `
				+ 'comes with `requestBodyTruncation` or `responseBodyTruncation` '
				+ '(total size and `nextOffset`). Page with `offset`, or pass '
				+ '`maxChars` or `full`. Unlike the other tools, headers are raw: '
				+ 'cookie and authorization values are visible. Read them for '
				+ 'diagnosis; do not repeat them to the developer or write them to '
				+ 'a file.',
			inputSchema: {
				type: 'object',
				properties: {
					captureId: { type: 'string' },
					requestId: { type: 'string' },
					...TEXT_WINDOW_PROPERTIES,
				},
				required: ['captureId', 'requestId'],
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async(args) => {
			const { captureId, requestId } = args
			const entry = captures.sessions.get(captureId)
			if(!entry) {
				throw new Error(`no capture ${captureId}`)
			}

			const r = entry.session.requests.get(requestId)
			if(!r) {
				throw new Error(`no request ${requestId} in capture ${captureId}`)
			}

			const { requestBody, responseBody, ...meta } = r
			const body = entry.session.bodies.get(requestId)
			const result = {
				...meta,
				...windowed('requestBody', requestBody, args),
				...windowed(
					'responseBody', body.available ? body.body : responseBody, args,
				),
			}
			return body.available
				? { ...result, bodyAvailable: true }
				: { ...result, bodyAvailable: false, reason: body.reason }
		},
	)

	return [startTool, stopTool, getTool]
}

/** `{ [key]: text window }`, plus `[key]Truncation` when the window cut it. */
function windowed(
	key: 'requestBody' | 'responseBody',
	text: string | undefined,
	args: TextWindowArgs,
) {
	if(text === undefined) {
		return {}
	}

	const { text: part, truncation } = textWindow(text, args)
	return {
		[key]: part,
		...(truncation ? { [`${key}Truncation`]: truncation } : {}),
	}
}
