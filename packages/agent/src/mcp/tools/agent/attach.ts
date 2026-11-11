import { badRequest } from '@hapi/boom'
import type { ReclaimClient } from '@reclaimprotocol/client/api'
import assert from 'node:assert'
import {
	type CdpHandles,
	connectCdp,
	connectCdpUrl,
} from '../../../cdp/client.ts'
import {
	dockerAvailable,
	dockerMissingMessage,
	startContainer,
} from '../../../cdp/container.ts'
import { suggestCountryFromIp } from '../../../cdp/geo.ts'
import {
	defaultProfileDir,
	launchLocalBrowser,
	type LocalBrowser,
	waitForCdpReady,
} from '../../../cdp/launcher.ts'
import type { ConfigStore } from '../../../config/store.ts'
import { defineTool, type RegisteredTool } from '../../server.ts'
import { ensureLiveViewUrl } from './live-view-url.ts'

export type BrowserMode =
	| 'dedicated'
	| 'attach'
	| 'builder'
	| 'custom'
	| 'container'

/**
 * Modes with a live view that `share_browser_view` can put behind a public URL.
 *
 * Only `container`: it runs the Reclaim browser runtime, whose viewer already
 * serves on loopback, so sharing is a tunnel in front of it. `builder` gives a
 * hosted `liveViewUrl` instead, and a plain local browser has nothing to
 * show — one on this machine is watched by looking at it.
 */
export const SHAREABLE_MODES = new Set<BrowserMode>(['container'])

export interface AttachState {
	handles: CdpHandles
	mode: BrowserMode
	port?: number
	liveViewUrl?: string
	browserSessionId?: string
	orgId?: string
	/** The hosted Builder browser's TEE API base — lets
	 *  `run_proof_via_pod` prove through the SAME enclave that holds the
	 *  browser's TLS session (and its country-routed egress), instead of the
	 *  local in-process attestor SDK. */
	apiUrl?: string
	/** The exit country this remote browser was allocated with, if any. */
	countryCode?: string
	/** Docker's name for a `container`-mode browser, for diagnostics. */
	containerName?: string
	/** Loopback port the container's own live viewer serves on, which is what
	 *  `share_browser_view` tunnels. Never the CDP port. */
	viewerPort?: number
	/** Whether the runtime image had to be downloaded on this attach. */
	imagePulled?: boolean
	/** `dedicated` mode: the browser this attach launched, if it launched one. */
	launched?: Omit<LocalBrowser, 'process'>
	disposeRemote?: () => Promise<void>
}

export interface AttachRef {
	current?: AttachState
	config: ConfigStore
}

interface AttachArgs {
	mode?: BrowserMode
	/** Backward-compatible local-mode spelling. */
	attachMode?: 'dedicated' | 'attach'
	port?: number
	orgId?: string
	cdpUrl?: string
	liveViewUrl?: string
	/** Builder mode: the country the remote browser should browse from. */
	countryCode?: string
	/** Builder mode: allocate without geo-routing, skipping the country
	 *  prompt. Geolocation is optional — this is how the caller says so. */
	skipCountry?: boolean
	/** Container mode: loopback port for the live viewer. */
	viewerPort?: number
}

interface AttachDependencies {
	connectLocal: typeof connectCdp
	connectRemote: typeof connectCdpUrl
	/** Injected so container mode is testable without Docker installed. */
	dockerAvailable: typeof dockerAvailable
	startContainer: typeof startContainer
	/** Injected so the default launch is testable without a real browser. */
	launchLocal: typeof launchLocalBrowser
	waitForCdp: typeof waitForCdpReady
}

const DEFAULT_DEPENDENCIES: AttachDependencies = {
	connectLocal: connectCdp,
	connectRemote: connectCdpUrl,
	dockerAvailable,
	startContainer,
	launchLocal: launchLocalBrowser,
	waitForCdp: waitForCdpReady,
}

export function attachTool(
	state: AttachRef,
	builderClient?: ReclaimClient,
	beforeReplace?: () => Promise<void>,
	// Partial so a caller can stub one thing without restating the rest — the
	// tests only ever care about a couple of these at a time.
	dependencies: Partial<AttachDependencies> = {},
): RegisteredTool {
	const deps: AttachDependencies = {
		...DEFAULT_DEPENDENCIES, ...dependencies,
	}
	return defineTool<AttachArgs>(
		{
			name: 'attach_browser',
			description:
				'Opens a visible browser on the developer\'s own machine for '
				+ 'sign-in and capture. Call it with no arguments and do not ask '
				+ 'which browser to use: it launches installed Chrome (else '
				+ 'Chromium, Edge, or a one-time Chrome for Testing download) with '
				+ 'the persistent Reclaim profile. Pass `mode` only when the '
				+ 'developer explicitly asks for that mode: `attach` (their running '
				+ 'Chrome on `port`), `container` (Docker), `custom` (`cdpUrl`), or '
				+ '`builder` (billed). Never offer or pick those yourself. See '
				+ 'how_it_works({ topic: "browser" }).',
			inputSchema: {
				type: 'object',
				properties: {
					mode: {
						type: 'string',
						enum: [
							'dedicated', 'attach', 'container', 'builder', 'custom',
						],
						description:
							'Omit for the default local browser (`dedicated`). Set '
							+ 'only to a mode the developer explicitly asked for.',
					},
					attachMode: {
						type: 'string',
						enum: ['dedicated', 'attach'],
						description: 'Deprecated local-mode alias for mode.',
					},
					port: { type: 'number', minimum: 1, maximum: 65535 },
					orgId: { type: 'string', format: 'uuid' },
					cdpUrl: { type: 'string', maxLength: 4000 },
					liveViewUrl: { type: 'string', format: 'uri', maxLength: 4000 },
					viewerPort: {
						type: 'number',
						minimum: 1024,
						maximum: 60000,
						description:
							'`container` mode only. Loopback port for the built-in live '
							+ 'viewer. Change it only to avoid a clash; the CDP port and '
							+ 'the container name are derived from it.',
					},
					countryCode: {
						type: 'string',
						pattern: '^[A-Za-z]{2}$',
						description:
							'Builder mode only. ISO 3166-1 alpha-2 country the remote '
							+ 'browser browses from, fixed for the whole session. Omit to '
							+ 'get a suggested country back (needsChoice) instead of '
							+ 'allocating a browser.',
					},
					skipCountry: {
						type: 'boolean',
						description:
							'Builder mode only. Allocate without geo-routing, skipping '
							+ 'the country prompt. Pass this once the developer has said '
							+ 'they don\'t need a specific country.',
					},
				},
			},
			annotations: { openWorldHint: true, destructiveHint: false },
		},
		async(parsed) => {
			const persisted = state.config.read()?.browser_agent
			// The default is a visible browser on the developer's own machine,
			// with no question first. Every other mode costs something (Docker,
			// quota, the developer's own profile) and is used only when the
			// developer asked for it by name, so a persisted choice is never
			// reapplied either.
			const mode = parsed.mode ?? parsed.attachMode ?? 'dedicated'

			let orgId = parsed.orgId
			if(mode === 'builder' && !orgId) {
				assert(
					builderClient,
					badRequest('Builder browser service is unavailable'),
				)
				const { data } = await builderClient.call('ListOrgs', { query: {} })
				const orgs = data.items ?? []
				assert(
					orgs.length,
					badRequest(
						'No organizations available for this account — create one '
						+ 'first, or authenticate as a user who belongs to one.',
					),
				)
				if(orgs.length > 1) {
					return {
						needsChoice: true,
						message:
							'This account belongs to more than one organization. Ask '
							+ 'the developer which one to use, then re-call '
							+ 'attach_browser with mode "builder" and that orgId.',
						organizations: orgs.map((o) => ({
							id: o.id,
							name: o.name,
							kind: o.kind,
							status: o.status,
						})),
					}
				}

				orgId = orgs[0].id
			}

			// A remote browser's exit country is fixed for the whole session —
			// Popcorn applies it at allocation and it can't be changed later. So
			// confirm it with the developer BEFORE spending a quota-accounted
			// browser on the wrong one, the same way orgId is confirmed above.
			// Geo-routing is OPTIONAL though, so this asks rather than demands:
			// `skipCountry` is the "no particular country" answer, and it must be
			// as reachable as naming one.
			if(mode === 'builder' && !parsed.countryCode && !parsed.skipCountry) {
				const suggestion = await suggestCountryFromIp()
				return {
					needsChoice: true,
					message:
						'Ask the developer which country this browser should browse '
						+ 'from — its egress is routed through that country for the '
						+ 'whole session and cannot be changed afterwards. Geolocation '
						+ 'is optional; offer all three answers below. Nothing has been '
						+ 'allocated yet, so this costs nothing.',
					choices: [
						{
							answer: 'The suggested country',
							howToCall: `attach_browser({ mode: "builder", countryCode: "${
								suggestion.countryCode}" })`,
						},
						{
							answer: 'A specific country the site must be seen from',
							howToCall:
								'attach_browser({ mode: "builder", countryCode: "<ISO '
								+ '3166-1 alpha-2>" })',
						},
						{
							answer: 'No particular country',
							howToCall:
								'attach_browser({ mode: "builder", skipCountry: true })',
						},
					],
					suggestedCountryCode: suggestion.countryCode,
					suggestionSource: 'caller-ip',
					...(suggestion.country ? { country: suggestion.country } : {}),
					...(suggestion.region ? { region: suggestion.region } : {}),
					...(suggestion.city ? { city: suggestion.city } : {}),
				}
			}

			const next = await connect(
				mode, { ...parsed, orgId }, persisted, builderClient, deps,
			)
			next.liveViewUrl = next.liveViewUrl
				? ensureLiveViewUrl(next.liveViewUrl)
				: undefined
			try {
				await beforeReplace?.()
				await disposeAttached(state)
			} catch(err) {
				await disposeState(next).catch(() => {})
				throw err
			}

			state.current = next
			if(mode === 'dedicated' || mode === 'attach') {
				state.config.write({
					browser_agent: { attachMode: mode, port: next.port! },
				})
			}

			// How the developer watches this browser differs per mode, and none of
			// it is guessable, so every mode says its own piece here.
			const localView = mode === 'container'
			const hostedView = Boolean(next.liveViewUrl) && !localView
			const canShare = SHAREABLE_MODES.has(mode)
			return {
				attached: true,
				mode,
				...(next.port ? { port: next.port } : {}),
				...(next.browserSessionId
					? { browserSessionId: next.browserSessionId }
					: {}),
				...(next.liveViewUrl ? { liveViewUrl: next.liveViewUrl } : {}),
				...(next.countryCode ? { countryCode: next.countryCode } : {}),
				...(next.containerName ? { containerName: next.containerName } : {}),
				...(canShare ? { liveViewAvailable: true } : {}),
				...(next.launched ? { browser: next.launched.source } : {}),
				_notes: [
					...(next.launched?.source === 'chrome-for-testing'
						? ['Launched Chrome for Testing'
							+ (next.launched.downloaded
								? ', downloaded just now into ~/.reclaim/browsers (later '
									+ 'launches reuse it)'
								: ' from ~/.reclaim/browsers')
							+ `, because: ${next.launched.fallbackReason}. Mention `
							+ 'this to the developer in one line.']
						: []),
					...(next.imagePulled
						? ['The browser runtime image was downloaded just now (about '
							+ '432 MB, about 1.3 GB on disk). Mention it — later attaches '
							+ 'reuse it. RECLAIM_BROWSER_RUNTIME_IMAGE points at a '
							+ 'different or locally built image.']
						: []),
					...(localView
						? ['This browser has its own live view, already running on this '
							+ 'machine: relay `liveViewUrl` to the developer verbatim, on '
							+ 'its own line, so they can watch and drive it. It is '
							+ 'loopback-only, so only they can reach it. If someone ELSE '
							+ 'needs to — a login only they can complete — call '
							+ 'share_browser_view to put that same viewer behind a public '
							+ 'URL.']
						: []),
					...(hostedView
						? ['This browser has a hosted live view already. Relay '
							+ '`liveViewUrl` to the developer verbatim, on its own line, '
							+ 'so they can watch the run — share_browser_view does not '
							+ 'apply here.']
						: []),
					...(!localView && !hostedView
						? ['This browser has no live view: it runs on the developer\'s '
							+ 'own machine, so they watch it by looking at it. Do not '
							+ 'offer other modes. Tell the developer once, as a side '
							+ 'note, that if a volunteer is helping them sign in, a '
							+ 'shareable link can be set up (`container` mode and '
							+ 'share_browser_view); do not ask or set it up unless they '
							+ 'ask.']
						: []),
				],
			}
		},
	)
}

export async function disposeAttached(state: AttachRef) {
	const current = state.current
	if(!current) {
		return
	}

	delete state.current
	await disposeState(current)
}

async function connect(
	mode: BrowserMode,
	parsed: AttachArgs,
	persisted: { attachMode: 'dedicated' | 'attach', port: number } | undefined,
	builderClient: ReclaimClient | undefined,
	dependencies: AttachDependencies,
): Promise<AttachState> {
	if(mode === 'builder') {
		assert(builderClient, badRequest('Builder browser service is unavailable'))
		assert(parsed.orgId, badRequest('orgId is required for builder mode'))
		const countryCode = parsed.countryCode?.trim().toUpperCase()
		const { data } = await builderClient.call('CreateAgentBrowserSession', {
			params: { orgId: parsed.orgId },
			body: countryCode ? { countryCode } : {},
		})
		let handles: CdpHandles
		try {
			handles = await dependencies.connectRemote(data.cdpUrl)
		} catch(err) {
			await builderClient.call('DisposeAgentBrowserSession', {
				params: {
					orgId: parsed.orgId,
					browserSessionId: data.id,
				},
			}).catch(() => {})
			throw err
		}

		return {
			handles,
			mode,
			liveViewUrl: data.liveViewUrl,
			browserSessionId: data.id,
			orgId: parsed.orgId,
			...(data.apiUrl ? { apiUrl: data.apiUrl } : {}),
			...(countryCode ? { countryCode } : {}),
			disposeRemote: async() => {
				await builderClient.call('DisposeAgentBrowserSession', {
					params: {
						orgId: parsed.orgId!,
						browserSessionId: data.id,
					},
				})
			},
		}
	}

	if(mode === 'custom') {
		assert(parsed.cdpUrl, badRequest('cdpUrl is required for custom mode'))
		const url = new URL(parsed.cdpUrl)
		assert(
			url.protocol === 'ws:' || url.protocol === 'wss:',
			badRequest('cdpUrl must use ws:// or wss://'),
		)
		return {
			handles: await dependencies.connectRemote(parsed.cdpUrl),
			mode,
			...(parsed.liveViewUrl ? { liveViewUrl: parsed.liveViewUrl } : {}),
		}
	}

	if(mode === 'container') {
		assert(await dependencies.dockerAvailable(),
			badRequest(dockerMissingMessage()))
		// Ports are allocated per session unless the caller names one. A fixed
		// default would give two concurrent sessions the SAME container — the
		// name derives from the viewer port — so session two would silently
		// drive session one's browser.
		const container = await dependencies.startContainer({
			...(parsed.viewerPort ? { viewerPort: parsed.viewerPort } : {}),
			image: process.env.RECLAIM_BROWSER_RUNTIME_IMAGE?.trim() || undefined,
		})
		try {
			return {
				handles: await dependencies.connectRemote(container.cdpUrl),
				mode,
				liveViewUrl: container.viewerUrl,
				containerName: container.name,
				viewerPort: container.viewerPort,
				imagePulled: container.pulled,
				disposeRemote: container.stop,
			}
		} catch(err) {
			// Never leave a 1.3 GB container running for a browser we could not
			// talk to.
			await container.stop().catch(() => {})
			throw err
		}
	}

	const port = parsed.port ?? persisted?.port ?? 9222
	let launched: AttachState['launched']
	if(mode === 'dedicated') {
		try {
			// Reuse the browser an earlier attach launched on this port.
			await dependencies.waitForCdp(port, 500)
		} catch{
			const browser = await dependencies
				.launchLocal({ port, profileDir: defaultProfileDir() })
			// The browser outlives this attach on purpose, so its process handle
			// is not kept.
			launched = {
				binary: browser.binary,
				source: browser.source,
				downloaded: browser.downloaded,
				...(browser.fallbackReason
					? { fallbackReason: browser.fallbackReason }
					: {}),
			}
		}
	} else {
		await dependencies.waitForCdp(port, 2_000).catch(() => {
			throw new Error(
				`attach mode: nothing answering CDP on port ${port}. Chrome must `
				+ `be launched with --remote-debugging-port=${port} AND `
				+ '--user-data-dir=<some-non-default-path>. Chrome 136+ ignores '
				+ 'the debugging flag for the default profile.',
			)
		})
	}

	return {
		handles: await dependencies.connectLocal(port),
		mode,
		port,
		...(launched ? { launched } : {}),
	}
}

async function disposeState(state: AttachState) {
	try {
		await state.handles.close()
	} finally {
		await state.disposeRemote?.()
	}
}
