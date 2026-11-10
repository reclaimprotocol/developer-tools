import { isBoom } from '@hapi/boom'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { isProblemDetails, isProblemError } from '@reclaimprotocol/client/api'
import { errorAsToolText } from '../tools/registry.ts'

// One error shape for every MCP tool. The text comes from errorAsToolText
// (shared with the cloud loop); Boom problems also attach structuredContent.
export const remapErrorAsResponse = (
	err: unknown,
): CallToolResult => {
	const text = errorAsToolText(err)

	// Two unrelated things can carry structured data here: the client's own
	// ProblemError (an RFC 9457 response from a Builder API call), and a
	// hand-thrown Boom error whose second argument is arbitrary tool context,
	// for example `badRequest('invalid provider', { field: 'providerId' })`.
	// `isProblemDetails` only rejects a wrongly typed KNOWN field, so it lets
	// that arbitrary shape through too — this isn't a strict RFC 9457 check.
	const data = isProblemError(err)
		? err.data
		: isBoom(err) && err.output?.statusCode
			&& isProblemDetails(err.data)
			? err.data
			: undefined
	if(!data) {
		return {
			isError: true as const,
			content: [{ type: 'text' as const, text }],
		}
	}

	return {
		isError: true as const,
		structuredContent: data,
		content: [{ type: 'text' as const, text }],
	}
}
