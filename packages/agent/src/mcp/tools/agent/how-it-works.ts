import { guideFor } from '../../instructions.ts'
import { defineTool, type RegisteredTool } from '../../server.ts'

/**
 * Serve one mode-specific guide topic without loading the full guide (~7k
 * tokens) — paying that cost to answer one question would crowd out the
 * actual task. Every response includes the topic index, so a caller that
 * guessed the topic name wrong still learns what else exists in the same
 * round-trip.
 */
export function howItWorksTool(oldMode: boolean): RegisteredTool {
	const guide = guideFor(oldMode)
	const names = [...guide.topics.keys()]

	return defineTool<{ topic?: string }>(
		{
			name: 'how_it_works',
			description:
				'Returns topic-specific provider-authoring guidance for the active '
				+ 'backend. Call without a topic for the overview and index. Before an '
				+ 'unfamiliar or sensitive step, request that topic. Prefer one topic; '
				+ '`all` returns the much larger complete guide.',
			annotations: { readOnlyHint: true, openWorldHint: false },
			inputSchema: {
				type: 'object',
				properties: {
					topic: {
						type: 'string',
						// Deliberately NOT an `enum`: schema validation runs before the
						// handler, so an enum turns a mistyped topic into a validation
						// error instead of a response carrying the real topic list. A
						// plain string lets the tool answer the mistake usefully.
						description:
							'Which section to return: ' + names.join(', ')
							+ ', or `all`. Omit for the overview + topic index. An '
							+ 'unrecognized value comes back with the list, not an error.',
					},
				},
			},
		},
		async({ topic }) => {
			if(topic === 'all') {
				return { topic: 'all', topics: guide.index, guide: guide.full }
			}

			const requested = topic ?? 'overview'
			const section = guide.topics.get(requested)
			if(!section) {
				// Not an error: hand back the index so the caller self-corrects in
				// the same turn rather than retrying blind.
				return {
					error: `Unknown topic "${requested}".`,
					topics: guide.index,
					guide: guide.topics.get('overview'),
				}
			}

			return { topic: requested, topics: guide.index, guide: section }
		},
	)
}
