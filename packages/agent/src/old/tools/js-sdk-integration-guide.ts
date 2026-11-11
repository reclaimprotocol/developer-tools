import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineTool, type RegisteredTool } from '../../mcp/server.ts'

/**
 * Verified against `@reclaimprotocol/js-sdk` v5.8.1 source
 * (`reclaim-js-sdk/src/Reclaim.ts`) — NOT copied unchecked from the archived
 * `reclaim-mcp-server`'s guide, which predates several of these signatures.
 * The prose lives in `skill/js-sdk-integration.md` so it can be edited as
 * markdown without touching code — same pattern as `provider/injection-doc.ts`.
 * The path resolves the same from `src/old/tools` (dev) and `lib/old/tools`
 * (published): both are three levels below the package root.
 */
const GUIDE = readFileSync(
	fileURLToPath(
		new URL('../../../skill/js-sdk-integration.md', import.meta.url),
	),
	'utf8',
).trim()

export function getJsSdkIntegrationGuideTool(): RegisteredTool {
	return defineTool<Record<string, never>>(
		{
			name: 'get_js_sdk_integration_guide',
			description:
				'Return a verified, copy-pasteable guide for integrating ' +
				'@reclaimprotocol/js-sdk (backend proof request + callback ' +
				'verification), checked against the current SDK source rather than ' +
				'assumed from older docs. Covers testing locally without deploying: ' +
				'the built-in "example" providerId for a quick smoke test, and using ' +
				'ngrok to get a callback URL Reclaim\'s servers can actually reach. ' +
				'Use scaffold_reclaim_demo_server to generate a runnable local demo ' +
				'instead of copy-pasting by hand.',
			inputSchema: { type: 'object', properties: {} },
		},
		async() => ({ guide: GUIDE }),
	)
}
