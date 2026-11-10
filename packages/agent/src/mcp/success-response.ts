import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/** Return successful tool data in both MCP representations. Older clients read
 * the JSON text; newer clients can consume `structuredContent` without asking
 * the model to parse or reconstruct identifiers, URLs, and state. */
export function successResponse(value: unknown): CallToolResult {
	return {
		structuredContent: structured(value),
		content: [{
			type: 'text',
			// A string result is text written for the agent (a plan, a guide):
			// JSON-quoting it would escape every newline.
			text: typeof value === 'string'
				? value
				: JSON.stringify(value, null, 2) ?? 'null',
		}],
	}
}

function structured(value: unknown): Record<string, unknown> {
	if(isRecord(value)) {
		return value
	}

	return { result: value ?? null }
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}
