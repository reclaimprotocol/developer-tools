/**
 * Small shared helpers for the authoring tools (see tools.ts). Kept separate so
 * the per-tool files (find.ts, propose.ts, replay.ts) and the inline tools in
 * tools.ts share one copy without a circular import.
 */
import type { JSONSchema } from 'zod/v4/core'
import type { CapturedRequest } from '../provider/schema.ts'
import type { AuthoringBackend } from './backend.ts'

/**
 * Resolves the session backend for a tool call. The MCP keys it by
 * `args.captureId` (multi-session); the cloud loop returns its one run backend.
 * Each authoring tool closes over this so the same tool works for both hosts.
 */
export type ResolveBackend =
	(args: Record<string, unknown>) => AuthoringBackend

/** Build an `object` JSON Schema for a tool input — a small literal shortener,
 *  not a tool abstraction. */
export function objectSchema(
	properties: Record<string, unknown>,
	required?: string[],
): JSONSchema.ObjectSchema {
	// `properties` is an untyped Record here (this is a literal shortener, not a
	// schema validator), so it doesn't structurally match ObjectSchema's strict
	// per-property schema type — assert the shape.
	return {
		type: 'object',
		properties,
		...(required?.length ? { required } : {}),
	} as unknown as JSONSchema.ObjectSchema
}

/** Secret-free projection of a captured request for tool output. */
export function publicRequest(r: CapturedRequest) {
	return {
		requestId: r.requestId,
		method: r.method,
		url: r.url,
		status: r.status,
		contentType: r.contentType,
		size: r.size,
		...(r.graphqlOp ? { graphqlOp: r.graphqlOp } : {}),
	}
}

/** Characters a long text field returns by default (about 20 KB of ASCII),
 *  so one page body or eval result can't flood the caller's context. */
export const DEFAULT_MAX_CHARS = 20_000

export interface TextWindowArgs {
	maxChars?: unknown
	offset?: unknown
	full?: unknown
}

/** Input properties that let a caller page through, or opt out of, the
 *  window {@link textWindow} applies. */
export const TEXT_WINDOW_PROPERTIES = {
	maxChars: {
		type: 'integer',
		minimum: 1,
		description: `Maximum characters to return. Default ${DEFAULT_MAX_CHARS}.`,
	},
	offset: {
		type: 'integer',
		minimum: 0,
		description: 'Character offset to start from, such as a previous '
			+ '`nextOffset`. Default 0.',
	},
	full: {
		type: 'boolean',
		description: 'Return the whole text, ignoring `maxChars`. It can be '
			+ 'megabytes, so prefer paging with `offset`.',
	},
} satisfies Record<string, JSONSchema.BaseSchema>

/**
 * Returns characters `[offset, offset + maxChars)` of `text`. When that isn't
 * the whole text, `truncation` reports the total size and how to get the rest.
 */
export function textWindow(text: string, args: TextWindowArgs) {
	const totalChars = text.length
	const offset = Math.min(Math.max(Number(args.offset) || 0, 0), totalChars)
	const maxChars = args.full === true
		? totalChars
		: Math.max(Number(args.maxChars) || DEFAULT_MAX_CHARS, 1)
	const end = Math.min(offset + maxChars, totalChars)
	if(offset === 0 && end === totalChars) {
		return { text }
	}

	const part = text.slice(offset, end)
	const more = end < totalChars
	return {
		text: part,
		truncation: {
			totalChars,
			offset,
			returnedChars: part.length,
			...(more ? { nextOffset: end } : {}),
			note: `Returned characters ${offset}-${end} of ${totalChars}.`
				+ (more
					? ` Call again with offset: ${end} for more, or full: true `
						+ 'for the whole text.'
					: ''),
		},
	}
}
