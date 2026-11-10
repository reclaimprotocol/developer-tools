import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ReclaimClient } from '@reclaimprotocol/client/api'
import { ConfigStore } from '../config/store.ts'
import {
	agentDisabled,
	apiToken,
	apiUrl,
	oldApiUrl,
	oldLogsUrl,
	resolveOldMode,
	sdkApiUrl,
	telemetryEnabled,
} from '../consts.ts'
import { LOGGER } from '../logger.ts'
import { ReclaimOldClient } from '../old/client.ts'
import { resolveInitialIdentity } from '../old/identity.ts'
import { OLD_MODE_INSTRUCTIONS } from '../old/instructions.ts'
import { ReclaimSdkClient } from '../old/sdk-client.ts'
import { buildOldBackendTools } from '../old/tools/build.ts'
import { NAME, VERSION } from '../pkg.ts'
import { startZkFilesDownload } from '../proof/zk-files.ts'
import {
	currentTelemetry,
	installTelemetry,
	Telemetry
} from '../telemetry/index.ts'
import { registerTools } from './api/tools.ts'
import {
	type AgentState,
	buildAgentState,
	buildAgentTools,
	buildBuilderAuthenticationTools,
	buildBuilderOrganizationTools,
	buildCredentialTools,
	buildLocalCredentialTools,
	buildModeTools,
	buildVerificationTools,
	disposeAgentState,
	readSession,
	releaseAllListeners,
	sessionRefreshingFetch,
	stopAllForwarders,
} from './tools/index.ts'
import { BUILDER_MODE_INSTRUCTIONS } from './instructions.ts'
import { registerToolList } from './server.ts'

export async function startMcpServer() {
	// Mode precedence: explicit env → persisted config → builder.
	// The same store instance backs the set_devtools_mode toggle below.
	const config = new ConfigStore()
	const oldMode = resolveOldMode(config.read()?.mode)

	const server = new McpServer(
		{ name: NAME, version: VERSION },
		{
			instructions: oldMode
				? OLD_MODE_INSTRUCTIONS
				: BUILDER_MODE_INSTRUCTIONS,
		},
	)

	// Agent tools (Chrome CDP capture, provider synthesis, replay, proof) are
	// backend-independent and registered in both modes. Skipped in hosted
	// deployments — set RECLAIM_AGENT_DISABLED=1 to register only the API
	// surface.
	const agentToolsEnabled = !agentDisabled()
	/** The agent state this server registered, for shutdown to release. */
	let agentState: AgentState | undefined
	const envToken = apiToken()
	const builderClient = new ReclaimClient({
		baseUrl: apiUrl(),
		// Builder access is orthogonal to publishing mode. A legacy-devtools
		// session can authenticate here solely to allocate a remote browser.
		token: envToken || readSession()?.token,
		// The cached sign-in refreshes itself; an explicit RECLAIM_API_TOKEN
		// takes precedence and is sent as is.
		...(envToken
			? {}
			: {
				fetch: sessionRefreshingFetch(
					oldMode ? 'authenticate_builder' : 'reclaim_authenticate',
				),
			}),
		headers: { 'User-Agent': `${NAME}/${VERSION}` },
	})
	// Anonymous usage data. Installed before any tool registers so every tool
	// call is covered. When the developer opts out, nothing is created.
	const mode = oldMode ? 'devtools' : 'builder'
	if(telemetryEnabled()) {
		installTelemetry(new Telemetry({ client: builderClient, mode }))
	}

	// Backend-mode toggle — available in both modes and regardless of whether
	// the agent tools are enabled, so a user can always switch either direction.
	registerToolList(server, buildModeTools(config, oldMode))

	if(oldMode) {
		// Explicit OLD-devtools mode. All auto-generated builder tools
		// are disabled; a small ReclaimOldClient serves authenticate / publish /
		// get_me_providers instead.
		const oldClient = new ReclaimOldClient({
			baseUrl: oldApiUrl(),
			logsBaseUrl: oldLogsUrl(),
			identity: resolveInitialIdentity(),
		})
		const sdkClient = new ReclaimSdkClient({ baseUrl: sdkApiUrl() })
		// Shared with buildAgentTools below so the old-mode publish tool can see
		// the live attach state (for example, to flag a still-open browser
		// session).
		agentState = buildAgentState()

		registerToolList(server, buildBuilderAuthenticationTools(builderClient))
		registerToolList(server, buildBuilderOrganizationTools(builderClient))
		registerToolList(server, buildLocalCredentialTools())
		registerToolList(
			server,
			buildOldBackendTools(oldClient, sdkClient, agentState.attach),
		)
		if(agentToolsEnabled) {
			// No builder client → no builder publish tool (old mode has its own).
			registerToolList(
				server,
				buildAgentTools(undefined, builderClient, agentState),
			)
		}
		// NOTE: registerTools() is intentionally NOT called — generated tools off.
	} else {
		const client = builderClient

		// Tool names must stay disjoint across these three groups: hand-written
		// tools are higher-level orchestrations (multi-call flows, ReclaimProvider
		// translation) and must NOT reuse a generated operation's snake_case name.
		// A clash throws at startup on purpose — it surfaces an accidental
		// collision instead of one tool silently shadowing the other.

		// Register credential tools for ETH credential management.
		registerToolList(server, buildCredentialTools(client))

		// Higher-level verification orchestrations (for example, fetch + decrypt
		// result). Authenticates with RECLAIM_ORG_SECRET, not the session client.
		registerToolList(server, buildVerificationTools())

		// Add auto-generated tools with snake_case wrappers
		// for every MCP-tagged operation.
		// Org-key-only operations go out with the call's `orgToken` instead.
		registerTools(server, client, (orgToken) => new ReclaimClient({
			baseUrl: apiUrl(),
			token: orgToken,
			headers: { 'User-Agent': `${NAME}/${VERSION}` },
		}))

		if(agentToolsEnabled) {
			agentState = buildAgentState()
			registerToolList(server, buildAgentTools(client, client, agentState))
		}
	}

	// Anything the session holds has to be released when the session ends, and
	// the session can end without a single tool call: the developer closes their
	// agent, the client kills the server, stdin drops. Nothing ran here before,
	// which left a container up after the session that made it was gone.
	if(agentToolsEnabled || !oldMode) {
		installShutdownHooks(() => agentState)
	}

	// The client's name and version arrive in the `initialize` handshake, so
	// the session starts only after it completes.
	server.server.oninitialized = () => {
		const telemetry = currentTelemetry()
		telemetry?.setAgent(server.server.getClientVersion())
		telemetry?.track('session_start', {
			mode,
			agentTools: agentToolsEnabled,
			os: knownOs(process.platform),
			nodeVersion: process.versions.node,
		})
	}

	const transport = new StdioServerTransport()
	await server.connect(transport)

	// Fetch the proof files in the background so the first proof doesn't wait
	// for them. Progress goes to stderr; `check_attestor` reports the state,
	// and every proof still awaits the same download.
	if(agentToolsEnabled) {
		startZkFilesDownload()
	}
}

/** How long teardown gets before the process leaves anyway. */
const SHUTDOWN_GRACE_MS = 10_000

/**
 * Release the browser on every way out we can observe.
 *
 * `SIGTERM`/`SIGINT` is how a client stops us; stdin ending is how a stdio
 * transport says the other side is gone. A `SIGKILL` cannot be caught at all,
 * which is why `reapOrphanedContainers` exists as the backstop.
 */
function installShutdownHooks(state: () => AgentState | undefined): void {
	let shuttingDown = false
	const shutdown = (reason: string) => {
		if(shuttingDown) {
			return
		}

		shuttingDown = true
		const current = state()
		LOGGER.info({ reason }, 'releasing resources before exit')
		// Bounded: a wedged `docker stop` must not keep the process alive, but
		// nor should we skip cleanup that would have finished in a second.
		const timer = setTimeout(() => {
			LOGGER.warn({ reason }, 'teardown timed out; exiting anyway')
			process.exit(0)
		}, SHUTDOWN_GRACE_MS)
		timer.unref()
		void Promise.all([
			stopAllForwarders(),
			releaseAllListeners(),
			currentTelemetry()?.close(),
			current && disposeAgentState(current),
		])
			.catch((err: unknown) => {
				LOGGER.warn({ err }, 'teardown failed')
			})
			.finally(() => {
				clearTimeout(timer)
				process.exit(0)
			})
	}

	process.once('SIGTERM', () => shutdown('SIGTERM'))
	process.once('SIGINT', () => shutdown('SIGINT'))
	// The transport's own end of the conversation.
	process.stdin.once('end', () => shutdown('stdin ended'))
	process.stdin.once('close', () => shutdown('stdin closed'))
}

/** Maps the platform to the values the analytics API accepts. */
function knownOs(platform: NodeJS.Platform) {
	return platform === 'darwin' || platform === 'linux' || platform === 'win32'
		? platform
		: 'other'
}
