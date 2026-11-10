/**
 * `replay_request` — validate a drafted recipe before proving: confirm its
 * selectors extract the target(s), and (with `withoutSecrets`) that the
 * endpoint is auth-bound. Authored once as a plain {@link RegisteredTool}; the
 * backend does the actual replay (MCP re-runs locally, cloud re-issues in the
 * TEE pod).
 */
import { objectSchema, type ResolveBackend } from '../../../authoring/util.ts'
import { defineTool, type RegisteredTool } from '../../../tools/registry.ts'

export function replayTool(resolveBackend: ResolveBackend): RegisteredTool {
	return defineTool<Record<string, unknown>>(
		{
			name: 'replay_request',
			description:
				'Re-sends the drafted request from inside the attached authoring '
				+ 'browser (not from this machine) and checks that its selectors '
				+ 'extract the target data points. Captured secrets stay server-side '
				+ 'and are not returned. Returns diagnostics. Run it before '
				+ '`run_proof`. With `withoutSecrets: true`, sends the request with '
				+ 'no cookies or auth headers, like an anonymous visitor. If the '
				+ 'values still extract (`valid: true`), the endpoint is public and '
				+ 'the proof would not bind to the user: choose an auth-bound '
				+ 'request instead. A 403 that survives one retry and one '
				+ 'correction is a site defense, not a recipe bug: stop retrying '
				+ 'and publish from the capture (how_it_works({ topic: "prove" })).',
			inputSchema: objectSchema(
				{
					draftId: { type: 'string' },
					withoutSecrets: { type: 'boolean' },
				},
				['draftId'],
			),
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		async(args) => {
			const backend = resolveBackend(args)
			const draft = backend.drafts.get(String(args.draftId))
			if(!draft) {
				throw new Error(`no draft ${String(args.draftId)}`)
			}

			return backend.replay(draft, {
				withoutSecrets: Boolean(args.withoutSecrets),
			})
		},
	)
}
