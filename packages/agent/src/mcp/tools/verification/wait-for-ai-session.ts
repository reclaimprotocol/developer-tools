import { isProblemError, ReclaimClient } from '@reclaimprotocol/client/api'
import { apiUrl } from '../../../consts.ts'
import { defineTool, type RegisteredTool } from '../../server.ts'
import { resolveOrgSecret } from './result.ts'

const POLL_MS = 2_000
const DEFAULT_TIMEOUT_S = 120
const MAX_TIMEOUT_S = 600
const MAX_EVENTS = 5

type LookupStatus = 'resolving' | 'ready' | 'started' | 'failed'

type Lookup = {
	status: LookupStatus
	error?: { title?: string, status?: number, detail?: string }
	dataPoints?: { name: string, isOptional: boolean }[]
	candidates?: { loginUrl: string, source: string, confidence: number }[]
}

type SessionState = {
	status: string
	callbackDeliveryStatus?: string
	verificationUrl?: string
}

type SessionEvent = {
	event: string
	eventData?: Record<string, unknown>
}

/** The three reads the tool needs. Injectable for tests. */
export type AiSessionApi = {
	getLookup(sessionId: string): Promise<Lookup>
	getSession(sessionId: string): Promise<SessionState>
	listEvents(sessionId: string): Promise<SessionEvent[]>
}

type Deps = {
	createApi?: (orgToken?: string) => AiSessionApi
	sleep?: (ms: number) => Promise<void>
	now?: () => number
}

const FALLBACK_HINT = 'Retry once with adjusted `dataPoints` or `loginUrls`. '
	+ 'If that fails too, fall back to the provider route: call '
	+ '`start_integration` with `route: \'provider\'`.'

/**
 * `wait_for_ai_session` — polls an AI verification session (lookup, session
 * status, and recent events) until something notable happens, and returns a
 * compact, value-free summary with a `next` step and a fallback verdict.
 */
export function waitForAiSessionTool(deps: Deps = {}): RegisteredTool {
	const createApi = deps.createApi ?? defaultApi
	const sleep = deps.sleep ?? defaultSleep
	const now = deps.now ?? Date.now

	return defineTool<{
		sessionId: string
		timeoutSeconds?: number
		untilTerminal?: boolean
		orgToken?: string
	}>(
		{
			name: 'wait_for_ai_session',
			description:
				'Waits for an AI verification session and returns a summary. '
				+ 'Polls every 2 seconds until the lookup is ready or failed, or '
				+ 'the session ends, or the timeout passes. Set `untilTerminal` to '
				+ 'keep waiting until the session ends, for example after you share '
				+ 'the verification URL. The result has the lookup state, the session '
				+ 'status, recent event types, and `next`: `share_url`, '
				+ '`waiting_for_user`, `waiting_for_lookup`, `done`, or `none`. '
				+ 'When `fallback.recommended` is true, follow its `reason`. '
				+ 'Authenticates with the org API key: `orgToken`, else '
				+ '`RECLAIM_ORG_SECRET`, else the key saved by `issue_org_token`.',
			inputSchema: {
				type: 'object',
				required: ['sessionId'],
				properties: {
					sessionId: {
						type: 'string',
						description:
							'The session ID from `create_ai_verification_session`.',
					},
					timeoutSeconds: {
						type: 'integer',
						minimum: 1,
						maximum: MAX_TIMEOUT_S,
						description: `How long to wait. Default ${DEFAULT_TIMEOUT_S}, `
							+ `maximum ${MAX_TIMEOUT_S}.`,
					},
					untilTerminal: {
						type: 'boolean',
						description: 'If true, return only when the session ends or '
							+ 'the lookup fails, not when the lookup is ready.',
					},
					orgToken: {
						type: 'string',
						pattern: '^rorg_',
						maxLength: 200,
						description: 'The organization API key (`rorg_…`). Defaults to '
							+ 'the MCP server\'s RECLAIM_ORG_SECRET, then the key saved by '
							+ '`issue_org_token`. Never echo it back to the user.',
					},
				},
			},
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		async(args) => {
			const api = createApi(args.orgToken)
			const timeoutS = Math.min(
				Math.max(args.timeoutSeconds ?? DEFAULT_TIMEOUT_S, 1),
				MAX_TIMEOUT_S,
			)
			const deadline = now() + timeoutS * 1000
			let lookup: Lookup = { status: 'resolving' }
			let session: SessionState = { status: 'pending' }

			while(true) {
				lookup = await tolerate(
					() => api.getLookup(args.sessionId),
					lookup,
				)
				session = await tolerate(
					() => api.getSession(args.sessionId),
					session,
				)

				const terminal = session.status !== 'pending'
				const failed = lookup.status === 'failed'
				const notable = !args.untilTerminal && lookup.status !== 'resolving'
				const timedOut = now() >= deadline
				if(terminal || failed || notable || timedOut) {
					const events = await tolerate(
						() => api.listEvents(args.sessionId),
						[] as SessionEvent[],
					)
					const settled = terminal || failed || notable
					return summarize(lookup, session, events, timedOut && !settled)
				}

				await sleep(POLL_MS)
			}
		},
	)
}

function summarize(
	lookup: Lookup,
	session: SessionState,
	events: SessionEvent[],
	timedOut: boolean,
) {
	const recent = events.slice(-MAX_EVENTS).map((item) => {
		const reasonCode = reasonCodeOf(item.eventData)
		return reasonCode
			? { event: item.event, reasonCode }
			: { event: item.event }
	})
	const reasonCodes = recent.flatMap((item) => (
		'reasonCode' in item ? [item.reasonCode] : []
	))

	let next: 'share_url' | 'waiting_for_user' | 'waiting_for_lookup'
		| 'done' | 'none'
	let fallbackReason: string | undefined
	if(lookup.status === 'failed') {
		const status = lookup.error?.status
		const why = status === 404
			? 'No login page was found.'
			: status === 422
				? 'The prompt is not a request Reclaim can verify.'
				: status === 503
					? 'The AI model or web search stayed unavailable.'
					: 'The lookup failed.'
		next = 'none'
		fallbackReason = `${why} ${FALLBACK_HINT}`
	} else if(session.status === 'success') {
		next = 'done'
	} else if(session.status === 'pending') {
		next = lookup.status === 'ready'
			? 'share_url'
			: lookup.status === 'started'
				? 'waiting_for_user'
				: 'waiting_for_lookup'
	} else {
		next = 'none'
		if(session.status === 'rejected') {
			const code = reasonCodes.at(-1)
			fallbackReason = `The session was rejected${code ? ` (${code})` : ''}. `
				+ FALLBACK_HINT
		} else if(session.status === 'error' || session.status === 'expired') {
			fallbackReason = `The session ended with status ${session.status}. `
				+ FALLBACK_HINT
		}
	}

	return {
		lookup: {
			status: lookup.status,
			...(lookup.candidates && {
				candidates: lookup.candidates.map((item) => ({
					loginUrl: item.loginUrl,
					source: item.source,
					confidence: item.confidence,
				})),
			}),
			...(lookup.dataPoints && {
				dataPoints: lookup.dataPoints.map((item) => ({
					name: item.name,
					isOptional: item.isOptional,
				})),
			}),
			...(lookup.error && {
				error: {
					title: lookup.error.title,
					status: lookup.error.status,
					detail: lookup.error.detail,
				},
			}),
		},
		session: {
			status: session.status,
			callbackDeliveryStatus: session.callbackDeliveryStatus,
			events: recent,
		},
		next,
		...(next === 'share_url' && session.verificationUrl
			? { verificationUrl: session.verificationUrl }
			: {}),
		...(fallbackReason
			? { fallback: { recommended: true, reason: fallbackReason } }
			: {}),
		...(timedOut ? { timedOut: true } : {}),
	}
}

function defaultSleep(ms: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function reasonCodeOf(data: Record<string, unknown> | undefined) {
	const direct = data?.reasonCode
	if(typeof direct === 'string') {
		return direct
	}

	const problem = data?.problem
	if(problem && typeof problem === 'object' && 'reasonCode' in problem) {
		return typeof problem.reasonCode === 'string'
			? problem.reasonCode
			: undefined
	}

	return undefined
}

/** Keeps the last good value across transient errors (network, 5xx, 429). */
async function tolerate<T>(read: () => Promise<T>, previous: T): Promise<T> {
	try {
		return await read()
	} catch(err) {
		if(err instanceof TypeError) {
			return previous
		}

		if(isProblemError(err)) {
			const code = err.output.statusCode
			if(code >= 500 || code === 429) {
				return previous
			}
		}

		throw err
	}
}

function defaultApi(orgToken?: string): AiSessionApi {
	const client = new ReclaimClient({
		baseUrl: apiUrl(),
		token: resolveOrgSecret(orgToken),
	})
	return {
		async getLookup(sessionId) {
			const res = await client.call('GetAiVerificationSession', {
				params: { sessionId },
			})
			return res.data
		},
		async getSession(sessionId) {
			const res = await client.call('GetVerificationSession', {
				params: { sessionId },
			})
			return res.data
		},
		async listEvents(sessionId) {
			const res = await client.call('ListVerificationEvents', {
				params: { sessionId },
			})
			return res.data.items
		},
	}
}
