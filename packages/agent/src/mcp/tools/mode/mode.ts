import type { ConfigStore, DevtoolsMode } from '../../../config/store.ts'
import { defaultConfigPath } from '../../../config/store.ts'
import { oldModeSource } from '../../../consts.ts'
import { defineTool, type RegisteredTool } from '../../server.ts'

/** Whether `config`'s cached builder session token is present and either
 *  not yet expired or refreshable. Mirrors `readSession`'s check, but against
 *  the CALLER's `ConfigStore` instance (not always the default
 *  `~/.reclaim/config.json` path) so this stays test-isolatable and
 *  consistent with the rest of this tool's config reads. */
function hasValidBuilderSession(config: ConfigStore): boolean {
	const session = config.read()?.session
	if(!session?.token || !session.expiresAt) {
		return false
	}

	return !!session.refreshToken || new Date(session.expiresAt) > new Date()
}

/**
 * The `set_devtools_mode` / `get_devtools_mode` tools: persist which backend
 * the MCP server targets (`old` devtools vs the `builder`), and
 * report the mode currently in effect. The choice is written to
 * `~/.reclaim/config.json` and applied the NEXT time the server starts —
 * the registered tool set, server instructions, and backend client are all
 * fixed at connect time, so the switch requires a restart/reconnect. Follows
 * the `attach_browser` persist-through-config pattern.
 *
 * Registered in BOTH modes (so the user can switch either direction) and
 * outside `buildAgentTools` (so it survives `RECLAIM_AGENT_DISABLED=1`). An
 * explicit `USE_OLD_DEVTOOLS` env var still overrides the persisted value —
 * see `resolveOldMode` in consts.ts.
 */
export function buildModeTools(
	config: ConfigStore,
	currentOldMode: boolean,
): RegisteredTool[] {
	const current: DevtoolsMode = currentOldMode ? 'old' : 'builder'
	return [
		defineTool<{ mode: DevtoolsMode }>(
			{
				name: 'set_devtools_mode',
				description:
					'Choose which backend the MCP server targets: "old" (devtools) '
					+ 'or "builder" (the builder backend). '
					+ 'Persists the choice to ~/.reclaim/config.json; it takes effect '
					+ 'the next time the MCP server starts, so restart/reconnect after '
					+ 'switching. An explicit USE_OLD_DEVTOOLS env var overrides this.',
				inputSchema: {
					type: 'object',
					properties: {
						mode: { type: 'string', enum: ['old', 'builder'] },
					},
					required: ['mode'],
				},
				annotations: { openWorldHint: false, idempotentHint: true },
			},
			async(parsed) => {
				config.write({ mode: parsed.mode })
				const restartRequired = parsed.mode !== current
				return {
					saved: true,
					mode: parsed.mode,
					effectiveNow: current,
					restartRequired,
					configPath: defaultConfigPath(),
					message: restartRequired
						? 'Saved. Restart / reconnect the MCP server for '
							+ `"${parsed.mode}" mode to take effect.`
						: `Already running in "${parsed.mode}" mode; nothing to restart.`,
				}
			},
		),
		defineTool<Record<string, never>>(
			{
				name: 'get_devtools_mode',
				description:
					'Report which backend this server targets ("old" devtools or '
					+ '"builder"), WHY (a USE_OLD_DEVTOOLS env override, the persisted '
					+ 'config, or the default), and which mode is persisted for the '
					+ 'next start. Change it with set_devtools_mode. Also reports auth '
					+ 'status for both login systems: builderAuthenticated and '
					+ 'oldDevtoolsAuthenticated. Both are PRESENCE checks, not validity '
					+ 'checks — a stale token still reports true; a real call surfaces '
					+ 'the staleness with an error naming the tool to re-run. Which '
					+ 'login authorizes what: how_it_works({ topic: "auth" }).',
				inputSchema: { type: 'object', properties: {} },
				annotations: { readOnlyHint: true, openWorldHint: false },
			},
			async() => {
				const persisted = config.read()?.mode
				const oldIdentity = config.read()?.old_devtools
				return {
					mode: current,
					source: oldModeSource(persisted),
					persistedMode: persisted ?? null,
					configPath: defaultConfigPath(),
					builderAuthenticated: hasValidBuilderSession(config),
					oldDevtoolsAuthenticated: !!oldIdentity,
					oldDevtoolsIdentityKind: oldIdentity?.kind ?? null,
				}
			},
		),
	]
}
