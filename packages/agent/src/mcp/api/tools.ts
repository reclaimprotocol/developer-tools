import { unauthorized } from '@hapi/boom'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ReclaimClient } from '@reclaimprotocol/client/api'
import type {
	IOperationArgs,
	IOperationId
} from '@reclaimprotocol/client/openapi'
import assert from 'node:assert'
import { orgSecret } from '../../consts.ts'
import { startToolCall } from '../../telemetry/index.ts'
import { remapErrorAsResponse } from '../remap_errors.ts'
import { successResponse } from '../success-response.ts'
import { savedOrgKey } from '../tools/authenticate/org-key-store.ts'
import { MCP_TOOLS } from './operations.gen.ts'

/**
 * The generated `MCP_TOOLS` are keyed by OpenAPI `operationId` (PascalCase,
 * For example, `GetMe`). MCP tools are conventionally snake_case, matching the
 * hand-written tools in this server. Convert the public tool name here while
 * still dispatching to the API with the original operationId — doing this in
 * the (non-generated) registration keeps it from being reverted on regen.
 */
function toSnakeCase(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
		.toLowerCase()
}

/** The client for a call that presents the organization's API key. */
export type OrgClientFactory = (orgToken: string) => ReclaimClient

/**
 * Register a tool per generated operation. Calls go out with the developer's
 * session token, except operations only an org API key (`rorg_…`) authorizes:
 * those take an `orgToken` input (else the server's RECLAIM_ORG_SECRET) and go
 * out through `orgClient` with that key.
 */
export function registerTools(
	server: McpServer,
	client: ReclaimClient,
	orgClient: OrgClientFactory = (orgToken) => new ReclaimClient({
		baseUrl: client.baseUrl,
		token: orgToken,
	}),
) {
	for(const [opId, tool] of Object.entries(MCP_TOOLS)) {
		const orgTokenOnly = 'orgTokenOnly' in tool && tool.orgTokenOnly === true
		const shape = {
			description: tool.description,
			inputSchema: tool.inputSchema,
			// Generated entries gain `annotations` when the spec marks them; read
			// it defensively so an older generated file still registers.
			...('annotations' in tool && tool.annotations
				? { annotations: tool.annotations }
				: {}),
		}
		if(!isOperationId(opId)) {
			throw new Error(
				`Generated MCP operation is not in the API client: ${opId}`,
			)
		}

		// snake_case to match the hand-written tools. A name that collides with
		// a hand-written tool throws here at startup — intentional: hand-written
		// and generated names must stay disjoint (see start.ts), so a clash is a
		// bug to surface, not silently shadow.
		server.registerTool(
			toSnakeCase(opId),
			shape,
			async(input: unknown) => {
				const call = startToolCall(toSnakeCase(opId), input)
				try {
					if(!isRecord(input)) {
						throw new Error(`Invalid generated MCP arguments for ${opId}`)
					}

					const { orgToken, ...args } = input
					if(!isOperationArgs(opId, args)) {
						throw new Error(`Invalid generated MCP arguments for ${opId}`)
					}

					const caller = orgTokenOnly
						? orgClient(orgTokenFor(toSnakeCase(opId), orgToken, args))
						: client
					const result = await caller.call(
						opId,
						args,
					)
					call.end()
					return successResponse(result.data)
				} catch(err) {
					call.end(err)
					return remapErrorAsResponse(err)
				}
			},
		)
	}
}

/**
 * Always true in practice — `value` comes from `Object.entries(MCP_TOOLS)`
 * itself — but the check still earns its keep: it narrows `opId` to
 * `IOperationId` for `client.call` below without an unchecked cast, and it
 * turns "the generator and the API client drifted apart" into a startup
 * error instead of a silent `as`.
 */
function isOperationId(value: string): value is IOperationId {
	return value in MCP_TOOLS
}

/**
 * The MCP SDK parses `args` through the generated Zod schema before invoking
 * this callback. Keep a runtime object check at this TypeScript boundary so
 * generated operation arguments retain their operation-specific type without
 * an unchecked cast.
 */
function isOperationArgs<T extends IOperationId>(
	_operationId: T,
	value: unknown,
): value is IOperationArgs<T> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The org API key a call authenticates with: its `orgToken`, else the
 *  server's RECLAIM_ORG_SECRET, else the key `issue_org_token` saved (for the
 *  call's `orgId` when it has one, otherwise the most recent). The session
 *  token (the developer's sign-in) can't stand in, since these routes accept
 *  only an org key. */
function orgTokenFor(tool: string, orgToken: unknown, args: unknown) {
	const orgId = isRecord(args) && isRecord(args.params)
		? args.params.orgId
		: undefined
	const token = (typeof orgToken === 'string' && orgToken)
		|| orgSecret()
		|| savedOrgKey(typeof orgId === 'string' ? orgId : undefined)
	assert(
		token,
		unauthorized(
			`${tool} authenticates with the organization's API key. Run `
			+ 'issue_org_token to save one, or pass orgToken, or set '
			+ 'RECLAIM_ORG_SECRET for the MCP server.',
		),
	)
	return token
}
