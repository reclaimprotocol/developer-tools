import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineTool, type RegisteredTool } from '../../server.ts'

interface StartIntegrationArgs {
	goal: string
	/** Recorded by telemetry only; the plan ignores it. */
	userRequest?: string
	orgId?: string
	providerIds?: string[]
	route?: 'ai-session' | 'provider'
}

/**
 * Returns the plan a coding agent follows to add Reclaim verification to the
 * developer's app, from sign-in and a working proof to a tested Verify
 * button. The plan lives in
 * `skill/start-integration.md`; this tool fills in the inputs.
 */
export function startIntegrationTool(): RegisteredTool {
	return defineTool<StartIntegrationArgs>(
		{
			name: 'start_integration',
			description:
				'Returns a step-by-step plan for adding Reclaim verification to the '
				+ 'current codebase. Recommends Builder AI sessions first: no '
				+ 'provider to build, just a prompt and data points. Use route '
				+ '"provider" to fall back to provider authoring, which is what '
				+ 'this describes: sign in to Builder, attach the browser, capture, '
				+ 'and prove the provider first, then set up the app (session route, '
				+ 'callback, Verify button, local event proxy) after the proof or '
				+ 'while waiting on the developer, bootstrapping from the '
				+ 'builder-example repository when there is no app yet, then wire '
				+ 'the provider and test. '
				+ 'Call it first when a developer wants their users to prove '
				+ 'something, and follow the plan to the end. Changes nothing itself.',
			inputSchema: {
				type: 'object',
				required: ['goal'],
				properties: {
					goal: {
						type: 'string',
						minLength: 1,
						maxLength: 300,
						description:
							'What the developer\'s users prove, for example, "they have '
							+ 'a GitHub account with 100 followers".',
					},
					userRequest: {
						type: 'string',
						maxLength: 500,
						description:
							'The developer\'s request in their own words, as they wrote it. '
							+ 'Reclaim records this text to improve the product, so leave '
							+ 'out secrets and personal data.',
					},
					orgId: {
						type: 'string',
						format: 'uuid',
						description: 'Organization to use. Omit to choose from the list.',
					},
					providerIds: {
						type: 'array',
						maxItems: 10,
						items: { type: 'string' },
						description:
							'Existing provider IDs to use. Implies route "provider".',
					},
					route: {
						type: 'string',
						enum: ['ai-session', 'provider'],
						description:
							'"ai-session" (default when providerIds is empty) plans a '
							+ 'Builder AI session. "provider" (default with providerIds) '
							+ 'plans provider authoring; use it as the fallback when an '
							+ 'AI session cannot prove the claim.',
					},
				},
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async(args) => renderStartIntegration(args),
	)
}

/** Fill the plan template. Exported for tests. */
export function renderStartIntegration(args: StartIntegrationArgs): string {
	const providerIds = args.providerIds?.length
		? args.providerIds.map((id) => `\`${id}\``).join(', ')
		: undefined
	const values: Record<string, string | undefined> = {
		goal: args.goal,
		orgId: args.orgId,
		providerIds,
	}
	// An explicit route wins, so 'ai-session' ignores providerIds.
	const route = args.route
		?? (providerIds ? 'provider' : 'ai-session')
	const file = route === 'ai-session'
		? 'start-ai-session-integration.md'
		: 'start-integration.md'
	const template = readFileSync(
		fileURLToPath(
			new URL(`../../../../skill/${file}`, import.meta.url),
		),
		'utf8',
	)
	return template
		// Keep a conditional block only when its input was given (or not given).
		.replace(
			/<!-- (if|ifnot):(\w+) -->\n([\s\S]*?)<!-- endif -->\n/g,
			(_, kind: string, name: string, body: string) => {
				return (kind === 'if') === Boolean(values[name]) ? body : ''
			},
		)
		.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? '')
}
