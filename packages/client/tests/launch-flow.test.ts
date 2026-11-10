import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	RECLAIM_CANCEL_VERIFICATION,
	RECLAIM_EXTENSION_RESPONSE,
	RECLAIM_START_VERIFICATION,
} from '../src/launch/extension.ts'
import {
	isReclaimFlowUnavailableError,
	ReclaimFlow,
} from '../src/launch/index.ts'
import {
	androidEnvironment,
	createFakeTab,
	desktopEnvironment,
	iosEnvironment,
} from './launch-fakes.ts'

const ORIGIN = 'https://build.reclaimprotocol.org'
const SESSION_ID = 's1'
const QUERY = `?api=2&sessionId=${SESSION_ID}`

function builderUrl(diag = false) {
	return `${ORIGIN}/v/${SESSION_ID}${QUERY}${diag ? '&diag=1' : ''}`
}

function portalsUrl() {
	return `${ORIGIN}/portals${QUERY}`
}

function verifierAppUrl(diag = false) {
	return `${ORIGIN}/s${QUERY}${diag ? '&diag=1' : ''}`
}

function extensionUrl() {
	return `${ORIGIN}/reclaim-browser-extension${QUERY}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

describe('ReclaimFlow.from', () => {
	it('accepts a bare verificationUrl string', () => {
		const flow = ReclaimFlow.from(builderUrl())
		assert.equal(flow.session, undefined)
	})

	it('accepts any object carrying a verificationUrl', () => {
		const session = { verificationUrl: builderUrl(), id: SESSION_ID }
		const flow = ReclaimFlow.from(session)
		assert.equal(flow.session, session)
	})

	it('rejects an object with no verificationUrl', async() => {
		await assert.rejects(
			// @ts-expect-error — exercising the runtime guard against bad input.
			() => ReclaimFlow.from({}).getUrl(),
		)
	})
})

describe('getUrl / resolveTarget — builder & portals', () => {
	it('builder: getUrl() returns the input URL unchanged', async() => {
		const { env } = desktopEnvironment()
		const flow = ReclaimFlow.from(builderUrl(), { environment: env })
		assert.equal(await flow.getUrl(), builderUrl())
	})

	it('resolves `new-tab` on desktop with no target element', async() => {
		const { env } = desktopEnvironment()
		const flow = ReclaimFlow.from(portalsUrl(), { environment: env })
		const target = await flow.resolveTarget()
		assert.equal(target.client, 'portals')
		assert.equal(target.mechanism, 'new-tab')
		assert.equal(target.available, true)
	})

	it('resolves `iframe` on desktop once options.target is set', async() => {
		const { env, document } = desktopEnvironment()
		const container = document.createElement('div')
		const flow = ReclaimFlow.from(portalsUrl(), {
			environment: env,
			target: container,
		})
		const target = await flow.resolveTarget()
		assert.equal(target.mechanism, 'iframe')
	})

	it('stays on `new-tab` on mobile even with options.target set', async() => {
		const { env, document } = iosEnvironment()
		const container = document.createElement('div')
		const flow = ReclaimFlow.from(portalsUrl(), {
			environment: env,
			target: container,
		})
		const target = await flow.resolveTarget()
		assert.equal(target.mechanism, 'new-tab')
	})

	it('degrades an unrecognised path to a tab, opening the URL as-is',
		async() => {
			const url = `https://custom.example/verify${QUERY}`
			const { env, openedTabs } = desktopEnvironment()
			const flow = ReclaimFlow.from(url, { environment: env })

			const target = await flow.resolveTarget()
			assert.equal(target.client, undefined)
			assert.equal(target.mechanism, 'new-tab')

			const handle = await flow.launch()
			assert.equal(openedTabs.length, 1)
			assert.equal(openedTabs[0].navigations.at(-1), url)
			handle.close()
			assert.equal(openedTabs[0].closedFlag, true)
		})
})

describe('launch() — new tab and iframe, and close()', () => {
	it('opens a fresh tab via env.open() and closes it on close()', async() => {
		const { env, openedTabs } = desktopEnvironment()
		const flow = ReclaimFlow.from(portalsUrl(), { environment: env })
		const handle = await flow.launch()

		assert.equal(openedTabs.length, 1)
		assert.equal(handle.tab, openedTabs[0])
		handle.close()
		assert.equal(openedTabs[0].closedFlag, true)
	})

	it('uses a preOpenedTab instead of opening a fresh one', async() => {
		const { env, openedTabs } = desktopEnvironment()
		const preOpenedTab = createFakeTab()
		const flow = ReclaimFlow.from(portalsUrl(), {
			environment: env,
			preOpenedTab,
		})
		const handle = await flow.launch()

		assert.equal(openedTabs.length, 0, 'no fresh tab was opened')
		assert.equal(handle.tab, preOpenedTab)
		const expectedUrl = await ReclaimFlow.from(
			portalsUrl(), { environment: env },
		).getUrl()
		assert.deepEqual(preOpenedTab.navigations, [expectedUrl])
	})

	it('embeds an iframe and removes it on close()', async() => {
		const { env, document } = desktopEnvironment()
		const container = document.createElement('div')
		const flow = ReclaimFlow.from(portalsUrl(), {
			environment: env,
			target: container,
		})
		const handle = await flow.launch()

		assert.ok(handle.iframe)
		const [embedded] = container.children
		assert.equal(embedded, handle.iframe)
		assert.equal(embedded.removed, false)
		handle.close()
		assert.equal(embedded.removed, true)
	})
})

describe('launch() — verifier-app', () => {
	it('desktop: shows a QR modal and closes it on close()', async() => {
		const { env, document } = desktopEnvironment()
		const flow = ReclaimFlow.from(verifierAppUrl(), { environment: env })
		const handle = await flow.launch()

		assert.equal(handle.target.mechanism, 'qr-modal')
		const overlay = document.elements.find(
			el => !el.removed && el.children.length > 0,
		)
		assert.ok(overlay, 'the modal overlay was appended to the document')
		handle.close()
		assert.equal(overlay?.removed, true)
	})

	it('desktop: the QR renders the actual (diag-propagated) share URL',
		async() => {
			const { env } = desktopEnvironment()
			let renderedUrl: string | undefined
			const flow = ReclaimFlow.from(verifierAppUrl(true), {
				environment: env,
				renderQr: url => {
					renderedUrl = url
				},
			})
			await flow.launch()
			assert.ok(renderedUrl)
			assert.equal(new URL(renderedUrl).searchParams.get('diag'), '1')
		})

	it('iOS + useAppClip: redirects straight to the App Clip URL', async() => {
		const { env, navigatedUrls } = iosEnvironment()
		const flow = ReclaimFlow.from(verifierAppUrl(), {
			environment: env,
			useAppClip: true,
		})
		const handle = await flow.launch()
		assert.equal(handle.target.mechanism, 'ios-app-clip')
		assert.equal(navigatedUrls.length, 1)
		assert.ok(navigatedUrls[0].startsWith('https://appclip.apple.com/'))
		// Nothing to tear down for a one-way redirect — close() is a no-op.
		assert.doesNotThrow(() => handle.close())
	})

	it('iOS default: deep-links, falls back to the App Store on timeout',
		async() => {
			const { env, navigatedUrls, scheduler } = iosEnvironment()
			const flow = ReclaimFlow.from(verifierAppUrl(), { environment: env })
			const handle = await flow.launch()

			assert.equal(handle.target.mechanism, 'ios-deep-link')
			assert.equal(navigatedUrls.length, 1)
			assert.ok(navigatedUrls[0].startsWith('reclaimverifier://'))

			scheduler.flush()
			assert.equal(navigatedUrls.length, 2)
			assert.ok(navigatedUrls[1].startsWith('itms-apps://'))
		})

	it('iOS default: no store fallback once the app opened (tab hidden)',
		async() => {
			const { env, navigatedUrls, scheduler, document } = iosEnvironment()
			const flow = ReclaimFlow.from(verifierAppUrl(), { environment: env })
			await flow.launch()

			document.fireVisibilityChange(true)
			scheduler.flush()
			assert.equal(navigatedUrls.length, 1, 'only the initial deep link')
		})

	it('iOS default: close() cancels the pending store-fallback timer',
		async() => {
			const { env, navigatedUrls, scheduler } = iosEnvironment()
			const flow = ReclaimFlow.from(verifierAppUrl(), { environment: env })
			const handle = await flow.launch()

			assert.equal(scheduler.pendingCount, 1)
			handle.close()
			assert.equal(scheduler.pendingCount, 0)
			scheduler.flush()
			assert.equal(navigatedUrls.length, 1, 'no navigation after close()')
		})

	it('android: opens the deep link, falls back to the Play Store',
		async() => {
			const {
				env, navigatedUrls, scheduler, navigator,
			} = androidEnvironment()
			const flow = ReclaimFlow.from(verifierAppUrl(), { environment: env })
			const handle = await flow.launch()

			assert.equal(handle.target.mechanism, 'android-deep-link')
			assert.equal(navigator.clipboardWrites.length, 1)

			// Top level, not a hidden iframe: Chrome on Android blocks
			// custom-scheme navigation from an iframe, so a probe fails
			// silently and never opens the app for someone who has it.
			assert.equal(navigatedUrls.length, 1)
			assert.ok(navigatedUrls[0].startsWith('reclaimverifier://'))

			// Tab never backgrounded, so the app is not installed.
			scheduler.flush()
			assert.equal(navigatedUrls.length, 2)
			assert.ok(navigatedUrls[1].startsWith('intent://'))

			// `url=` is inert on Play (it forwards only `referrer` via the
			// Install Referrer API) and is no longer emitted; `referrer=`
			// carries the encoded verification (share) URL instead.
			// A `verifier-app` session's own url is the share link, so that is
			// what the referrer carries.
			const shareUrl = verifierAppUrl()
			assert.ok(!navigatedUrls[1].includes('url='))
			assert.ok(
				navigatedUrls[1].includes(`referrer=${encodeURIComponent(shareUrl)}`),
			)

			// Round-trip: the verifier app's `_parseBuilderReferrerUri`
			// requires `Uri.tryParse(candidate).hasScheme` and
			// `queryParameters['api'] == '2'`, trying the raw referrer first.
			// Play decodes one layer of percent-encoding off the referrer
			// before handing it to the app, so simulate that single decode
			// here rather than parsing our own encoded output directly — the
			// assertion that matters is that what the *app* would see after
			// Play's decode still satisfies its parsing rule.
			const referrerMatch = /referrer=([^&#]+)/.exec(navigatedUrls[1])
			assert.ok(referrerMatch)
			const asPlayWouldDeliverIt = decodeURIComponent(referrerMatch[1])
			const parsed = new URL(asPlayWouldDeliverIt)
			assert.ok(parsed.protocol.length > 0, 'has a scheme')
			assert.equal(parsed.searchParams.get('api'), '2')

			// close() after the mechanism already resolved is a harmless no-op.
			handle.close()
		})

	it('android: close() cancels the pending Play Store fallback',
		async() => {
			const { env, scheduler, navigatedUrls } = androidEnvironment()
			const flow = ReclaimFlow.from(verifierAppUrl(), { environment: env })
			const handle = await flow.launch()

			assert.equal(scheduler.pendingCount, 1)
			handle.close()
			assert.equal(scheduler.pendingCount, 0)

			// Only the deep link happened — closing must not strand the
			// claimant on the Play Store afterwards.
			scheduler.flush()
			assert.equal(navigatedUrls.length, 1)
		})

	it('android: canUseDeferredDeepLinksFlow: false is a plain redirect',
		async() => {
			const { env, navigatedUrls } = androidEnvironment()
			const flow = ReclaimFlow.from(verifierAppUrl(), {
				environment: env,
				canUseDeferredDeepLinksFlow: false,
			})
			const handle = await flow.launch()
			assert.equal(handle.target.mechanism, 'android-deep-link')
			assert.equal(navigatedUrls.length, 1)
			// Straight to the session's own share url — no market intent, no
			// clipboard, no probe.
			assert.equal(navigatedUrls[0], verifierAppUrl())
		})
})

describe('launch() — reclaim-browser-extension', () => {
	it('hands the session off and cancels it via close()', async() => {
		const { env, window } = desktopEnvironment()
		const flow = ReclaimFlow.from(extensionUrl(), { environment: env })

		const launchPromise = flow.launch()
		// Answer the availability probe the resolve step runs first.
		const [probeMessage] = window.sentMessages
		assert.ok(isRecord(probeMessage))
		window.dispatchMessage({
			action: RECLAIM_EXTENSION_RESPONSE,
			messageId: probeMessage.messageId,
			installed: true,
		})

		const handle = await launchPromise
		assert.equal(handle.target.mechanism, 'extension-handoff')

		const [, startMessage] = window.sentMessages
		assert.ok(isRecord(startMessage))
		assert.equal(startMessage.action, RECLAIM_START_VERIFICATION)
		assert.ok(
			isRecord(startMessage.data) && isRecord(startMessage.data.builder),
		)
		assert.equal('verificationClientId' in startMessage.data.builder, false)

		handle.close()
		const [, , cancelMessage] = window.sentMessages
		assert.ok(isRecord(cancelMessage))
		assert.equal(cancelMessage.action, RECLAIM_CANCEL_VERIFICATION)
	})

	it('rejects distinguishably when no extension answers', async() => {
		const { env, scheduler } = desktopEnvironment()
		const flow = ReclaimFlow.from(extensionUrl(), {
			environment: env,
			extensionTimeout: 50,
		})

		const launchPromise = flow.launch()
		scheduler.flush()

		await assert.rejects(launchPromise, (error: unknown) => {
			assert.ok(isReclaimFlowUnavailableError(error))
			assert.equal(error.reason, 'extension-not-found')
			return true
		})
	})

	it('rejects distinguishably on a phone, without even probing', async() => {
		const { env, window } = iosEnvironment()
		const flow = ReclaimFlow.from(extensionUrl(), { environment: env })

		await assert.rejects(flow.launch(), (error: unknown) => {
			assert.ok(isReclaimFlowUnavailableError(error))
			assert.equal(error.reason, 'mobile-device')
			return true
		})
		assert.equal(window.sentMessages.length, 0, 'never probed on a phone')
	})

	it('rejects distinguishably when useBrowserExtension is false', async() => {
		const { env, window } = desktopEnvironment()
		const flow = ReclaimFlow.from(extensionUrl(), {
			environment: env,
			useBrowserExtension: false,
		})

		await assert.rejects(flow.launch(), (error: unknown) => {
			assert.ok(isReclaimFlowUnavailableError(error))
			assert.equal(error.reason, 'extension-disabled')
			return true
		})
		assert.equal(window.sentMessages.length, 0)
	})

	it('resolveTarget() reports unavailable without throwing', async() => {
		const { env, scheduler } = desktopEnvironment()
		const flow = ReclaimFlow.from(extensionUrl(), {
			environment: env,
			extensionTimeout: 50,
		})
		const resolvePromise = flow.resolveTarget()
		scheduler.flush()
		const target = await resolvePromise
		assert.equal(target.available, false)
		assert.equal(target.reason, 'extension-not-found')
	})
})

describe('setOptions', () => {
	it('merges options for later calls and is chainable', async() => {
		const { env } = desktopEnvironment()
		const flow = ReclaimFlow.from(portalsUrl(), { environment: env })
			.setOptions({ portalUrl: 'https://portal.example.test' })
		const url = await flow.getUrl()
		assert.equal(new URL(url).origin, 'https://portal.example.test')
	})
})
