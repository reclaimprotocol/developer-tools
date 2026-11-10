/**
 * Factory entry-point for embedding the reclaim-agent's MCP tools into
 * a host MCP server via `registerToolList` (server.ts) on the high-level
 * `@modelcontextprotocol/sdk` `McpServer`. Folds the agent's tools
 * alongside the auto-generated API tools.
 *
 * Shared state — Chrome attach state + capture store — is built once per
 * server and threaded through every tool factory. Per-capture drafts (and the
 * secrets they hold) live inside each capture entry, so a capture IS the
 * session for the shared authoring tools.
 */

import type { ReclaimClient } from '@reclaimprotocol/client/api'
import { ConfigStore } from '../../../config/store.ts'
import { ensureAttestorCrypto } from '../../../proof/proof-core.ts'
import { type RegisteredTool } from '../../server.ts'
import { analyzeTool } from './analyze.ts'
import { type AttachState, attachTool } from './attach.ts'
import { type CaptureStore, captureTools, resetCaptures } from './capture.ts'
import { checkAttestorTool } from './check-attestor.ts'
import { draftTools } from './draft-tools.ts'
import { listTabsTool } from './eval.ts'
import { exampleAppTool } from './example-app.ts'
import { howItWorksTool } from './how-it-works.ts'
import { liveViewTools } from './live-view.ts'
import { podProofTools } from './pod-proof.ts'
import { createVersionFromCaptureTool } from './publish.ts'
import { resetAll, sessionTools } from './session.ts'
import { sharedAuthoringTools } from './shared.ts'
import { startIntegrationTool } from './start-integration.ts'

export interface AgentState {
	attach: { current?: AttachState, config: ConfigStore }
	captures: CaptureStore
}

/** Exported so a mode (for example, old-devtools) that supplies its own
 *  publish tool can build the attach/capture state up front and share the SAME
 *  instance with `buildAgentTools` — letting that publish tool see the live
 *  attach state (for example, to remind the caller about a still-open browser
 *  session). */
export function buildAgentState(): AgentState {
	return {
		attach: { config: new ConfigStore() },
		captures: { sessions: new Map() },
	}
}

/** Build the flat list of `RegisteredTool` entries, ready for
 *  `registerToolList`.
 *  Pass `client` to include the builder `create_provider_version_from_capture`;
 *  omit it (for example, OLD-devtools mode) to register only the
 *  backend-independent capture/proof tools — old mode supplies its own publish
 *  tool. Pass `externalState` to share attach/capture state with tools
 *  registered elsewhere (for example, old mode's publish tool) instead of
 *  building a fresh one. */
export function buildAgentTools(
	client?: ReclaimClient,
	builderClient: ReclaimClient | undefined = client,
	externalState?: AgentState,
): RegisteredTool[] {
	const state = externalState ?? buildAgentState()
	ensureAttestorCrypto()
	const tools: RegisteredTool[] = []
	// Stateless docs tool — serve the mode-specific authoring guide to any
	// client. No `client` ⇒ old-devtools mode (see `mcp/start.ts`).
	tools.push(howItWorksTool(!client))
	const beforeReplace = () => resetCaptures(state.captures)
	tools.push(attachTool(state.attach, builderClient, beforeReplace))
	tools.push(listTabsTool(state.attach))
	for(const t of captureTools(state.attach, state.captures)) {
		tools.push(t)
	}

	for(const t of sessionTools(state.attach, state.captures)) {
		tools.push(t)
	}

	// Local-CDP only: a builder-mode browser already has a hosted live view.
	for(const t of liveViewTools(state.attach)) {
		tools.push(t)
	}

	for(const t of podProofTools(state.attach, state.captures)) {
		tools.push(t)
	}

	tools.push(analyzeTool(state.captures))
	tools.push(checkAttestorTool())
	// navigate / eval_in_page / wait_for_page / get_cookies / list_requests /
	// find_requests_containing / propose_provider / replay_request / run_proof —
	// shared with the cloud loop, bound to each capture's local backend.
	for(const t of sharedAuthoringTools(state.captures)) {
		tools.push(t)
	}

	// check_matchers / update_draft: offline matcher check + in-place draft
	// edits, keyed by captureId like run_proof_via_pod.
	for(const t of draftTools(state.captures)) {
		tools.push(t)
	}

	if(client) {
		tools.push(startIntegrationTool())
		tools.push(exampleAppTool())
		tools.push(createVersionFromCaptureTool(
			client, state.attach, state.captures,
		))
	}

	return tools
}

/**
 * Tear down an agent state on the way out. Safe to call more than once, and
 * safe when nothing was ever attached.
 */
export async function disposeAgentState(state: AgentState): Promise<void> {
	await resetAll(state.attach, state.captures)
}
