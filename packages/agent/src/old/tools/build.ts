import type { RegisteredTool } from '../../mcp/server.ts'
import type { AttachState } from '../../mcp/tools/agent/attach.ts'
import type { ReclaimOldClient } from '../client.ts'
import type { ReclaimSdkClient } from '../sdk-client.ts'
import { authenticateTool } from './authenticate.ts'
import { checkAppStatusTool } from './check-app-status.ts'
import { getProviderInfoTool } from './get-provider-info.ts'
import { issueAppCredentialsTool } from './issue-app-credentials.ts'
import { getJsSdkIntegrationGuideTool } from './js-sdk-integration-guide.ts'
import { linkAppTool } from './link-app.ts'
import { getMeProvidersTool } from './me-providers.ts'
import { createVersionFromCaptureTool } from './publish.ts'
import { scaffoldDemoServerTool } from './scaffold-demo-server.ts'
import { sessionAnalyticsLogsTool } from './session-analytics-logs.ts'
import { sessionLogsTool } from './session-logs.ts'
import { updateProviderMetadataTool } from './update-provider-metadata.ts'
import { verifySdkSetupTool } from './verify-sdk-setup.ts'

/**
 * The backend-facing tools for OLD-devtools mode. Mirrors
 * `buildCredentialTools` / `buildAgentTools`: returns a flat `RegisteredTool`
 * list for `registerToolList`. These replace the builder credential + publish
 * tools and the (disabled) generated provider tools.
 *
 * `sdkClient` is a SEPARATE, unauthenticated client for the public
 * production SDK backend (`api.reclaimprotocol.org`) — a different host from
 * `client`'s old-devtools dashboard backend (`devapi.reclaimprotocol.org`).
 *
 * `attachRef` is the SAME attach state `buildAgentTools` was given (see
 * `mcp/start.ts`) — passing it lets the publish tool remind the caller about
 * a still-open browser session after a successful publish.
 */
export function buildOldBackendTools(
	client: ReclaimOldClient,
	sdkClient: ReclaimSdkClient,
	attachRef?: { current?: AttachState },
): RegisteredTool[] {
	return [
		authenticateTool(client),
		createVersionFromCaptureTool(client, attachRef),
		getMeProvidersTool(client),
		getProviderInfoTool(sdkClient),
		updateProviderMetadataTool(client),
		sessionAnalyticsLogsTool(client),
		sessionLogsTool(client),
		issueAppCredentialsTool(client),
		linkAppTool(client),
		checkAppStatusTool(client),
		getJsSdkIntegrationGuideTool(),
		scaffoldDemoServerTool(),
		verifySdkSetupTool(client),
	]
}
