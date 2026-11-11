import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	BUILDER_MODE_INSTRUCTIONS,
	GUIDE_BUILDER,
	GUIDE_OLD,
	OLD_MODE_INSTRUCTIONS,
} from '../src/mcp/instructions.ts'
import { howItWorksTool } from '../src/mcp/tools/agent/how-it-works.ts'

interface Result {
	topic?: string
	guide?: string
	error?: string
	topics?: Array<{ topic: string, summary: string }>
}

describe('how_it_works', () => {
	it('advertises its topics through the input and every response',
		async() => {
			for(const oldMode of [false, true]) {
				const tool = howItWorksTool(oldMode)
				const guide = oldMode ? GUIDE_OLD : GUIDE_BUILDER
				const schema = tool.definition.inputSchema
				assert(schema && typeof schema === 'object')
				assert(schema.properties)
				const topicSchema = schema.properties.topic
				assert(topicSchema && typeof topicSchema === 'object')
				const topicDescription = topicSchema.description ?? ''

				for(const topic of guide.topics.keys()) {
					assert.ok(
						topicDescription.includes(topic),
						`${topic} missing from the topic parameter description`,
					)
				}

				assert.ok(tool.definition.description.length < 500)

				// Every response carries the index, so a caller that guessed a
				// topic wrong learns the real list without another round-trip.
				for(const args of [{}, { topic: 'draft' }, { topic: 'nope' }]) {
					const result = await tool.handler(args) as Result
					assert.deepEqual(
						result.topics?.map((entry) => entry.topic),
						[...guide.topics.keys()],
					)
				}
			}
		})

	it('defaults to the overview and falls back rather than throwing',
		async() => {
			const tool = howItWorksTool(false)
			const overview = await tool.handler({}) as Result
			assert.equal(overview.topic, 'overview')
			assert.equal(overview.guide, GUIDE_BUILDER.topics.get('overview'))

			const unknown = await tool.handler({ topic: 'nope' }) as Result
			assert.match(unknown.error!, /Unknown topic "nope"/)
			assert.equal(unknown.guide, GUIDE_BUILDER.topics.get('overview'))
		})

	it('serves one topic, far smaller than the whole guide', async() => {
		const tool = howItWorksTool(false)
		const one = await tool.handler({ topic: 'params' }) as Result
		const all = await tool.handler({ topic: 'all' }) as Result

		assert.equal(one.guide, GUIDE_BUILDER.topics.get('params'))
		assert.equal(all.guide, GUIDE_BUILDER.full)
		// The whole point of the split: a single answer must not cost the guide.
		assert.ok(one.guide!.length * 4 < all.guide.length)
	})

	it('resolves every common section and mode token', () => {
		for(const guide of [GUIDE_BUILDER, GUIDE_OLD]) {
			for(const [topic, body] of guide.topics) {
				assert.ok(
					!body.includes('%CTX%'),
					`${topic}: unexpanded %CTX% token`,
				)
				assert.ok(
					!body.includes('<!-- common:'),
					`${topic}: unspliced common section`,
				)
			}
		}

		// The namespace differs per backend and is the reason the token exists.
		assert.match(GUIDE_BUILDER.topics.get('params')!, /\{\{context\.<name>\}\}/)
		assert.match(GUIDE_OLD.topics.get('params')!, /\{\{context_<name>\}\}/)
	})

	it('only offers topics the mode actually has', () => {
		// discover_* tools are builder-only; old-devtools must not be told to
		// call them.
		assert.ok(GUIDE_BUILDER.topics.has('discover'))
		assert.ok(!GUIDE_OLD.topics.has('discover'))
	})

	it('tells the agent to prove first and to ask by ending its turn', () => {
		assert.match(BUILDER_MODE_INSTRUCTIONS, /after the proof works/)
		for(const text of [
			BUILDER_MODE_INSTRUCTIONS,
			GUIDE_BUILDER.topics.get('integration')!,
		]) {
			assert.match(text, /end your turn with the question/)
			assert.match(text, /background or asynchronous question tool/)
		}

		assert.match(
			GUIDE_BUILDER.topics.get('integration')!,
			/prove the provider/i,
		)

		assert.match(OLD_MODE_INSTRUCTIONS, /end your turn/)
		// The hosted page is a video stream: its text is always empty.
		assert.match(
			GUIDE_BUILDER.topics.get('integration')!,
			/streams the target site as an image[\s\S]*`list_verification_events`/,
		)
	})

	it('keeps served instructions under Claude Code\'s 4,096-character cap',
		() => {
			// Claude Code truncates MCP server instructions at 4,096 characters,
			// so anything later is silently lost. Keep headroom and move detail
			// into how_it_works topics.
			for(const [name, text] of Object.entries({
				BUILDER_MODE_INSTRUCTIONS,
				OLD_MODE_INSTRUCTIONS,
			})) {
				assert.ok(
					text.length <= 4000,
					`${name} is ${text.length} characters; Claude Code cuts MCP `
					+ 'server instructions at 4,096. Move detail into a topic.',
				)
			}
		})

	it('keeps moved rules reachable in their topics', () => {
		const builder = (topic: string) => GUIDE_BUILDER.topics.get(topic)!
		assert.match(builder('integration'), /Try a provider without an app/)
		assert.match(builder('integration'), /`replace: true`/)
		assert.match(builder('integration'), /USE_OLD_DEVTOOLS/)
		assert.match(builder('discover'), /create_provider_version/)
		assert.match(builder('prove'), /geoLocation: "US"/)
		// A persistent 403 on replay/proof must end in a published, unproven
		// version the developer tries for real, not an endless retry loop.
		for(const guide of [GUIDE_BUILDER, GUIDE_OLD]) {
			assert.match(guide.topics.get('prove')!, /publish from\s+the capture/i)
			assert.match(guide.topics.get('prove')!, /STOP\. Don't re-capture/)
			assert.match(guide.topics.get('overview')!, /blocked with 403/)
			assert.match(guide.topics.get('never-do')!, /Never loop a blocked replay/)
		}

		for(const text of [BUILDER_MODE_INSTRUCTIONS, OLD_MODE_INSTRUCTIONS]) {
			assert.match(text, /403[\s\S]*not a reason to keep retrying/)
		}

		assert.match(builder('ai-sessions'), /create_ai_verification_session/)
		assert.match(builder('ai-sessions'), /wait_for_ai_session/)
		assert.match(builder('ai-sessions'), /Fall back to a provider/)
		assert.match(BUILDER_MODE_INSTRUCTIONS, /AI sessions first/)
		assert.match(BUILDER_MODE_INSTRUCTIONS, /topic `zkfetch`/)
		assert.match(builder('zkfetch'), /new ReclaimClient\(\{ orgToken/)
		assert.match(builder('zkfetch'), /verifyRequestProof/)
		assert.match(builder('zkfetch'), /trusts the attestors in Builder's JWKS/)
		assert.match(builder('auth'), /set_devtools_mode/)
		assert.match(GUIDE_OLD.topics.get('auth')!, /set_devtools_mode/)
		assert.match(
			GUIDE_OLD.topics.get('publish')!,
			/scaffold_reclaim_demo_server/,
		)
	})

	it('serves the complete Builder contribution workflow', async() => {
		const result = await howItWorksTool(false).handler({
			topic: 'contributions',
		}) as Result

		assert.match(result.guide!, /## Contents/)
		assert.match(result.guide!, /## Generalization gates/)
		assert.match(result.guide!, /## Stop conditions/)
		assert.doesNotMatch(
			result.guide!,
			/read\s+\[community-contributions\.md\]/i,
		)
	})

	it('serves the bug-report topic on both backends', async() => {
		for(const oldMode of [false, true]) {
			const result = await howItWorksTool(oldMode).handler({
				topic: 'report-bug',
			}) as Result

			assert.match(result.guide!, /gh issue list -R reclaimprotocol/)
			assert.match(result.guide!, /## Workaround/)
		}
	})
})
