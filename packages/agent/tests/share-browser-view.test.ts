import assert from 'node:assert'
import { describe, it } from 'node:test'
import type { AttachState } from '../src/mcp/tools/agent/attach.ts'
import { liveViewTools } from '../src/mcp/tools/agent/live-view.ts'
import { ensureLiveViewUrl } from '../src/mcp/tools/agent/live-view-url.ts'

/**
 * The server never runs cloudflared: `share_browser_view` hands the agent the
 * port, the command, and the developer's two choices (run it themselves,
 * or approve the agent running it), then turns the URL cloudflared
 * printed into the link to relay. What is worth asserting is the mode GATE
 * and those outputs.
 */
describe('share_browser_view', () => {
	const tools = () => {
		const attach: { current?: AttachState } = {}
		const [share] = liveViewTools(attach)
		return { attach, share }
	}

	const state = (
		mode: string,
		extra: { liveViewUrl?: string, viewerPort?: number } = {},
	) => ({
		mode,
		handles: {
			browser: {},
			attachToTab: async() => ({}),
			listTabs: async() => [],
			close: async() => {},
		},
		...extra,
		// Minimal fake of AttachState; only the fields the tool reads are real.
	}) as unknown as AttachState

	it('refuses with no browser attached', async() => {
		const { share } = tools()
		await assert.rejects(() => share.handler({}), /attach_browser first/)
	})

	it('refuses in builder mode and points at the hosted live view', async() => {
		const { attach, share } = tools()
		attach.current = state('builder',
			{ liveViewUrl: 'https://live.example/session/abc' })
		await assert.rejects(() => share.handler({}), (err: Error) => {
			assert.match(err.message, /does not apply to `builder` mode/)
			assert.match(err.message,
				/https:\/\/live\.example\/session\/abc\/liveview\.html\?magnify=1/,
				'names the URL to use instead')
			return true
		})
	})

	it('refuses a plain local browser and names container mode', async() => {
		const { attach, share } = tools()
		attach.current = state('dedicated')
		await assert.rejects(() => share.handler({}), (err: Error) => {
			assert.match(err.message, /does not apply to `dedicated` mode/)
			assert.match(err.message, /mode "container"/)
			return true
		})
	})

	it('needs a viewer port in container mode', async() => {
		const { attach, share } = tools()
		attach.current = state('container')
		await assert.rejects(() => share.handler({}), /no live-view port/)
	})

	it('returns the command and both choices without running anything',
		async() => {
			const { attach, share } = tools()
			attach.current = state('container', { viewerPort: 16080 })
			const result = await share.handler({}) as {
				localViewerUrl: string
				port: number
				command: string
				choices: Array<{ id: string, recommended: boolean, action: string }>
			}
			assert.equal(result.localViewerUrl,
				'http://localhost:16080/liveview.html?magnify=1')
			assert.equal(result.port, 16080)
			assert.equal(result.command,
				'cloudflared tunnel --url http://localhost:16080')
			assert.deepEqual(
				result.choices.map((c) => [c.id, c.recommended]),
				[['developer-runs', true], ['agent-runs', false]],
			)
			assert.match(result.choices[0].action,
				/! cloudflared tunnel --url http:\/\/localhost:16080/)
		})

	it('turns the trycloudflare URL into the viewer link', async() => {
		const { attach, share } = tools()
		attach.current = state('container', { viewerPort: 16080 })
		const result = await share.handler({
			publicUrl: 'https://quiet-river-abc.trycloudflare.com/',
		})
		assert.equal(Reflect.get(result as object, 'url'),
			'https://quiet-river-abc.trycloudflare.com/liveview.html?magnify=1')
	})

	it('rejects a publicUrl that is not a quick tunnel', async() => {
		const { attach, share } = tools()
		attach.current = state('container', { viewerPort: 16080 })
		for(const publicUrl of [
			'http://a.trycloudflare.com',
			'https://evil.example',
			'https://trycloudflare.com.evil.example',
		]) {
			await assert.rejects(() => share.handler({ publicUrl }),
				/trycloudflare\.com URL/)
		}
	})
})

describe('ensureLiveViewUrl', () => {
	it('adds the viewer route and magnification when missing', () => {
		assert.equal(
			ensureLiveViewUrl('https://live.example/session/abc'),
			'https://live.example/session/abc/liveview.html?magnify=1',
		)
	})

	it('keeps the viewer route and replaces an incorrect magnification value',
		() => {
			assert.equal(
				ensureLiveViewUrl(
					'https://live.example/liveview.html?token=abc&magnify=0',
				),
				'https://live.example/liveview.html?token=abc&magnify=1',
			)
		})

	it('does not duplicate an existing viewer route', () => {
		const url = 'https://live.example/liveview.html?magnify=1'
		assert.equal(ensureLiveViewUrl(url), url)
	})
})
