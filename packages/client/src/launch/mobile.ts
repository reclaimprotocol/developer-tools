/**
 * The `verifier-app` target's mobile mechanisms, ported from the reference
 * JS SDK's `redirectToAppClip`/`redirectToiOSApp`/`redirectToInstantApp`
 * (`Reclaim.ts` ~1663/~1752/~1773). Per the launch-API plan's mechanism
 * table (not the reference SDK's own branching, which folds iOS into an
 * Android-shaped fallback in one corner case the plan doesn't carry over):
 *
 *  - iOS is exactly two mechanisms: `useAppClip` picks the App Clip, its
 *    absence picks the `reclaimverifier://` deep link with a 3s App Store
 *    fallback. Both redirect the current tab — there's no popup on a phone.
 *  - Android mirrors it: clipboard write, top-level `reclaimverifier://`
 *    navigation, Play Store market-intent fallback if the tab never
 *    backgrounds. Unless `canUseDeferredDeepLinksFlow` is false, in which
 *    case it's a plain redirect to the share URL.
 *
 * All delays go through `env.setTimeout`/`env.clearTimeout` (see
 * ./environment.ts), so tests exercise the fallback paths with a fake
 * scheduler instead of waiting on real 1.5s/3s timers.
 */
import type { LaunchEnvironment } from './environment.ts'

/** How long to wait for the OS to hand off to the app before deciding it is
 *  not installed and sending the claimant to the Play Store. The tab
 *  backgrounding is the only signal a page gets, and it arrives quickly when
 *  it arrives at all. */
const ANDROID_STORE_FALLBACK_MS = 1500

export interface MobileRedirectHandle {
	close(): void
}

function writeClipboardBestEffort(env: LaunchEnvironment, text: string): void {
	env.navigator?.clipboard?.writeText(text)?.catch(() => {
		// Clipboard access can be denied (permissions, insecure context); the
		// deep link/store redirect below is the fallback either way.
	})
}

/** iOS, `useAppClip: true`. A one-way redirect — nothing to probe or fall
 *  back from, so `close()` is a no-op. */
export function redirectToAppClip(
	env: LaunchEnvironment,
	appClipUrl: string,
): MobileRedirectHandle {
	env.navigate(appClipUrl)
	return { close() {} }
}

/** iOS, `useAppClip: false` (the default): try the custom-scheme deep link,
 *  fall back to the App Store after 3s if the tab never backgrounded (i.e.
 *  the OS never handed off to the app). */
export function redirectToIosDeepLink(
	env: LaunchEnvironment,
	options: { deepLinkUrl: string, storeUrl: string },
): MobileRedirectHandle {
	writeClipboardBestEffort(env, options.deepLinkUrl)

	let appOpened = false
	const onVisibilityChange = () => {
		if(env.document?.hidden) {
			appOpened = true
		}
	}

	env.document?.addEventListener(
		'visibilitychange', onVisibilityChange, { once: true },
	)
	env.navigate(options.deepLinkUrl)

	const timeoutHandle = env.setTimeout(() => {
		env.document?.removeEventListener('visibilitychange', onVisibilityChange)
		if(!appOpened) {
			env.navigate(options.storeUrl)
		}
	}, 3000)

	return {
		close() {
			env.document?.removeEventListener('visibilitychange', onVisibilityChange)
			env.clearTimeout(timeoutHandle)
		},
	}
}

/** Android. `canUseDeferredDeepLinksFlow` (default `true`) gates the
 *  clipboard-write + hidden-iframe probe + Play Store market-intent
 *  fallback; `false` is a plain redirect to the share URL. */
export function redirectToAndroid(
	env: LaunchEnvironment,
	options: {
		deepLinkUrl: string
		marketIntentUrl: string
		shareUrl: string
		canUseDeferredDeepLinksFlow: boolean
	},
): MobileRedirectHandle {
	if(!options.canUseDeferredDeepLinksFlow) {
		env.navigate(options.shareUrl)
		return { close() {} }
	}

	writeClipboardBestEffort(env, options.shareUrl)

	// Navigate the tab straight at the custom scheme, rather than probing it
	// from a hidden iframe first. Chrome on Android has blocked custom-scheme
	// navigation from an iframe for years — it fails silently, so the probe
	// never opened the app and the Play Store fallback did all the work, even
	// for someone who already had the app installed. A top-level navigation
	// is the only thing the OS acts on, and it is what the iOS branch above
	// has always done.
	let appOpened = false
	const onVisibilityChange = () => {
		if(env.document?.hidden) {
			appOpened = true
		}
	}

	env.document?.addEventListener(
		'visibilitychange', onVisibilityChange, { once: true },
	)
	env.navigate(options.deepLinkUrl)

	// Still here, still visible: the scheme resolved to nothing, so the app is
	// not installed. Send them to the Play Store, carrying the referrer that
	// survives the install.
	const timeoutHandle = env.setTimeout(() => {
		env.document?.removeEventListener('visibilitychange', onVisibilityChange)
		if(!appOpened) {
			env.navigate(options.marketIntentUrl)
		}
	}, ANDROID_STORE_FALLBACK_MS)

	return {
		close() {
			env.document?.removeEventListener('visibilitychange', onVisibilityChange)
			env.clearTimeout(timeoutHandle)
		},
	}
}

/** Builds the Play Store market-intent fallback URL, ported from
 *  `redirectToInstantApp`'s `deepLink` construction.
 *
 *  The legacy JS SDK put the verification URL in `url=`. Play never read it —
 *  Play forwards exactly one parameter to the installed app, `referrer`, via
 *  the Install Referrer API, so `url=` has always been inert and only the
 *  clipboard carried a deferred install across the Play Store. This emits
 *  `referrer=` instead, which `reclaim-verifier-app`'s
 *  `checkInstallReferrerForLink` (`lib/widgets/link_handler.dart`) now reads
 *  via `PlayInstallReferrer.installReferrer`. `url=` is dropped rather than
 *  kept alongside `referrer=`: nothing in this codebase or the verifier app
 *  reads it (the app has no `queryParameters['url']` handling anywhere), so
 *  it would be dead weight carried forward for no reason.
 *
 *  Exactly one layer of `encodeURIComponent` is applied to `shareUrl` here:
 *   - `referrer` is itself a query-string value inside this intent URI, so it
 *     needs at least one layer to survive the `?`/`&`/`=` characters in
 *     `shareUrl` without corrupting the outer intent.
 *   - Play decodes exactly one layer of percent-encoding off the referrer
 *     string before handing it to the app — the app's
 *     `_parseBuilderReferrerUri` documents this and tries the raw string
 *     first. One layer here round-trips to the literal share URL on the
 *     other side. The app also falls back to `Uri.decodeFull` if the raw
 *     string doesn't parse, tolerating an extra layer either way, but this
 *     is deliberately exactly one layer rather than leaning on that
 *     fallback.
 *
 *  Play truncates the referrer string at roughly 1KB. A Builder verification
 *  URL is a UUID and two query parameters, comfortably under that — which is
 *  what makes this viable where the legacy SDK's base64 `template=` payload
 *  never could be (see the launch-api plan's "Install Referrer beats the
 *  clipboard"). Keep the clipboard write in `redirectToAndroid` regardless:
 *  it is still the only carrier for an install that did not come through
 *  Play, and the app still reads it. */
export function buildAndroidMarketIntentUrl(
	shareUrl: string,
	androidDeepLinkPackage: string,
): string {
	const encodedShareUrl = encodeURIComponent(shareUrl)
	return `intent://details?id=${androidDeepLinkPackage}`
		+ `&referrer=${encodedShareUrl}`
		+ '#Intent;scheme=market;action=android.intent.action.VIEW;'
		+ 'package=com.android.vending;end;'
}
