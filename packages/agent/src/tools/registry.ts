/**
 * The ONE tool primitive for the agent. A tool is authored once with
 * {@link defineTool} — `{ definition, handler }`, where the handler receives
 * args already parsed + validated against the definition's JSON Schema (via
 * zod), so the schema shown to the model and the validation applied to inbound
 * args cannot drift.
 *
 * This lives outside `mcp/` on purpose: it depends only on zod (NOT the MCP
 * SDK), so non-MCP consumers — the cloud authoring loop — can author and run
 * these tools without pulling in `@modelcontextprotocol/sdk`. The MCP-specific
 * glue (`registerToolList` onto an `McpServer`) stays in `mcp/server.ts`, which
 * re-exports this primitive for the MCP-side tool files.
 */
import { isBoom } from '@hapi/boom'
import { isProblemDetails, isProblemError } from '@reclaimprotocol/client/api'
import type { JSONSchema } from 'zod/v4/core'
import { toZod } from '../mcp/api/to-zod.ts'

/** MCP tool hints that let a client decide when to ask for approval. */
export interface ToolAnnotations {
	/** The tool never changes state. */
	readOnlyHint?: boolean
	/** The tool can delete or overwrite state. */
	destructiveHint?: boolean
	/** Repeating a call with the same input has no further effect. */
	idempotentHint?: boolean
	/** The tool reaches systems outside this machine. */
	openWorldHint?: boolean
}

export interface ToolDefinition {
	name: string
	description: string
	inputSchema: JSONSchema.ObjectSchema
	annotations?: ToolAnnotations
}

export interface RegisteredTool {
	definition: ToolDefinition
	/**
	 * @param args Tool arguments (already zod-validated against the schema).
	 * @returns A JSON-stringifiable value to return to the LLM.
	 * @throws Any error; the host (MCP `registerToolList` / the cloud loop)
	 * catches it and surfaces it as an error tool-result.
	 */
	handler: (args: unknown) => Promise<unknown>
}

/**
 * Define a tool with a single inputSchema (JSON Schema) as the source of truth.
 * The handler receives args already parsed and type-narrowed via a Zod schema
 * derived from that same JSON Schema — so the description sent to the client
 * and the validation applied to inbound args cannot drift.
 */
export function defineTool<TArgs>(
	definition: ToolDefinition,
	handler: (args: TArgs) => Promise<unknown>,
): RegisteredTool {
	const schema = toZod(definition.inputSchema)
	return {
		definition,
		handler: async(raw) => {
			const args = schema.parse(raw) as TArgs
			return await handler(args)
		},
	}
}

/**
 * Render a tool-handler error as the text every host shows the LLM.
 * Boom errors carrying an RFC 9457 problem include its `detail`; anything
 * else falls back to the plain message.
 */
export function errorAsToolText(err: unknown): string {
	if(isProblemError(err)) {
		const detail = err.data.detail
		// A Builder API error's message is its detail, so lead with the title
		// instead of repeating it. A hand-thrown Boom keeps its own message.
		const lead = err.message === detail ? err.data.title : err.message
		return detail ? `${lead}: ${detail}` : err.message
	}

	if(isBoom(err) && err.output?.statusCode) {
		const detail = isProblemDetails(err.data) ? err.data.detail : undefined
		return detail ? `${err.message}: ${detail}` : err.message
	}

	return err instanceof Error ? err.message : String(err)
}

/**
 * Adapt a tool to a host by WIDENING its input schema — add properties, mark
 * some required, optionally override the description — without touching the
 * handler. A host maps whichever shared tools it needs through this (for
 * example, the MCP adds its `captureId` session handle + the credential-aware
 * `run_proof` contract). Args parse loosely, so the extra fields flow through
 * to the handler (its backend resolver reads them); the base tool stays
 * untouched for hosts that don't need them.
 */
export function extendTool(
	tool: RegisteredTool,
	extra: {
		description?: string
		properties?: JSONSchema.ObjectSchema['properties']
		required?: string[]
	},
): RegisteredTool {
	const base = tool.definition
	const required = [
		...(base.inputSchema.required ?? []),
		...(extra.required ?? []),
	]
	// Keep the merged schema checked against Zod's JSON Schema representation.
	const inputSchema: JSONSchema.ObjectSchema = {
		...base.inputSchema,
		properties: {
			...base.inputSchema.properties,
			...extra.properties,
		},
		...(required.length ? { required } : {}),
	}
	return {
		definition: {
			name: base.name,
			description: extra.description ?? base.description,
			inputSchema,
			...(base.annotations ? { annotations: base.annotations } : {}),
		},
		handler: tool.handler,
	}
}
