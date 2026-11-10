/**
 * `FlowOptions` — the launch-API plan's "Options" table. Option NAMES match
 * the reference JS SDK's so existing call sites port unchanged; everything
 * here is optional, and every default lives in `DEFAULT_FLOW_OPTIONS`/the
 * `resolve*Options` helpers below rather than scattered through `flow.ts`.
 */
import type {
	LaunchContainer,
	LaunchEnvironment,
	LaunchWindowHandle
} from './environment.ts'
import type { ModalOptions } from './modal.ts'
import type { RenderQr } from './qr.ts'

export interface FlowOptions {
	/** Whether to probe for the browser extension at all. Default `true`. */
	useBrowserExtension?: boolean
	/** Strict-mode match against `chrome.runtime.id`. Omitted means any
	 *  extension answers. */
	extensionID?: string
	/** Availability probe budget, in ms. Default `200`. */
	extensionTimeout?: number
	/** Portal origin; `/verify` is appended. Default
	 *  `https://portal.reclaimprotocol.org`. */
	portalUrl?: string
	/** Universal link for the verifier app. Default
	 *  `https://share.reclaimprotocol.org/verify`. */
	appLinkBaseUrl?: string
	/** iOS custom-scheme deep link base, used both for the direct iOS deep
	 *  link and (with the same custom scheme) the Android probe. Default
	 *  `reclaimverifier://org.reclaimprotocol.app`. */
	iosDeepLinkBaseUrl?: string
	/** Android package id, used to build the Play Store market-intent
	 *  fallback. Default `org.reclaimprotocol.app`. */
	androidDeepLinkPackage?: string
	/** iOS App Store fallback. Default the Reclaim Verifier App Store page. */
	iosAppDownloadUrl?: string
	/** Android Play Store fallback. Defaults to the Play Store page for
	 *  `androidDeepLinkPackage`. */
	androidAppDownloadUrl?: string
	/** Prefer the App Clip on iOS over the direct deep link. Default `false`. */
	useAppClip?: boolean
	/** App Clip destination. Default
	 *  `https://appclip.apple.com/id?p=org.reclaimprotocol.app.clip`. */
	appClipUrl?: string
	/** Android: clipboard write + deep-link probe + market-intent fallback
	 *  (`true`, the default) vs. a plain redirect to the share URL (`false`).
	 *  iOS: no effect — the iOS mechanism is chosen by `useAppClip` alone.
	 *  Defaults to `true` on Android, `false` on iOS. */
	canUseDeferredDeepLinksFlow?: boolean
	/** DOM element to embed the portal/builder page into as an iframe,
	 *  instead of opening a new tab (desktop only). */
	target?: LaunchContainer
	/** QR dialog title, description, theme, auto-close countdown, optional
	 *  extension tip, and close handler. */
	modalOptions?: ModalOptions
	/** Overrides the bundled QR renderer. */
	renderQr?: RenderQr
	/** A tab already opened via `window.open('about:blank')` inside the
	 *  click handler, so the network round trip before `launch()` doesn't
	 *  lose the user gesture a fresh `window.open` would need. */
	preOpenedTab?: LaunchWindowHandle | null
	/** Escape hatch for a staff-registered custom client whose URL doesn't
	 *  match the seeded path convention — see `./target.ts`. Never required. */
	verificationClientId?: string
	/** Overrides the real browser globals — see ./environment.ts. Tests pass
	 *  a fake; browser code never needs to set this. */
	environment?: LaunchEnvironment
}

export const DEFAULT_USE_BROWSER_EXTENSION = true
export const DEFAULT_EXTENSION_TIMEOUT_MS = 200
// `portalUrl`/`appLinkBaseUrl` defaults live in ./destination.ts, next to the
// `resolveDestinationUrl()` that's the only place they're read.
export const DEFAULT_IOS_DEEP_LINK_BASE_URL
	= 'reclaimverifier://org.reclaimprotocol.app'
export const DEFAULT_ANDROID_DEEP_LINK_PACKAGE = 'org.reclaimprotocol.app'
export const DEFAULT_IOS_APP_DOWNLOAD_URL
	= 'itms-apps://apps.apple.com/in/app/reclaim-verifier/id6503247508'
export const DEFAULT_USE_APP_CLIP = false
export const DEFAULT_APP_CLIP_URL
	= 'https://appclip.apple.com/id?p=org.reclaimprotocol.app.clip'

export function resolveAndroidAppDownloadUrl(options: FlowOptions): string {
	const androidPackage = resolveAndroidDeepLinkPackage(options)
	return options.androidAppDownloadUrl
		?? `https://play.google.com/store/apps/details?id=${androidPackage}`
}

export function resolveAndroidDeepLinkPackage(options: FlowOptions): string {
	return options.androidDeepLinkPackage ?? DEFAULT_ANDROID_DEEP_LINK_PACKAGE
}

export function resolveCanUseDeferredDeepLinksFlow(
	options: FlowOptions,
	device: 'ios' | 'android',
): boolean {
	return options.canUseDeferredDeepLinksFlow ?? (device === 'android')
}
