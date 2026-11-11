import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { startToolCall } from '../telemetry/index.ts'
import { type RegisteredTool } from '../tools/registry.ts'
import { toZod } from './api/to-zod.ts'
import { remapErrorAsResponse } from './remap_errors.ts'
import { successResponse } from './success-response.ts'

// The tool primitive lives in `../tools/registry.ts` (SDK-free, so the cloud
// loop can use it too). Re-exported here so the MCP-side tool files can keep
// importing `defineTool`/`RegisteredTool` from the server module.
export {
	defineTool,
	type RegisteredTool,
	type ToolAnnotations,
	type ToolDefinition,
} from '../tools/registry.ts'

/**
 * Registers a list of RegisteredTool entries on a high-level McpServer.
 * Converts JSON Schema definitions to Zod and provides consistent
 * stringification and error catching for tool execution.
 */
export function registerToolList(server: McpServer, tools: RegisteredTool[]) {
	for(const tool of tools) {
		server.registerTool(
			tool.definition.name,
			{
				description: tool.definition.description,
				inputSchema: toZod(tool.definition.inputSchema),
				...(tool.definition.annotations
					? { annotations: tool.definition.annotations }
					: {}),
			},
			async(args) => {
				const call = startToolCall(tool.definition.name, args)
				try {
					const result = successResponse(await tool.handler(args))
					call.end()
					return result
				} catch(err) {
					call.end(err)
					return remapErrorAsResponse(err)
				}
			},
		)
	}
}
