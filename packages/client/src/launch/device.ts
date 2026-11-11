/**
 * Device detection, ported from the reference JS SDK's `src/utils/device.ts`
 * (`getDeviceType`/`getMobileDeviceType`). Two differences from that source,
 * both required by the launch-API plan:
 *
 *  - Every signal is read through a `LaunchEnvironment` (see ./environment.ts)
 *    instead of module-scope `navigator`/`window`, so this is testable with
 *    plain fakes and safe to import under SSR.
 *  - The result carries a `confidence` ('high' | 'low') instead of silently
 *    committing to a guess, so a caller can render a chooser instead of
 *    assuming. `navigator.userAgentData` (Chromium's low-entropy User-Agent
 *    Client Hints) is read as an extra signal where present — it is
 *    Chromium-only and absent on every iOS browser, so it augments the
 *    heuristics below rather than replacing them, and `getHighEntropyValues`
 *    is never called (it's async and equally absent on WebKit).
 *
 * The mobile-vs-desktop scoring mirrors the reference SDK's weights exactly
 * (`CONFIDENCE_THRESHOLD = 3`); the iOS-vs-Android cascade mirrors its rule
 * order, including the iPad-reporting-as-macOS special case.
 */
import type { LaunchEnvironment, LaunchWindow } from './environment.ts'

export type DeviceKind = 'desktop' | 'ios' | 'android'
export type DetectionConfidence = 'high' | 'low'

export interface DeviceDetection {
	device: DeviceKind
	confidence: DetectionConfidence
}

/** Matches the reference SDK's mobile/desktop scoring cutoff. */
const MOBILE_SCORE_THRESHOLD = 3
/** A mobile/desktop score this close to the cutoff is a coin flip, not a
 *  confident read — surfaced as `confidence: 'low'`. */
const MOBILE_SCORE_MARGIN = 2

function safeMatchMedia(win: LaunchWindow | undefined, query: string): boolean {
	try {
		return win?.matchMedia?.(query)?.matches ?? false
	} catch{
		return false
	}
}

function safeCssSupports(
	win: LaunchWindow | undefined,
	property: string,
	value: string,
): boolean {
	try {
		return win?.CSS?.supports?.(property, value) ?? false
	} catch{
		return false
	}
}

function safeQuerySelector(env: LaunchEnvironment, selector: string): boolean {
	try {
		return !!env.document?.querySelector(selector)
	} catch{
		return false
	}
}

/** Ported scoring pass. Returns the raw mobile score — positive leans
 *  mobile, negative leans desktop. */
function scoreMobile(env: LaunchEnvironment): number {
	const win = env.window
	const nav = env.navigator
	const userAgent = (nav?.userAgent ?? '').toLowerCase()

	if(!win || !nav) {
		// SSR / no environment: the reference SDK assumes desktop.
		return -MOBILE_SCORE_THRESHOLD
	}

	let score = 0

	const screenWidth = win.innerWidth || win.screen?.width || 0
	const screenHeight = win.innerHeight || win.screen?.height || 0
	const hasSmallScreen = screenWidth <= 480 || screenHeight <= 480
	const hasLargeScreen = screenWidth > 1024 && screenHeight > 768

	const hasTouch = 'ontouchstart' in win || (nav.maxTouchPoints ?? 0) > 0
	const hasPreciseMouse = safeMatchMedia(win, '(pointer: fine)')
	const canHover = safeMatchMedia(win, '(hover: hover)')
	const hasMouseAndTouch = hasTouch && hasPreciseMouse

	const isWindowsTouchLaptop = /windows/i.test(userAgent)
		&& hasPreciseMouse && hasTouch

	if(hasTouch && !hasMouseAndTouch) {
		score += 2
	} else if(hasMouseAndTouch) {
		score += 1
	}

	if(hasSmallScreen && !isWindowsTouchLaptop) {
		score += 2
	}

	const mobileUaPattern = new RegExp(
		'android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile',
		'i',
	)
	const hasMobileUserAgent = mobileUaPattern.test(userAgent)
	if(hasMobileUserAgent) {
		score += 3
	}

	const hasMobileApis = 'orientation' in win
		|| 'DeviceMotionEvent' in win
		|| 'DeviceOrientationEvent' in win
	const isDesktopSafari = /safari/i.test(userAgent)
		&& !/mobile/i.test(userAgent)
		&& /mac|intel/i.test(userAgent)
	const mobileApisImplyMobile = hasMobileApis
		&& (hasSmallScreen || hasMobileUserAgent)
		&& !isDesktopSafari
		&& !isWindowsTouchLaptop
	if(mobileApisImplyMobile) {
		score += 2
	}

	const hasHighDpi = (win.devicePixelRatio ?? 0) > 1.5
	if(hasHighDpi && hasSmallScreen) {
		score += 1
	}

	const hasViewportMeta = safeQuerySelector(env, 'meta[name="viewport"]')
	if(hasViewportMeta && hasSmallScreen) {
		score += 1
	}

	const isPadProInDesktopMode = userAgent.includes('macintosh') && hasTouch
	if(isPadProInDesktopMode) {
		score += 2
	}

	if(hasLargeScreen && hasPreciseMouse) {
		score -= 3
	} else if(hasLargeScreen && !hasTouch) {
		score -= 2
	}

	if(hasPreciseMouse && canHover) {
		score -= 2
	}

	const isWindowsDesktop = /windows/i.test(userAgent) && !hasMobileUserAgent
	if(isWindowsDesktop) {
		score -= 3
	}

	// Chromium's low-entropy UA-CH `mobile` hint: an explicit, high-confidence
	// signal where present, applied on top of the heuristic score above rather
	// than replacing it (it's absent on WebKit/Firefox entirely).
	if(nav.userAgentData?.mobile === true) {
		score += 2
	} else if(nav.userAgentData?.mobile === false) {
		score -= 2
	}

	return score
}

interface MobileOsGuess {
	os: 'ios' | 'android'
	/** False only for the reference SDK's final fallback: no rule matched
	 *  either OS, so it defaulted to Android because that's the more common
	 *  global install base — a guess, not a read. */
	explicit: boolean
}

/** Ported iOS/Android cascade. Only called once `scoreMobile` has decided the
 *  device is mobile. */
function guessMobileOs(env: LaunchEnvironment): MobileOsGuess {
	const win = env.window
	const nav = env.navigator
	const userAgent = nav?.userAgent ?? ''
	const hasTouch = !!win
		&& ('ontouchstart' in win || (nav?.maxTouchPoints ?? 0) > 0)

	if(/iPad|iPhone|iPod/i.test(userAgent)) {
		return { os: 'ios', explicit: true }
	}

	// iPad Pro reports as a Mac (both in the UA string and in UA-CH's
	// `platform` hint) once it gains a keyboard/trackpad, but keeps touch.
	const isMacWithTouch = /Macintosh|MacIntel/i.test(userAgent) && hasTouch
	const isMacOsWithTouch = nav?.userAgentData?.platform === 'macOS' && hasTouch
	if(isMacWithTouch || isMacOsWithTouch) {
		return { os: 'ios', explicit: true }
	}

	const hasIosPermissionApi = typeof win?.DeviceMotionEvent?.requestPermission
		=== 'function'
	const hasIosTouchCallout = safeCssSupports(
		win, '-webkit-touch-callout', 'none',
	)
	if(hasIosPermissionApi || hasIosTouchCallout) {
		return { os: 'ios', explicit: true }
	}

	const isIosWebKit = /WebKit/i.test(userAgent)
		&& !/Chrome|CriOS|Android/i.test(userAgent)
		&& !/Macintosh|MacIntel/i.test(userAgent)
	if(isIosWebKit) {
		return { os: 'ios', explicit: true }
	}

	if(/Android/i.test(userAgent)) {
		return { os: 'android', explicit: true }
	}

	if(nav?.userAgentData?.platform === 'Android') {
		return { os: 'android', explicit: true }
	}

	// Final fallback: no rule matched. Android is the more common global
	// install base, but this is a guess — callers see `confidence: 'low'`.
	return { os: 'android', explicit: false }
}

/** Resolves the device this flow is running on, with a confidence a caller
 *  can act on instead of a silent guess. */
export function resolveDevice(env: LaunchEnvironment): DeviceDetection {
	const score = scoreMobile(env)
	const isMobile = score >= MOBILE_SCORE_THRESHOLD
	const borderline
		= Math.abs(score - MOBILE_SCORE_THRESHOLD) < MOBILE_SCORE_MARGIN

	if(!isMobile) {
		return { device: 'desktop', confidence: borderline ? 'low' : 'high' }
	}

	const guess = guessMobileOs(env)
	return {
		device: guess.os,
		confidence: borderline || !guess.explicit ? 'low' : 'high',
	}
}
