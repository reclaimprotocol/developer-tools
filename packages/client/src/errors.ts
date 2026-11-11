import type { ProblemDetails } from './types/openapi.ts'
import { PROBLEM_CONTENT_TYPE } from './consts.ts'

type ProblemErrorOutput = {
	statusCode: number
	headers: Record<string, string>
	payload: ProblemDetails & {
		statusCode: number
		error: string
		message: string
	}
}

/**
 * RFC 9457 error with the fields expected by Boom consumers.
 *
 * `@hapi/boom`'s `isBoom()` recognizes this structural contract. The client
 * doesn't import Boom at runtime, so this error remains browser-safe.
 */
export type ProblemError = Error & {
	readonly isBoom: true
	readonly isServer: boolean
	readonly data: ProblemDetails
	readonly output: ProblemErrorOutput
}

/** Returns whether a thrown value is a Builder {@link ProblemError}. */
export function isProblemError(error: unknown): error is ProblemError {
	if(!(error instanceof Error) || !('isBoom' in error)) {
		return false
	}

	if(
		error.isBoom !== true
		|| !('isServer' in error)
		|| typeof error.isServer !== 'boolean'
		|| !('data' in error)
		|| !('output' in error)
	) {
		return false
	}

	return isProblemDetails(error.data)
		&& isProblemErrorOutput(error.output)
}

/**
 * Whether retrying the same request later can succeed: a network failure, a
 * timeout, or an HTTP 5xx, 408, or 429 from Builder (a {@link ProblemError}
 * or a plain error carrying the HTTP `status`). Everything else, such as a
 * malformed response, won't change on retry. A quota refusal (a 429 that
 * carries `billingUrl`) lasts until the billing period resets or someone
 * upgrades the plan, so it isn't transient.
 */
export function isTransientError(error: unknown): boolean {
	// `fetch` rejects with a TypeError when the network fails.
	if(error instanceof TypeError) {
		return true
	}

	if(
		error instanceof Error
		&& (error.name === 'TimeoutError' || error.name === 'AbortError')
	) {
		return true
	}

	if(isProblemError(error) && error.data.billingUrl) {
		return false
	}

	const status = isProblemError(error)
		? error.output.statusCode
		: isRecord(error) ? error.status : undefined
	return typeof status === 'number'
		&& (status >= 500 || status === 408 || status === 429)
}

// Errors thrown by a network step and judged transient. Tracked by identity
// so a content check that throws, say, a TypeError is never mistaken for one.
const TRANSIENT_ERRORS = new WeakSet<object>()

/**
 * Runs one network step, such as a JWKS fetch or a session or provider
 * lookup, and marks a transient failure so {@link isTransientFailure} can
 * tell it apart from a failed content check.
 */
export async function networkStep<T>(step: () => Promise<T> | T): Promise<T> {
	try {
		return await step()
	} catch(error) {
		if(error instanceof Error && isTransientError(error)) {
			TRANSIENT_ERRORS.add(error)
		}

		throw error
	}
}

/** Whether `error` came from a {@link networkStep} and a retry can succeed. */
export function isTransientFailure(error: unknown): boolean {
	return error instanceof Error && TRANSIENT_ERRORS.has(error)
}

/** Returns whether a value follows the RFC 9457 problem-details schema. */
export function isProblemDetails(value: unknown): value is ProblemDetails {
	if(!isRecord(value)) {
		return false
	}

	return isOptionalString(value.type)
		&& isOptionalString(value.title)
		&& isOptionalStatus(value.status)
		&& isOptionalString(value.detail)
		&& isOptionalString(value.instance)
		&& isOptionalString(value.event)
		&& isOptionalString(value.sessionId)
		&& isOptionalString(value.billingUrl)
}

/** Reads an RFC 9457 response, with a status-only fallback for other bodies. */
export async function readProblemDetails(res: Response) {
	const contentType = res.headers.get('Content-Type') || ''
	if(contentType.includes(PROBLEM_CONTENT_TYPE)) {
		try {
			const value: unknown = await res.json()
			if(isProblemDetails(value)) {
				return {
					...value,
					type: value.type || 'about:blank',
					title: value.title || res.statusText,
					status: value.status || res.status,
				} satisfies ProblemDetails
			}
		} catch{
			// Fall back to the HTTP status when the problem body isn't valid JSON.
		}
	}

	return {
		type: 'about:blank',
		status: res.status,
		title: res.statusText,
	} satisfies ProblemDetails
}

/** Throws a browser-safe, Boom-compatible RFC 9457 error. */
export async function throwProblemError(res: Response): Promise<never> {
	const problem = await readProblemDetails(res)
	const title = problem.title || res.statusText || 'Request failed'
	const fields = {
		isBoom: true,
		isServer: res.status >= 500,
		data: problem,
		output: {
			statusCode: res.status,
			headers: { 'content-type': PROBLEM_CONTENT_TYPE },
			payload: {
				...problem,
				statusCode: res.status,
				error: title,
				message: problem.detail || title,
			},
		},
	} satisfies Omit<ProblemError, keyof Error>
	// Like Boom, the message is the occurrence's detail, so logging the error
	// shows what happened and, for a quota refusal, the billing link.
	const error = Object.assign(new Error(problem.detail || title), fields)
	error.name = 'ProblemError'
	throw error
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProblemErrorOutput(value: unknown): value is ProblemErrorOutput {
	if(!isRecord(value) || !isRecord(value.payload)) {
		return false
	}

	return typeof value.statusCode === 'number'
		&& isStringRecord(value.headers)
		&& isProblemDetails(value.payload)
		&& typeof value.payload.statusCode === 'number'
		&& typeof value.payload.error === 'string'
		&& typeof value.payload.message === 'string'
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return isRecord(value)
		&& Object.values(value).every(item => typeof item === 'string')
}

function isOptionalString(value: unknown) {
	return value === undefined || typeof value === 'string'
}

function isOptionalStatus(value: unknown) {
	return value === undefined
		|| typeof value === 'number'
			&& Number.isInteger(value)
			&& value >= 100
			&& value <= 599
}
