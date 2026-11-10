import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { defineTool, type RegisteredTool } from '../../mcp/server.ts'
import { findProjectRoot } from '../../paths.ts'
import type {
	ReclaimOldClient,
	SessionLogRow,
	SessionLogsQuery,
} from '../client.ts'

/** The log-stream service caps a page at 1000 entries however large a
 *  `limit` asks for, so paging is the only way past it. */
const MAX_PAGE = 1000

/** Inline default. Small enough to stay readable in a tool result; a bigger
 *  pull belongs in `saveTo`. */
const DEFAULT_LIMIT = 200

/** Ceiling on a `saveTo` dump, so a chatty session can't page forever. */
const DEFAULT_MAX_ENTRIES = 20_000

interface Args extends SessionLogsQuery {
	sessionId: string
	/** Substring match on the log line — `logLine` under its dashboard name. */
	contains?: string
	/** Keep only entries that carry an `event_type`. Applied here rather than
	 *  server-side: the devtools route has no `eventTypeOnly` passthrough. */
	eventsOnly?: boolean
	saveTo?: string
	maxEntries?: number
}

/** An entry's fields minus the ones hoisted into `context`. `event` and
 *  `metadata` drop out when empty; `device` and `source` appear only on an
 *  entry that disagrees with a single-valued context. */
interface CompactEntry {
	ts: string
	level: string
	event?: string
	logger: string
	line: string
	device?: string
	source?: string
	metadata?: string
}

export function sessionLogsTool(client: ReclaimOldClient): RegisteredTool {
	return defineTool<Args>(
		{
			name: 'session_logs',
			description:
				'Fetch the raw log entries the in-app SDK emitted during a '
				+ 'verification session, each with its event type (for example '
				+ 'REQUEST_MATCHED, CLAIM_CREATION_STARTED, or PROOF_GENERATED), '
				+ 'log level, and logger name. This is the data behind the '
				+ 'dashboard session-logs tab, and it is far more detailed than '
				+ 'session_analytics_logs, which returns only the coarse milestone '
				+ 'events. Use it to diagnose a session that stalled, matched '
				+ 'nothing, or produced no claim. Narrow the result with eventType, '
				+ 'logLevel, or contains; page through it with limit and offset; or '
				+ 'set saveTo to write every matching entry to an NDJSON file and '
				+ 'read that file with your own tools. Old-devtools mode only. You '
				+ 'must own the app the session belongs to, so call '
				+ 'reclaim_authenticate first.',
			inputSchema: {
				type: 'object',
				properties: {
					sessionId: {
						type: 'string',
						description:
							'Id of the verification session to read log entries for.',
					},
					eventType: {
						type: 'string',
						description:
							'Keep only entries that carry this exact event type, for '
							+ 'example REQUEST_MATCHED or PROOF_GENERATION_FAILED_'
							+ 'EXCEPTION. Most entries carry no event type at all, so '
							+ 'prefer eventsOnly when you want the milestone timeline '
							+ 'rather than guessing a name.',
					},
					eventsOnly: {
						type: 'boolean',
						description:
							'Keep only entries that carry an event type, which gives you '
							+ 'a compact milestone timeline for the session. This tool '
							+ 'applies the filter after fetching, so it narrows what you '
							+ 'read rather than what it fetches.',
					},
					logLevel: {
						type: 'string',
						enum: ['fine', 'config', 'info', 'warning', 'severe', 'unknown'],
						description:
							'Lowest severity to include. Each value is hierarchical: '
							+ '`fine` includes FINE, CONFIG, INFO, WARNING, and SEVERE; '
							+ '`info` drops FINE and CONFIG; `severe` keeps only '
							+ 'failures. Defaults to `fine`, which is wider than the '
							+ 'backend default of `info`. The FINER and FINEST tiers '
							+ 'contain PII, and this route rejects them.',
					},
					logType: {
						type: 'string',
						description:
							'Exact client-side logger name, which the SDK calls `type` — '
							+ 'for example reclaim_flutter_sdk.ClaimCreation. This is not '
							+ 'the event type.',
					},
					contains: {
						type: 'string',
						description:
							'Substring that an entry\'s log line must contain.',
					},
					providerId: {
						type: 'string',
						description:
							'Keep only entries for this provider. A session can touch '
							+ 'more than one provider, so this narrows within the '
							+ 'session; it cannot search across sessions.',
					},
					deviceId: {
						type: 'string',
						description:
							'Keep only entries for this device id, which is the claimant '
							+ 'id.',
					},
					source: {
						type: 'string',
						description:
							'Keep only entries from this client build. The source string '
							+ 'carries the SDK, platform, and version, so it is the field '
							+ 'to compare a working run against a broken one.',
					},
					startTime: {
						type: 'string',
						description:
							'Lower bound, as an ISO-8601 timestamp. If you set neither '
							+ 'bound, the backend searches only the last 3 days.',
					},
					endTime: {
						type: 'string',
						description: 'Upper bound, as an ISO-8601 timestamp.',
					},
					limit: {
						type: 'number',
						description:
							`Log entries per page. Defaults to ${DEFAULT_LIMIT} and is `
							+ `capped at ${MAX_PAGE}. Ignored when you set saveTo.`,
					},
					offset: {
						type: 'number',
						description:
							'Entries to skip, counting back from the newest match. '
							+ 'Ignored when you set saveTo.',
					},
					saveTo: {
						type: 'string',
						description:
							'Path to write every matching entry to, as NDJSON: one raw '
							+ 'entry per line, oldest first. When you set this, the tool '
							+ 'returns a summary instead of the entries. Relative paths '
							+ 'resolve against the project root. Use it when a session '
							+ 'has more entries than you want to read inline.',
					},
					maxEntries: {
						type: 'number',
						description:
							'Maximum entries a saveTo dump collects. Defaults to '
							+ `${DEFAULT_MAX_ENTRIES}.`,
					},
				},
				required: ['sessionId'],
			},
		},
		async(args) => {
			// The backend's own default is `info`, which silently hides every
			// FINE and CONFIG entry — the ones that say what the interceptor
			// actually saw. Debugging is the whole point of this tool, so widen
			// the default here.
			const query: SessionLogsQuery = {
				logLevel: (args.logLevel ?? 'fine'),
				logType: args.logType,
				eventType: args.eventType,
				providerId: args.providerId,
				deviceId: args.deviceId,
				source: args.source,
				startTime: args.startTime,
				endTime: args.endTime,
				logLine: args.contains,
			}

			return args.saveTo
				? await dump(client, args, query, args.saveTo)
				: await page(client, args, query)
		},
	)
}

/** One page, returned inline. */
async function page(
	client: ReclaimOldClient,
	args: Args,
	query: SessionLogsQuery,
) {
	const limit = clampLimit(args.limit ?? DEFAULT_LIMIT)
	const offset = Math.max(args.offset ?? 0, 0)
	const res = await client.getSessionLogs(args.sessionId, {
		...query,
		limit,
		offset,
		includeCount: true,
	})

	// Newest-first off the wire; a debugger reads a session forwards.
	const chronological = [...res.data].reverse()
	const entries = args.eventsOnly
		? chronological.filter(hasEvent)
		: chronological
	const fetched = res.data.length
	const total = res.totalCount

	return {
		...summarize(args, res.failedRegions, entries, total),
		page: {
			limit,
			offset,
			fetched,
			...(args.eventsOnly ? { keptWithEvent: entries.length } : {}),
			hasMore: total === undefined
				? fetched === limit
				: offset + fetched < total,
			nextOffset: offset + fetched,
		},
		entries: compact(entries),
	}
}

/** Every match, paged out to an NDJSON file. */
async function dump(
	client: ReclaimOldClient,
	args: Args,
	query: SessionLogsQuery,
	saveTo: string,
) {
	const maxEntries = Math.max(args.maxEntries ?? DEFAULT_MAX_ENTRIES, 1)
	const all: SessionLogRow[] = []
	const failedRegions = new Set<string>()
	let total: number | undefined
	let offset = 0

	while(all.length < maxEntries) {
		const res = await client.getSessionLogs(args.sessionId, {
			...query,
			limit: Math.min(MAX_PAGE, maxEntries - all.length),
			offset,
			// Only the first page pays for the count; it does not move.
			includeCount: offset === 0,
		})
		for(const region of res.failedRegions ?? []) {
			failedRegions.add(region)
		}

		if(offset === 0) {
			total = res.totalCount
		}

		all.push(...res.data)
		offset += res.data.length
		// A short page means the match set is exhausted.
		if(!res.data.length || res.data.length < MAX_PAGE) {
			break
		}

		if(total !== undefined && offset >= total) {
			break
		}
	}

	all.reverse()
	const entries = args.eventsOnly ? all.filter(hasEvent) : all

	const path = isAbsolute(saveTo)
		? saveTo
		: join(findProjectRoot(process.cwd()), saveTo)
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, entries.map(e => JSON.stringify(e)).join('\n') + '\n')

	return {
		...summarize(args, [...failedRegions], entries, total),
		file: {
			path,
			format: 'ndjson',
			entries: entries.length,
			order: 'oldest first',
			note: 'Each line holds one raw log entry with all of its columns: '
				+ 'timestamp, log_level, event_type, log_type, log_line, '
				+ 'session_id, app_id, provider_id, device_id, source, and '
				+ 'metadata.',
			truncated: entries.length >= maxEntries
				? `Stopped at maxEntries=${maxEntries}. Narrow the filters, or `
					+ 'raise the limit.'
				: undefined,
		},
	}
}

/** The header both modes share: what was asked for, what came back, and the
 *  event-type histogram — usually enough on its own to see where a session
 *  died. */
function summarize(
	args: Args,
	failedRegions: string[] | undefined,
	entries: SessionLogRow[],
	total: number | undefined,
) {
	const events: Record<string, number> = {}
	for(const entry of entries) {
		if(entry.event_type) {
			events[entry.event_type] = (events[entry.event_type] ?? 0) + 1
		}
	}

	return {
		sessionId: args.sessionId,
		context: contextOf(entries),
		totalMatching: total,
		span: entries.length
			? {
				from: entries[0].timestamp,
				to: entries[entries.length - 1].timestamp,
			}
			: undefined,
		eventTypes: Object.keys(events).length ? events : undefined,
		...(failedRegions?.length
			? {
				warning: 'The log-stream query failed in region '
					+ `${failedRegions.join(', ')}, so this result is incomplete.`,
			}
			: {}),
		...(entries.length
			? {}
			: {
				hint: 'No entries matched. Check these causes in order: the '
					+ 'search window defaults to the last 3 days, so pass startTime '
					+ 'and endTime for an older session; the backend deletes entries '
					+ 'after 30 days; the backend picks which regions to query from '
					+ 'the analytics table, so a session that never recorded an '
					+ 'analytics event reads as empty here even when entries exist; '
					+ 'or the filters are too narrow. Cross-check with '
					+ 'session_analytics_logs.',
			}),
	}
}

/** Fields that are identical on every entry, hoisted out so they are not
 *  repeated hundreds of times. */
function contextOf(entries: SessionLogRow[]) {
	const uniq = (pick: (entry: SessionLogRow) => string | undefined) => {
		const set = new Set(entries.map(pick).filter(Boolean) as string[])
		return [...set]
	}

	const one = (values: string[]) => (values.length === 1 ? values[0] : values)
	return entries.length
		? {
			appId: one(uniq(e => e.app_id)),
			providerId: one(uniq(e => e.provider_id)),
			deviceId: one(uniq(e => e.device_id)),
			source: one(uniq(e => e.source)),
		}
		: undefined
}

function compact(entries: SessionLogRow[]): CompactEntry[] {
	const devices = new Set(entries.map(e => e.device_id))
	const sources = new Set(entries.map(e => e.source))
	return entries.map(e => ({
		ts: e.timestamp,
		level: e.log_level,
		...(e.event_type ? { event: e.event_type } : {}),
		logger: e.log_type,
		line: e.log_line,
		// Only worth repeating per entry once the page actually mixes them.
		...(devices.size > 1 ? { device: e.device_id } : {}),
		...(sources.size > 1 ? { source: e.source } : {}),
		...(e.metadata && e.metadata !== '{}' ? { metadata: e.metadata } : {}),
	}))
}

function hasEvent(entry: SessionLogRow): boolean {
	return !!entry.event_type
}

function clampLimit(limit: number): number {
	return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE)
}
