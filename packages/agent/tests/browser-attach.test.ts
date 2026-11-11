import { ReclaimClient } from '@reclaimprotocol/client'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import type { CdpHandles } from '../src/cdp/client.ts'
import { defaultProfileDir, type LocalBrowser } from '../src/cdp/launcher.ts'
import { ConfigStore } from '../src/config/store.ts'
import { type AttachRef, attachTool } from '../src/mcp/tools/agent/attach.ts'
import type { CaptureStore } from '../src/mcp/tools/agent/capture.ts'
import { sessionTools } from '../src/mcp/tools/agent/session.ts'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'
const CDP_URL = 'wss://secret.example/cdp?token=never-display'
const LIVE_URL = 'https://live.example/session'
const NORMALIZED_LIVE_URL =
	'https://live.example/session/liveview.html?magnify=1'

function handles(onClose?: () => void): CdpHandles {
	// Browser/page protocol methods are irrelevant to attach lifecycle tests.
	return {
		browser: {} as CdpHandles['browser'],
		attachToTab: async() => ({} as never),
		listTabs: async() => [],
		close: async() => onClose?.(),
	}
}

/** A local launch stub that records its calls and never spawns anything. */
function localLaunch(browser: Partial<Omit<LocalBrowser, 'process'>> = {}) {
	const calls: Array<{ port: number, profileDir: string }> = []
	const launchLocal = async(opts: { port: number, profileDir: string }) => {
		calls.push({ port: opts.port, profileDir: opts.profileDir })
		return {
			binary: '/usr/bin/google-chrome',
			source: 'installed' as const,
			downloaded: false,
			// Never read by attach_browser: it leaves the browser running.
			process: {} as LocalBrowser['process'],
			...browser,
		}
	}

	return { calls, launchLocal }
}

function attachRef(): AttachRef {
	const dir = mkdtempSync(join(tmpdir(), 'reclaim-browser-attach-'))
	return { config: new ConfigStore(join(dir, 'config.json')) }
}

describe('attach_browser remote modes', () => {
	it('keeps Builder CDP secret while returning the shareable live view',
		async() => {
			const calls: Array<{ method: string, url: string }> = []
			const client = new ReclaimClient({
				baseUrl: 'https://builder.example',
				token: 'builder-token',
				fetch: async(input, init) => {
					const url = String(input)
					calls.push({ method: String(init?.method), url })
					if(init?.method === 'DELETE') {
						return new Response(null, { status: 204 })
					}

					return Response.json({
						id: SESSION_ID,
						orgId: ORG_ID,
						liveViewUrl: LIVE_URL,
						cdpUrl: CDP_URL,
						expiresAt: '2099-01-01T00:00:00.000Z',
					}, { status: 201 })
				},
			})
			const state = attachRef()
			let connectedUrl = ''
			let closed = false
			const tool = attachTool(
				state,
				client,
				undefined,
				{
					connectLocal: async() => handles(),
					connectRemote: async(url) => {
						connectedUrl = url
						return handles(() => {
							closed = true
						})
					},
				},
			)

			const result = await tool.handler({
				mode: 'builder', orgId: ORG_ID, countryCode: 'IN',
			})
			assert.equal(connectedUrl, CDP_URL)
			assert.equal((result as { liveViewUrl: string }).liveViewUrl,
				NORMALIZED_LIVE_URL)
			assert.equal(JSON.stringify(result).includes(CDP_URL), false)

			const captures: CaptureStore = { sessions: new Map() }
			const reset = sessionTools(state, captures).find(
				(entry) => entry.definition.name === 'reset_session',
			)!
			await reset.handler({})
			assert.equal(closed, true)
			assert.deepEqual(calls.map((call) => call.method), ['POST', 'DELETE'])
		})

	it('hands back the container\'s own viewer, and says it can be shared',
		async() => {
			// Container mode runs the Reclaim browser runtime, whose live view is
			// already serving on loopback. There is nothing to set up: the URL goes
			// straight to the developer, and sharing it is a separate step for when
			// someone ELSE needs it.
			const state = attachRef()
			let started: { viewerPort?: number, cdpPort?: number } | undefined
			const tool = attachTool(state, undefined, undefined, {
				connectLocal: async() => handles(),
				connectRemote: async() => handles(),
				dockerAvailable: async() => true,
				startContainer: async(opts = {}) => {
					started = { viewerPort: opts.viewerPort, cdpPort: opts.cdpPort }
					return {
						viewerUrl: 'http://127.0.0.1:16080/liveview.html?magnify=1',
						cdpUrl: 'ws://127.0.0.1:19226/devtools/browser/abc',
						viewerPort: opts.viewerPort ?? 16080,
						name: 'reclaim-browser-0',
						pulled: true,
						slot: 0,
						stop: async() => {},
					}
				},
			})
			const result = await tool.handler({ mode: 'container' }) as {
				liveViewUrl?: string
				liveViewAvailable?: boolean
				containerName?: string
				_notes: string[]
			}
			assert.equal(result.liveViewUrl,
				'http://127.0.0.1:16080/liveview.html?magnify=1')
			assert.equal(result.liveViewAvailable, true)
			assert.equal(result.containerName, 'reclaim-browser-0')
			// The tool must NOT pin a port: two concurrent sessions on one port
			// share a container, so session two would silently drive session one's
			// browser. Leaving it unset is what makes each session its own.
			assert.equal(started?.viewerPort, undefined,
				'no fixed port, so every session gets its own container')

			const notes = result._notes.join(' ')
			assert.match(notes, /liveViewUrl/)
			assert.match(notes, /share_browser_view/)
			assert.match(notes, /downloaded just now/,
				'a 432 MB download on their machine is worth mentioning')
		})

	it('refuses container mode actionably when Docker is not running',
		async() => {
			const state = attachRef()
			const tool = attachTool(state, undefined, undefined, {
				connectLocal: async() => handles(),
				connectRemote: async() => handles(),
				dockerAvailable: async() => false,
			})
			await assert.rejects(() => tool.handler({ mode: 'container' }),
				(err: Error) => {
					// Names the fix AND the alternatives, rather than just failing.
					assert.match(err.message, /Docker/)
					assert.match(err.message, /Rosetta/)
					assert.match(err.message, /dedicated/)
					return true
				})
		})

	it('tells the agent a plain local browser has no view to share', async() => {
		// With our own screencast viewer gone, `custom` (and `dedicated`,
		// `attach`) can only be watched by looking at the machine they run on.
		// The note has to say so and point at the mode that can be shared.
		const state = attachRef()
		const tool = attachTool(state, undefined, undefined, {
			connectLocal: async() => handles(),
			connectRemote: async() => handles(),
		})
		const result = await tool.handler({ mode: 'custom', cdpUrl: CDP_URL }) as {
			liveViewAvailable?: boolean
			_notes: string[]
		}
		assert.equal(result.liveViewAvailable, undefined)
		assert.match(result._notes.join(' '), /no live view/)
		assert.match(result._notes.join(' '), /`container` mode/)
	})

	it('tells the agent to relay the hosted view instead, in builder mode',
		async() => {
			// Popcorn already hosts one, so there is nothing to set up and nothing
			// to ask — but the URL still has to reach the developer.
			const client = new ReclaimClient({
				baseUrl: 'https://builder.example',
				token: 'builder-token',
				fetch: async() => Response.json({
					id: SESSION_ID, orgId: ORG_ID, liveViewUrl: LIVE_URL,
					cdpUrl: CDP_URL, expiresAt: '2099-01-01T00:00:00.000Z',
				}, { status: 201 }),
			})
			const state = attachRef()
			const tool = attachTool(state, client, undefined, {
				connectLocal: async() => handles(),
				connectRemote: async() => handles(),
			})
			const result = await tool.handler({
				mode: 'builder', orgId: ORG_ID, countryCode: 'IN',
			}) as { liveViewAvailable?: boolean, _notes: string[] }
			assert.equal(result.liveViewAvailable, undefined,
				'a hosted view is not ours to tunnel')
			assert.match(result._notes.join(' '), /hosted live view already/)
		})

	it('auto-resolves orgId when the account has exactly one organization',
		async() => {
			const calls: Array<{ method: string, url: string }> = []
			const client = new ReclaimClient({
				baseUrl: 'https://builder.example',
				token: 'builder-token',
				fetch: async(input, init) => {
					const url = String(input)
					const method = String(init?.method ?? 'GET')
					calls.push({ method, url })
					if(method === 'GET' && url.includes('/orgs')) {
						return Response.json({
							items: [{ id: ORG_ID, name: 'Solo Org', kind: 'ORG',
								status: 'ACTIVE' }],
						})
					}

					return Response.json({
						id: SESSION_ID,
						orgId: ORG_ID,
						liveViewUrl: LIVE_URL,
						cdpUrl: CDP_URL,
						expiresAt: '2099-01-01T00:00:00.000Z',
					}, { status: 201 })
				},
			})
			const state = attachRef()
			const tool = attachTool(
				state,
				client,
				undefined,
				{
					connectLocal: async() => handles(),
					connectRemote: async() => handles(),
				},
			)

			const result = await tool.handler({
				mode: 'builder', countryCode: 'IN',
			})
			assert.equal((result as { attached: boolean }).attached, true)
			assert.equal(state.current?.orgId, ORG_ID)
			assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST'])
		})

	it('asks the caller to choose when the account has multiple organizations',
		async() => {
			const OTHER_ORG_ID = '33333333-3333-4333-8333-333333333333'
			let postCalled = false
			const client = new ReclaimClient({
				baseUrl: 'https://builder.example',
				token: 'builder-token',
				fetch: async(input, init) => {
					const url = String(input)
					const method = String(init?.method ?? 'GET')
					if(method === 'GET' && url.includes('/orgs')) {
						return Response.json({
							items: [
								{ id: ORG_ID, name: 'Org One', kind: 'TEAM',
									status: 'ACTIVE' },
								{ id: OTHER_ORG_ID, name: 'Org Two', kind: 'ORG',
									status: 'ACTIVE' },
							],
						})
					}

					postCalled = true
					return Response.json({
						id: SESSION_ID,
						orgId: ORG_ID,
						liveViewUrl: LIVE_URL,
						cdpUrl: CDP_URL,
						expiresAt: '2099-01-01T00:00:00.000Z',
					}, { status: 201 })
				},
			})
			const state = attachRef()
			const tool = attachTool(
				state,
				client,
				undefined,
				{
					connectLocal: async() => handles(),
					connectRemote: async() => handles(),
				},
			)

			const result = await tool.handler({ mode: 'builder' }) as {
				needsChoice?: boolean
				organizations?: Array<{ id: string }>
			}
			assert.equal(result.needsChoice, true)
			assert.deepEqual(
				result.organizations?.map((o) => o.id),
				[ORG_ID, OTHER_ORG_ID],
			)
			assert.equal(postCalled, false)
			assert.equal(state.current, undefined)
		})

	it('asks for a country before spending a quota-accounted browser',
		async() => {
			// The exit country is fixed at allocation and can't be changed after,
			// so an unconfirmed one must not burn a browser.
			let postCalled = false
			const client = new ReclaimClient({
				baseUrl: 'https://builder.example',
				token: 'builder-token',
				fetch: async() => {
					postCalled = true
					return Response.json({
						id: SESSION_ID,
						orgId: ORG_ID,
						liveViewUrl: LIVE_URL,
						cdpUrl: CDP_URL,
						expiresAt: '2099-01-01T00:00:00.000Z',
					}, { status: 201 })
				},
			})
			const state = attachRef()
			const tool = attachTool(
				state,
				client,
				undefined,
				{
					connectLocal: async() => handles(),
					connectRemote: async() => handles(),
				},
			)

			// The suggestion is the caller's own public-IP country.
			const realFetch = globalThis.fetch
			globalThis.fetch = (async() => Response.json({
				country: 'DE', region: 'Berlin', city: 'Berlin',
			}))
			let result: { needsChoice?: boolean, suggestedCountryCode?: string }
			try {
				result = await tool.handler({ mode: 'builder', orgId: ORG_ID }) as {
					needsChoice?: boolean
					suggestedCountryCode?: string
				}
			} finally {
				globalThis.fetch = realFetch
			}

			assert.equal(result.needsChoice, true)
			assert.equal(result.suggestedCountryCode, 'DE')
			assert.equal(postCalled, false)
			assert.equal(state.current, undefined)
		})

	it('allocates without geo-routing when the country prompt is declined',
		async() => {
			// Geolocation is optional: "no particular country" has to be as
			// reachable as naming one, and must not re-trigger the prompt.
			let body: unknown
			const client = new ReclaimClient({
				baseUrl: 'https://builder.example',
				token: 'builder-token',
				fetch: async(_input, init) => {
					body = JSON.parse(String(init?.body ?? '{}'))
					return Response.json({
						id: SESSION_ID,
						orgId: ORG_ID,
						liveViewUrl: LIVE_URL,
						cdpUrl: CDP_URL,
						expiresAt: '2099-01-01T00:00:00.000Z',
					}, { status: 201 })
				},
			})
			const state = attachRef()
			const tool = attachTool(state, client, undefined, {
				connectLocal: async() => handles(),
				connectRemote: async() => handles(),
			})

			const result = await tool.handler({
				mode: 'builder', orgId: ORG_ID, skipCountry: true,
			}) as { attached?: boolean, countryCode?: string }

			assert.equal(result.attached, true)
			assert.equal(result.countryCode, undefined)
			assert.deepEqual(body, {})
		})

	it('does not persist or return a custom websocket URL', async() => {
		const state = attachRef()
		let connectedUrl = ''
		const tool = attachTool(
			state,
			undefined,
			undefined,
			{
				connectLocal: async() => handles(),
				connectRemote: async(url) => {
					connectedUrl = url
					return handles()
				},
			},
		)
		const result = await tool.handler({ mode: 'custom', cdpUrl: CDP_URL })

		assert.equal(connectedUrl, CDP_URL)
		assert.equal(JSON.stringify(result).includes(CDP_URL), false)
		assert.equal(state.config.read(), undefined)
	})
})

describe('attach_browser default local browser', () => {
	it('launches a visible local browser with no question when mode is omitted',
		async() => {
			const state = attachRef()
			const launch = localLaunch()
			let connectedPort = 0
			const tool = attachTool(state, undefined, undefined, {
				connectLocal: async(port) => {
					connectedPort = port
					return handles()
				},
				connectRemote: async() => handles(),
				waitForCdp: async() => {
					throw new Error('nothing on the port yet')
				},
				launchLocal: launch.launchLocal,
			})

			const result = await tool.handler({}) as {
				needsChoice?: boolean
				attached?: boolean
				mode?: string
				browser?: string
				_notes: string[]
			}

			assert.equal(result.needsChoice, undefined)
			assert.equal(result.attached, true)
			assert.equal(result.mode, 'dedicated')
			assert.equal(result.browser, 'installed')
			assert.deepEqual(launch.calls,
				[{ port: 9222, profileDir: defaultProfileDir() }])
			assert.equal(connectedPort, 9222)
			assert.equal(state.current?.mode, 'dedicated')
			assert.match(result._notes.join(' '), /Do not offer other modes/)
		})

	it('reuses the browser already answering on the port', async() => {
		const launch = localLaunch()
		const tool = attachTool(attachRef(), undefined, undefined, {
			connectLocal: async() => handles(),
			connectRemote: async() => handles(),
			waitForCdp: async() => {},
			launchLocal: launch.launchLocal,
		})
		const result = await tool.handler({}) as { attached?: boolean }
		assert.equal(result.attached, true)
		assert.equal(launch.calls.length, 0)
	})

	it('does not reapply a persisted attach mode', async() => {
		// Attaching to the developer's own Chrome is opt-in every time.
		const state = attachRef()
		state.config.write({ browser_agent: { attachMode: 'attach', port: 9333 } })
		const launch = localLaunch()
		const tool = attachTool(state, undefined, undefined, {
			connectLocal: async() => handles(),
			connectRemote: async() => handles(),
			waitForCdp: async() => {
				throw new Error('nothing on the port yet')
			},
			launchLocal: launch.launchLocal,
		})
		const result = await tool.handler({}) as { mode?: string }
		assert.equal(result.mode, 'dedicated')
		assert.equal(launch.calls.length, 1)
	})

	it('tells the agent when Chrome for Testing stood in, and why', async() => {
		const launch = localLaunch({
			binary: '/home/dev/.reclaim/browsers/chrome/linux-1/chrome',
			source: 'chrome-for-testing',
			downloaded: true,
			fallbackReason: 'No Chrome, Chromium, or Edge is installed.',
		})
		const tool = attachTool(attachRef(), undefined, undefined, {
			connectLocal: async() => handles(),
			connectRemote: async() => handles(),
			waitForCdp: async() => {
				throw new Error('nothing on the port yet')
			},
			launchLocal: launch.launchLocal,
		})
		const result = await tool.handler({}) as {
			browser?: string
			_notes: string[]
		}
		assert.equal(result.browser, 'chrome-for-testing')
		const notes = result._notes.join(' ')
		assert.match(notes, /Chrome for Testing, downloaded just now/)
		assert.match(notes, /No Chrome, Chromium, or Edge is installed/)
	})

	it('surfaces the launch failure instead of offering another mode',
		async() => {
			const tool = attachTool(attachRef(), undefined, undefined, {
				connectLocal: async() => handles(),
				connectRemote: async() => handles(),
				waitForCdp: async() => {
					throw new Error('nothing on the port yet')
				},
				launchLocal: async() => {
					throw new Error('No display: neither WAYLAND_DISPLAY nor DISPLAY')
				},
			})
			await assert.rejects(tool.handler({}), /No display/)
		})

	it('attaches to the developer\'s own Chrome only when asked', async() => {
		const launch = localLaunch()
		let probedPort = 0
		const tool = attachTool(attachRef(), undefined, undefined, {
			connectLocal: async() => handles(),
			connectRemote: async() => handles(),
			waitForCdp: async(port) => {
				probedPort = port
			},
			launchLocal: launch.launchLocal,
		})
		const result = await tool.handler({ mode: 'attach', port: 9333 }) as {
			mode?: string
			port?: number
		}
		assert.equal(result.mode, 'attach')
		assert.equal(result.port, 9333)
		assert.equal(probedPort, 9333)
		assert.equal(launch.calls.length, 0, 'attach never launches a browser')
	})

	it('explains the Chrome 136 rule when nothing answers in attach mode',
		async() => {
			const tool = attachTool(attachRef(), undefined, undefined, {
				connectLocal: async() => handles(),
				connectRemote: async() => handles(),
				waitForCdp: async() => {
					throw new Error('timeout')
				},
				launchLocal: localLaunch().launchLocal,
			})
			await assert.rejects(tool.handler({ mode: 'attach' }),
				/--user-data-dir.*Chrome 136/s)
		})

	it('describes the default without inviting a choice', () => {
		const description = attachTool(attachRef()).definition.description
		assert.ok(description.length < 600)
		assert.match(description, /no arguments/)
		assert.match(description, /do not ask/)
		assert.match(description, /Never offer or pick/)
		assert.match(description, /how_it_works/)
		assert.doesNotMatch(description, /Chrome 136/)
	})
})
