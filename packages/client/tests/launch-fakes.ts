/**
 * Fakes for `src/launch/`'s injectable `LaunchEnvironment` (see
 * `src/launch/environment.ts`). Plain objects passed through constructors —
 * never global stubs, per `packages/client/AGENTS.md`.
 */
import type {
	LaunchDocument,
	LaunchElement,
	LaunchEnvironment,
	LaunchMessageEvent,
	LaunchMouseEvent,
	LaunchNavigator,
	LaunchWindow,
	LaunchWindowHandle,
} from '../src/launch/environment.ts'

export interface FakeElement extends LaunchElement {
	tagName: string
	children: FakeElement[]
	attributes: Record<string, string>
	removed: boolean
	clickListeners: Set<(event?: LaunchMouseEvent) => void>
	click(): void
}

function createFakeElement(tagName: string): FakeElement {
	const clickListeners = new Set<(event?: LaunchMouseEvent) => void>()
	const element: FakeElement = {
		tagName,
		src: undefined,
		innerHTML: '',
		style: {},
		attributes: {},
		children: [],
		removed: false,
		clickListeners,
		setAttribute(name, value) {
			element.attributes[name] = value
		},
		appendChild(child) {
			// `appendChild`'s parameter is `LaunchElement` (the port type), but
			// every real caller in these fakes only ever hands it an element
			// this same factory created.
			element.children.push(child as FakeElement)
		},
		addEventListener(type, listener) {
			if(type === 'click') {
				clickListeners.add(listener)
			}
		},
		removeEventListener(type, listener) {
			if(type === 'click') {
				clickListeners.delete(listener)
			}
		},
		remove() {
			element.removed = true
		},
		click() {
			for(const listener of clickListeners) {
				listener({ target: element })
			}
		},
	}
	return element
}

export interface FakeScheduler {
	setTimeout(handler: () => void, delayMs: number): unknown
	clearTimeout(handle: unknown): void
	/** Fires every still-pending timer (in the order it was scheduled),
	 *  simulating "the delay elapsed" without a real wall-clock wait. */
	flush(): void
	readonly pendingCount: number
}

export function createFakeScheduler(): FakeScheduler {
	let nextId = 1
	const pending = new Map<number, () => void>()
	return {
		setTimeout(handler) {
			const id = nextId++
			pending.set(id, handler)
			return id
		},
		clearTimeout(handle) {
			pending.delete(handle as number)
		},
		flush() {
			const handlers = [...pending.values()]
			pending.clear()
			for(const handler of handlers) {
				handler()
			}
		},
		get pendingCount() {
			return pending.size
		},
	}
}

export interface FakeWindow extends LaunchWindow {
	messageListeners: Set<(event: LaunchMessageEvent) => void>
	sentMessages: unknown[]
	/** Simulates a reply arriving on this window (e.g. the extension's
	 *  content script answering a probe), without touching a real global. */
	dispatchMessage(data: unknown): void
}

export interface FakeDocument extends LaunchDocument {
	elements: FakeElement[]
	hidden: boolean
	createElement(tagName: string): FakeElement
	/** Simulates the OS handing off to a native app (the mobile deep-link
	 *  probes' visibility-change detection), without touching the real
	 *  global `document`. */
	fireVisibilityChange(hidden: boolean): void
	/** Simulates a key press reaching the document — the QR modal closes on
	 *  Escape. */
	fireKeydown(key: string): void
}

export interface FakeNavigator extends LaunchNavigator {
	clipboardWrites: string[]
}

export interface FakeOpenedTab extends LaunchWindowHandle {
	navigations: string[]
	closedFlag: boolean
}

export function createFakeTab(initialHref = 'about:blank'): FakeOpenedTab {
	const tab: FakeOpenedTab = {
		location: { href: initialHref },
		navigations: [],
		closedFlag: false,
		get closed() {
			return tab.closedFlag
		},
		navigate(url) {
			tab.navigations.push(url)
			tab.location.href = url
		},
		close() {
			tab.closedFlag = true
		},
	}
	return tab
}

export interface FakeEnvironmentOptions {
	userAgent?: string
	maxTouchPoints?: number
	userAgentData?: LaunchNavigator['userAgentData']
	innerWidth?: number
	innerHeight?: number
	devicePixelRatio?: number
	hasTouch?: boolean
	matchMedia?: (query: string) => boolean
	/** Omit to simulate an environment with no `window` (SSR). */
	hasWindow?: boolean
	/** Omit to simulate an environment with no `document`. */
	hasDocument?: boolean
	openReturnsNull?: boolean
}

export interface FakeEnvironment {
	env: LaunchEnvironment
	window: FakeWindow
	document: FakeDocument
	navigator: FakeNavigator
	scheduler: FakeScheduler
	openedTabs: FakeOpenedTab[]
	navigatedUrls: string[]
}

/** Builds a fake `LaunchEnvironment` and the underlying fakes it's made of,
 *  so a test can both drive `ReclaimFlow` and inspect what it did. */
export function createFakeEnvironment(
	options: FakeEnvironmentOptions = {},
): FakeEnvironment {
	const matchMediaFn = options.matchMedia
	const scheduler = createFakeScheduler()
	const messageListeners = new Set<(event: LaunchMessageEvent) => void>()
	const clipboardWrites: string[] = []
	const elements: FakeElement[] = []
	const openedTabs: FakeOpenedTab[] = []
	const navigatedUrls: string[] = []

	const documentBody = createFakeElement('body')

	const fakeWindow: FakeWindow = {
		innerWidth: options.innerWidth,
		innerHeight: options.innerHeight,
		devicePixelRatio: options.devicePixelRatio,
		screen: { width: options.innerWidth, height: options.innerHeight },
		...(options.hasTouch ? { ontouchstart: null } : {}),
		messageListeners,
		sentMessages: [],
		matchMedia: matchMediaFn
			? query => ({ matches: matchMediaFn(query) })
			: undefined,
		addEventListener(type, listener) {
			if(type === 'message') {
				messageListeners.add(listener)
			}
		},
		removeEventListener(type, listener) {
			if(type === 'message') {
				messageListeners.delete(listener)
			}
		},
		postMessage(message) {
			fakeWindow.sentMessages.push(message)
		},
		dispatchMessage(data) {
			for(const listener of [...messageListeners]) {
				listener({ data })
			}
		},
	}

	const visibilityListeners = new Map<() => void, { once?: boolean }>()
	const keydownListeners = new Set<(event: { key: string }) => void>()
	const fakeDocument: FakeDocument = {
		hidden: false,
		elements,
		body: documentBody,
		createElement(tagName) {
			const el = createFakeElement(tagName)
			elements.push(el)
			return el
		},
		querySelector() {
			return null
		},
		addEventListener(
			type: 'visibilitychange' | 'keydown',
			listener: never,
			listenerOptions?: { once?: boolean },
		) {
			if(type === 'visibilitychange') {
				visibilityListeners.set(listener, listenerOptions ?? {})
				return
			}

			keydownListeners.add(listener)
		},
		removeEventListener(type: 'visibilitychange' | 'keydown', listener: never) {
			if(type === 'visibilitychange') {
				visibilityListeners.delete(listener)
				return
			}

			keydownListeners.delete(listener)
		},
		fireKeydown(key) {
			for(const listener of [...keydownListeners]) {
				listener({ key })
			}
		},
		fireVisibilityChange(hidden) {
			fakeDocument.hidden = hidden
			for(const [listener, listenerOptions] of [...visibilityListeners]) {
				listener()
				if(listenerOptions.once) {
					visibilityListeners.delete(listener)
				}
			}
		},
	}

	const fakeNavigator: FakeNavigator = {
		userAgent: options.userAgent ?? '',
		maxTouchPoints: options.maxTouchPoints,
		userAgentData: options.userAgentData,
		clipboardWrites,
		clipboard: {
			async writeText(text) {
				clipboardWrites.push(text)
			},
		},
	}

	const env: LaunchEnvironment = {
		window: options.hasWindow === false ? undefined : fakeWindow,
		document: options.hasDocument === false ? undefined : fakeDocument,
		navigator: options.hasWindow === false ? undefined : fakeNavigator,
		open(url) {
			if(options.openReturnsNull) {
				return null
			}

			const tab = createFakeTab()
			openedTabs.push(tab)
			if(url) {
				tab.navigate(url)
			}

			return tab
		},
		navigate(url) {
			navigatedUrls.push(url)
		},
		setTimeout: scheduler.setTimeout,
		clearTimeout: scheduler.clearTimeout,
	}

	return {
		env,
		window: fakeWindow,
		document: fakeDocument,
		navigator: fakeNavigator,
		scheduler,
		openedTabs,
		navigatedUrls,
	}
}

/** A desktop fixture: no touch, a large screen, precise-mouse media
 *  queries, and a plain Windows-desktop-shaped user agent. */
export function desktopEnvironment(
	overrides: FakeEnvironmentOptions = {},
): FakeEnvironment {
	return createFakeEnvironment({
		userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
			+ 'AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
		innerWidth: 1440,
		innerHeight: 900,
		devicePixelRatio: 1,
		hasTouch: false,
		matchMedia: query => query === '(pointer: fine)'
			|| query === '(hover: hover)',
		...overrides,
	})
}

/** An iPhone fixture (Mobile Safari). */
export function iosEnvironment(
	overrides: FakeEnvironmentOptions = {},
): FakeEnvironment {
	return createFakeEnvironment({
		userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
			+ 'AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
		innerWidth: 390,
		innerHeight: 844,
		devicePixelRatio: 3,
		maxTouchPoints: 5,
		hasTouch: true,
		matchMedia: () => false,
		...overrides,
	})
}

/** An iPad Pro fixture that reports as a Mac (desktop Safari's UA string)
 *  but keeps touch — the reference SDK's documented special case. No
 *  `userAgentData`: UA-CH is Chromium-only, and Safari (which is what this
 *  UA string is) never sends it — unlike the Windows-laptop fixture below,
 *  there is no augmenting signal here at all. */
export function iPadReportingAsMacEnvironment(
	overrides: FakeEnvironmentOptions = {},
): FakeEnvironment {
	return createFakeEnvironment({
		userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
			+ 'AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
		innerWidth: 1024,
		innerHeight: 1366,
		devicePixelRatio: 2,
		maxTouchPoints: 5,
		hasTouch: true,
		matchMedia: () => false,
		...overrides,
	})
}

/** An Android phone fixture (Chrome Mobile). */
export function androidEnvironment(
	overrides: FakeEnvironmentOptions = {},
): FakeEnvironment {
	return createFakeEnvironment({
		userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) '
			+ 'AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
		innerWidth: 412,
		innerHeight: 915,
		devicePixelRatio: 2.6,
		maxTouchPoints: 5,
		hasTouch: true,
		userAgentData: { mobile: true, platform: 'Android' },
		matchMedia: () => false,
		...overrides,
	})
}
