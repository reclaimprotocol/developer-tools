import { isProblemError } from '@reclaimprotocol/client/api'
import { currentTelemetry } from './index.ts'

const GOAL_MAX = 300
const USER_REQUEST_MAX = 500
const DOMAIN_MAX = 200
const DATA_POINTS_MAX = 20
const DATA_POINT_MAX = 200

/**
 * Times a tool call and records it. Call `end()` once when the call
 * finishes. It never throws, so it can't change the outcome of the call.
 */
export function startToolCall(tool: string, args: unknown) {
	const startedAt = Date.now()
	return {
		end(err?: unknown) {
			try {
				const telemetry = currentTelemetry()
				if(!telemetry) {
					return
				}

				const input = allowlistedInput(tool, args)
				telemetry.track('tool_call', {
					tool,
					ok: err === undefined,
					...(err === undefined ? {} : { errorCode: errorCode(err) }),
					durationMs: Date.now() - startedAt,
					mode: telemetry.mode,
					...(input ? { input } : {}),
				})
			} catch{
				// Telemetry must never affect a tool call.
			}
		},
	}
}

/**
 * A category for the error, such as `http_401`. It's never the message,
 * because messages can contain URLs, tokens, or file paths.
 */
export function errorCode(err: unknown): string {
	if(isProblemError(err)) {
		return `http_${err.output.statusCode}`
	}

	if(isRecord(err) && err.isBoom === true && isRecord(err.output)) {
		return `http_${String(err.output.statusCode)}`
	}

	if(err instanceof Error) {
		if(err.name === 'ZodError') {
			return 'invalid_input'
		}

		if(err.name === 'TimeoutError' || err.name === 'AbortError') {
			return 'timeout'
		}
	}

	return 'error'
}

/**
 * The only arguments Reclaim records, and only for these tools. They are the
 * developer's own description of what they want to build, which tells us
 * which providers to add. Every other argument is dropped here, so a new tool
 * records nothing until you add it to this list on purpose.
 */
export function allowlistedInput(tool: string, args: unknown) {
	if(!isRecord(args)) {
		return undefined
	}

	switch (tool) {
		case 'start_integration':
			return compact({
				goal: cut(args.goal, GOAL_MAX),
				userRequest: cut(args.userRequest, USER_REQUEST_MAX),
			})
		case 'propose_provider':
			return compact({ userRequest: cut(args.userRequest, USER_REQUEST_MAX) })
		case 'discover_resolve': {
			const query = isRecord(args.query) ? args.query : {}
			const dataPoints = Array.isArray(query.dataPoints)
				? query.dataPoints
					.slice(0, DATA_POINTS_MAX)
					.map((p) => cut(p, DATA_POINT_MAX))
					.filter((p) => p !== undefined)
				: undefined
			return compact({
				domain: cut(query.domain, DOMAIN_MAX),
				dataPoints: dataPoints?.length ? dataPoints : undefined,
			})
		}

		default:
			return undefined
	}
}

function cut(value: unknown, max: number): string | undefined {
	return typeof value === 'string' && value ? value.slice(0, max) : undefined
}

/** Returns the object, or undefined when every field is undefined. */
function compact<T extends object>(obj: T): T | undefined {
	return Object.values(obj).some((v) => v !== undefined) ? obj : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
