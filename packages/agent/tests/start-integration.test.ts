import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	renderStartIntegration,
	startIntegrationTool,
} from '../src/mcp/tools/agent/start-integration.ts'

const ORG = '11111111-1111-4111-8111-111111111111'

describe('start_integration', () => {
	it('is read-only and requires a goal', async() => {
		const tool = startIntegrationTool()
		assert.equal(tool.definition.annotations?.readOnlyHint, true)
		await assert.rejects(tool.handler({}))
		await assert.rejects(tool.handler({ goal: '' }))
		await assert.rejects(tool.handler({ goal: 'x'.repeat(301) }))
	})

	it('builds a new provider and asks for the org when none are given',
		() => {
			const plan = renderStartIntegration({
				goal: 'I own 100 followers',
				route: 'provider',
			})
			assert.match(plan, /exactly "I own 100 followers"/)
			assert.match(plan, /`list_orgs`/)
			assert.match(plan, /test_user_script` and `keep: true`/)
			assert.match(plan, /issue_org_token/)
			assert.match(plan, /results\.receive/)
			assert.match(plan, /proxy_callback_events\(\{ port, path \}\)/)
			assert.match(plan, /`check_attestor`/)
			assert.match(plan, /subagent/)
			assert.doesNotMatch(plan, /tunnel/i)
			// The steps that need the developer come before app code.
			assert.ok(
				plan.indexOf('## 2. Get the provider and prove it')
				< plan.indexOf('## 3. Set up the app'),
			)
			assert.ok(plan.indexOf('`run_proof`') < plan.indexOf('## 3.'))
			assert.match(plan, /end your turn with the question/)
			assert.match(plan, /Don't use background or asynchronous question/)
			assert.match(plan, /streams the target site as an image/)
			assert.match(plan, /`list_verification_events`/)
			assert.doesNotMatch(plan, /\{\{|<!--/)
		})

	it('checks the org key pair before app code and wires it whenever set',
		() => {
			const plan = renderStartIntegration({ goal: 'g', route: 'provider' })
			assert.ok(
				plan.indexOf('`get_org_keypair`') < plan.indexOf('## 2.'),
			)
			assert.match(plan, /`update_org_keypair\(\{ orgId, canEncryptResult/)
			assert.match(plan, /<envFile>\.backup/)
			assert.match(plan, /`issue_org_keypair` with `replace: true`/)
			assert.match(plan, /never in chat/)
			assert.match(plan, /Whenever the org has a key pair/)
			assert.match(
				plan, /passes `RECLAIM_ORG_ETH_PRIVATE_KEY` to `reclaim.results/,
			)
			assert.doesNotMatch(plan, /Only when the developer asks for session/)
		})

	it('leaves the browser open and follows create_example_app next',
		() => {
			const plan = renderStartIntegration({ goal: 'g', route: 'provider' })
			assert.doesNotMatch(plan, /dispose_browser. after asking/)
			assert.match(plan, /Don't ask whether to close the browser/)
			assert.match(plan, /`next` array that `create_example_app` returned/)
			assert.doesNotMatch(plan, /\b(3000|5173)\b/)
			assert.match(plan, /log file/)
			assert.match(plan, /in-memory store is empty/)
			assert.match(plan, /Permission blocks/)
		})

	it('uses the given org and providers and skips authoring', async() => {
		const plan = await startIntegrationTool().handler({
			goal: 'g',
			orgId: ORG,
			providerIds: ['p1', 'p2'],
		})
		assert.equal(typeof plan, 'string')
		assert.match(String(plan), new RegExp(`organization \`${ORG}\``))
		assert.match(String(plan), /`p1`, `p2`/)
		assert.doesNotMatch(String(plan), /check_attestor/)
		assert.doesNotMatch(String(plan), /list_orgs|write the navigation script/i)
		assert.doesNotMatch(String(plan), /\{\{|<!--/)
	})

	it('plans an AI session by default', () => {
		const plan = renderStartIntegration({ goal: 'I own 100 followers' })
		assert.match(plan, /create_ai_verification_session/)
		assert.match(plan, /wait_for_ai_session/)
		assert.match(plan, /how_it_works\(\{ topic: "ai-sessions" \}\)/)
		assert.match(plan, /route: "provider"/)
		assert.match(plan, /issue_org_token/)
		assert.match(plan, /create_callback_subscription/)
		assert.match(plan, /proxy_callback_events/)
		assert.match(plan, /results\.receive/)
		assert.match(plan, /`list_orgs`/)
		assert.doesNotMatch(plan, /attach_browser|run_proof/)
		assert.doesNotMatch(plan, /\{\{|<!--/)
	})

	it('uses the provider plan for providerIds or an explicit provider route',
		() => {
			for(const args of [
				{ goal: 'g', providerIds: ['p1'] },
				{ goal: 'g', route: 'provider' as const },
			]) {
				const plan = renderStartIntegration(args)
				assert.match(plan, /## 2\. Get the provider and prove it/)
				assert.match(plan, /provider route/)
				assert.doesNotMatch(plan, /create_ai_verification_session/)
			}
		})

	it('uses the AI plan for an explicit route even with providerIds', () => {
		const plan = renderStartIntegration({
			goal: 'g',
			route: 'ai-session',
			providerIds: ['p1'],
		})
		assert.match(plan, /create_ai_verification_session/)
		assert.doesNotMatch(plan, /`p1`/)
	})
})
