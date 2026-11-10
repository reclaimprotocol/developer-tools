/**
 * Injectable environment port for browser globals.
 *
 * The reference JS SDK's `device.ts` reads `navigator`/`window` at *import*
 * time, which breaks under SSR and makes device detection untestable
 * without stubbing real globals — forbidden by `packages/client/AGENTS.md`,
 * and this package has no DOM test library. Every function under
 * `src/launch/` takes a `LaunchEnvironment` instead of touching a global
 * directly, and `defaultEnvironment()` — the only place real globals are
 * read — is called lazily by `ReclaimFlow.from()`, never at module scope.
 *
 * The port only exposes the narrow surface launch code needs, typed with
 * our own interfaces rather than lib "dom" types. This file deliberately
 * does NOT `/// <reference lib="dom" />` (unlike Builder's own browser code,
 * which can): `packages/client`'s `tsconfig.json` compiles this whole
 * package as one program, including Node-oriented files like
 * `verify-tee.ts` that type `crypto.subtle` against `node:crypto`'s
 * `webcrypto.SubtleCrypto`. Pulling in the "dom" lib anywhere merges its
 * *global* `SubtleCrypto` (and `Response`/`Headers`/etc.) declarations into
 * the same program, and the DOM lib's `SubtleCrypto` has since grown
 * post-quantum KEM methods Node's typings don't — breaking that unrelated
 * file. Instead, the `declare global` block below adds ambient `window`/
 * `document`/`navigator` typed narrowly and exactly to what this port
 * needs, so real browser globals type-check with no cast and no leakage of
 * anything else "dom" would bring in.
 */

/** A `MessageEvent`-shaped value, narrowed to what the extension handshake
 *  and popup-blocking checks read. */
export interface LaunchMessageEvent {
	data: unknown
	origin?: string
}

export interface LaunchUserAgentData {
	mobile?: boolean
	platform?: string
}

export interface LaunchClipboard {
	writeText(text: string): Promise<void>
}

export interface LaunchNavigator {
	userAgent: string
	maxTouchPoints?: number
	/** Chromium's low-entropy User-Agent Client Hints. Absent on every
	 *  WebKit browser (all of iOS) and on Firefox — an augmenting signal
	 *  only, never the sole basis for a decision. */
	userAgentData?: LaunchUserAgentData
	clipboard?: LaunchClipboard
}

export interface LaunchMediaQueryResult {
	matches: boolean
}

export interface LaunchCss {
	supports?(property: string, value: string): boolean
}

/** Only the inline-style properties `src/launch/` actually sets (the QR
 *  modal's chrome, and the hidden iframes used to probe mobile deep links).
 *  Every name here matches a real `CSSStyleDeclaration` property 1:1, so a
 *  real element's `.style` satisfies this without a cast. */
export interface LaunchStyleDeclaration {
	width?: string
	height?: string
	border?: string
	display?: string
	position?: string
	inset?: string
	alignItems?: string
	justifyContent?: string
	background?: string
	zIndex?: string
	color?: string
	borderRadius?: string
	padding?: string
	maxWidth?: string
	textAlign?: string
	fontFamily?: string
	fontSize?: string
	fontWeight?: string
	margin?: string
	marginBottom?: string
	marginLeft?: string
	marginTop?: string
	cursor?: string
	top?: string
	right?: string
	boxShadow?: string
	boxSizing?: string
	lineHeight?: string
	overflow?: string
	transition?: string
	textDecoration?: string
	backgroundColor?: string
	gap?: string
}

/** Only the one field the QR modal's backdrop handler reads, to tell a click
 *  on the backdrop from one that bubbled out of the card. */
export interface LaunchMouseEvent {
	readonly target?: unknown
}

/**
 * Minimal surface of an element this package creates and mutates (an
 * embedded iframe, a QR container, or the QR modal's own chrome). `src` is
 * optional — only the iframes need it, plain containers/buttons don't have
 * it at all — so a real `HTMLElement` (not just `HTMLIFrameElement`)
 * satisfies this without a cast.
 */
export interface LaunchElement {
	src?: string
	innerHTML: string
	readonly style: LaunchStyleDeclaration
	setAttribute(name: string, value: string): void
	appendChild(el: LaunchElement): void
	addEventListener(
		type: 'click', listener: (event?: LaunchMouseEvent) => void,
	): void
	removeEventListener(
		type: 'click', listener: (event?: LaunchMouseEvent) => void,
	): void
	remove(): void
}

/** A container `launch()` embeds an iframe into — `options.target`. A real
 *  `HTMLElement` satisfies this. */
export interface LaunchContainer {
	appendChild(el: LaunchElement): void
}

/** A window/tab this package opened or was handed pre-opened. A real
 *  `Window` returned by `window.open()` does not have `navigate()`, so
 *  `defaultEnvironment()` wraps it — see below. */
export interface LaunchWindowHandle {
	readonly location: { href: string }
	readonly closed?: boolean
	navigate(url: string): void
	close(): void
}

export interface LaunchDocumentBody {
	appendChild(el: LaunchElement): void
}

/** Only the one field the QR modal's Escape handler reads. */
export interface LaunchKeyboardEvent {
	readonly key: string
}

export interface LaunchDocument {
	readonly hidden?: boolean
	createElement(tagName: string): LaunchElement
	querySelector(selector: string): unknown
	/** Null only in the (practically unreachable, for code that only runs
	 *  after DOM APIs already exist) case that the document has no body yet. */
	readonly body: LaunchDocumentBody | null
	addEventListener(
		type: 'visibilitychange',
		listener: () => void,
		options?: { once?: boolean },
	): void
	/** `keydown` is here only so the QR modal can close on Escape. */
	addEventListener(
		type: 'keydown',
		listener: (event: LaunchKeyboardEvent) => void,
	): void
	removeEventListener(type: 'visibilitychange', listener: () => void): void
	removeEventListener(
		type: 'keydown',
		listener: (event: LaunchKeyboardEvent) => void,
	): void
}

export interface LaunchWindow {
	innerWidth?: number
	innerHeight?: number
	devicePixelRatio?: number
	screen?: { width?: number, height?: number }
	/** Presence (any value, including `undefined`) signals touch-event
	 *  support — mirrors the reference SDK's `'ontouchstart' in window`. */
	ontouchstart?: unknown
	DeviceMotionEvent?: { requestPermission?(): Promise<string> }
	DeviceOrientationEvent?: unknown
	orientation?: unknown
	CSS?: LaunchCss
	matchMedia?(query: string): LaunchMediaQueryResult | null | undefined
	addEventListener(
		type: 'message',
		listener: (event: LaunchMessageEvent) => void,
	): void
	removeEventListener(
		type: 'message',
		listener: (event: LaunchMessageEvent) => void,
	): void
	postMessage(message: unknown, targetOrigin: string): void
}

export interface LaunchEnvironment {
	window?: LaunchWindow
	document?: LaunchDocument
	navigator?: LaunchNavigator
	/** Opens a URL in a new tab/window (`window.open`). Returns `null` when
	 *  blocked or unavailable — the same contract as the real DOM method. */
	open(
		url?: string, target?: string, features?: string,
	): LaunchWindowHandle | null
	/** Navigates the current tab (`window.location.href = url`) — used for
	 *  the mobile deep-link/App-Clip/store redirects, which happen in the
	 *  claimant's own tab, not a popup. */
	navigate(url: string): void
	/** Real `setTimeout`/`clearTimeout` by default. Injectable so tests can
	 *  fake the 500ms about:blank recovery check, the extension probe
	 *  timeout, and the mobile store-fallback delays without waiting on
	 *  real wall-clock timers or stubbing the global timer functions. */
	setTimeout(handler: () => void, delayMs: number): unknown
	clearTimeout(handle: unknown): void
}

/**
 * The real global `window`'s shape, exactly as far as this file's own
 * `open()`/`navigate()` need — a superset of `LaunchWindow` (which is what
 * the rest of `src/launch/` sees through `LaunchEnvironment.window`) by
 * `location`/`open`. See the file header for why this is declared here
 * rather than obtained via `/// <reference lib="dom" />`.
 */
interface GlobalWindow extends LaunchWindow {
	location: { href: string }
	open(
		url?: string, target?: string, features?: string,
	): GlobalWindowHandle | null
}

interface GlobalWindowHandle {
	location: { href: string }
	closed: boolean
	close(): void
}

declare global {
	// `navigator` is NOT declared here: `@types/node/web-globals/navigator.d.ts`
	// already declares a global `navigator` (a narrower ambient `Navigator` —
	// no "dom"/"webworker" lib loaded, per the file header — with only
	// `userAgent`/`platform`/etc), and TypeScript requires every declaration
	// of the same ambient `var` to share one identical type. `window`/
	// `document` aren't pre-declared anywhere in this program, so those two
	// are safe to introduce narrowly here.

	var window: GlobalWindow | undefined

	var document: LaunchDocument | undefined
}

/**
 * Reads the browser-only extras (`userAgentData`, `maxTouchPoints`,
 * `clipboard`) off the real `navigator` global through a loosely-typed bag
 * rather than widening `@types/node`'s fixed ambient `Navigator` type (see
 * the `declare global` comment above) or asserting `nav` itself to
 * `any`/`unknown`. A real browser's `navigator` has all of these; Node's
 * ambient type just doesn't say so.
 */
function wrapNavigator(nav: Navigator): LaunchNavigator {
	const extras = nav as {
		userAgentData?: LaunchUserAgentData
		maxTouchPoints?: number
		clipboard?: LaunchClipboard
	}

	return {
		get userAgent() {
			return nav.userAgent
		},
		get maxTouchPoints() {
			return extras.maxTouchPoints
		},
		get userAgentData() {
			return extras.userAgentData
		},
		get clipboard() {
			return extras.clipboard
		},
	}
}

/**
 * The real browser globals, wrapped to satisfy `LaunchEnvironment`. Reads
 * `window`/`document`/`navigator` only when called — never at module scope
 * — so importing `src/launch/` has no effect under SSR.
 */
export function defaultEnvironment(): LaunchEnvironment {
	const win = typeof window === 'undefined' ? undefined : window

	return {
		window: win,
		document: typeof document === 'undefined' ? undefined : document,
		navigator: typeof navigator === 'undefined'
			? undefined
			: wrapNavigator(navigator),
		open(url, target, features) {
			const handle = win?.open(url, target, features)
			if(!handle) {
				return null
			}

			return {
				get location() {
					return handle.location
				},
				get closed() {
					return handle.closed
				},
				navigate(u) {
					handle.location.href = u
				},
				close() {
					handle.close()
				},
			}
		},
		navigate(url) {
			if(win) {
				win.location.href = url
			}
		},
		setTimeout(handler, delayMs) {
			return setTimeout(handler, delayMs)
		},
		clearTimeout(handle) {
			// `handle` is always something this same `setTimeout` returned.
			clearTimeout(handle as Parameters<typeof clearTimeout>[0])
		},
	}
}
