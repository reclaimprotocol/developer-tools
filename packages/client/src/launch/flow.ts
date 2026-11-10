/**
 * `ReclaimFlow` — the public entry point. One constructor
 * (`ReclaimFlow.from`), per the launch-API plan: no
 * `fromSession`/`fromVerificationUrl`/`fromDescriptor` family.
 *
 * `resolveTarget()`/`launch()` decide the mechanism from the URL's client
 * (see ./target.ts) and the device (see ./device.ts); `launch()` runs it
 * (./portal.ts, ./mobile.ts, ./extension.ts, ./modal.ts) and hands back a
 * `FlowHandle` that tears down whatever UI it created.
 */
import type { VerificationSession } from '../types/openapi.ts'
import { appendSessionQuery, resolveDestinationUrl } from './destination.ts'
import type { DetectionConfidence, DeviceKind } from './device.ts'
import { resolveDevice } from './device.ts'
import type {
	LaunchElement,
	LaunchEnvironment,
	LaunchWindowHandle
} from './environment.ts'
import { defaultEnvironment } from './environment.ts'
import type { ReclaimFlowUnavailableReason } from './errors.ts'
import { ReclaimFlowUnavailableError } from './errors.ts'
import {
	probeExtension,
	sendExtensionCancelVerification,
	sendExtensionStartVerification,
} from './extension.ts'
import {
	buildAndroidMarketIntentUrl,
	redirectToAndroid,
	redirectToAppClip,
	redirectToIosDeepLink,
} from './mobile.ts'
import { showQrModal } from './modal.ts'
import type { FlowOptions } from './options.ts'
import {
	DEFAULT_APP_CLIP_URL,
	DEFAULT_IOS_APP_DOWNLOAD_URL,
	DEFAULT_IOS_DEEP_LINK_BASE_URL,
	resolveAndroidAppDownloadUrl,
	resolveAndroidDeepLinkPackage,
	resolveCanUseDeferredDeepLinksFlow,
} from './options.ts'
import { embedPortalIframe, openPortalTab } from './portal.ts'
import type { ParsedFlowUrl, VerificationTarget } from './target.ts'
import { parseFlowUrl } from './target.ts'

export type { FlowOptions } from './options.ts'
export type { VerificationTarget } from './target.ts'
export type { DetectionConfidence, DeviceKind } from './device.ts'
export {
	ReclaimFlowUnavailableError,
	isReclaimFlowUnavailableError,
} from './errors.ts'
export type { ReclaimFlowUnavailableReason } from './errors.ts'

/** A `verificationUrl` string, or any object carrying one — a full
 *  `VerificationSession` satisfies it. */
export type FlowInput =
	| string
	| VerificationSession
	| { verificationUrl: string }

export type LaunchMechanism =
	| 'new-tab'
	| 'iframe'
	| 'extension-handoff'
	| 'qr-modal'
	| 'ios-app-clip'
	| 'ios-deep-link'
	| 'android-deep-link'
	| 'unavailable'

/** Which client and mechanism a flow resolves to on this device. Read-only —
 *  `resolveTarget()` changes nothing (see the plan's "Targets" section). */
export interface ResolvedTarget {
	/** The client the URL names, or `undefined` for an unrecognised path
	 *  (degrades to `mechanism: 'new-tab'`). */
	client: VerificationTarget | undefined
	device: DeviceKind
	/** Exposed so a caller can render a chooser instead of trusting a
	 *  borderline device-detection guess — see ./device.ts. */
	confidence: DetectionConfidence
	mechanism: LaunchMechanism
	/** `false` only for an extension-bound session this device can't run
	 *  (see `reason`); `launch()` rejects rather than substituting another
	 *  mechanism. */
	available: boolean
	reason?: ReclaimFlowUnavailableReason
}

export interface FlowHandle {
	/** Tears down the UI this launch created (tab/iframe/modal, or the
	 *  extension's in-progress verification). Does not cancel the session —
	 *  the Builder session outcome still arrives at the consumer's backend
	 *  callback. */
	close(): void
	readonly target: ResolvedTarget
	readonly iframe?: LaunchElement
	readonly tab?: LaunchWindowHandle | null
}

function inputVerificationUrl(input: FlowInput): string {
	const verificationUrl = typeof input === 'string'
		? input
		: input.verificationUrl
	if(!verificationUrl) {
		throw new Error(
			'ReclaimFlow.from() input must be a verificationUrl string, or '
				+ 'an object carrying one',
		)
	}

	return verificationUrl
}

export class ReclaimFlow {
	readonly #input: FlowInput
	#options: FlowOptions
	#env: LaunchEnvironment
	#parsed: ParsedFlowUrl | undefined

	private constructor(input: FlowInput, options: FlowOptions) {
		this.#input = input
		this.#options = options
		this.#env = options.environment ?? defaultEnvironment()
	}

	/** The only constructor — no `fromSession`/`fromVerificationUrl`/
	 *  `fromDescriptor` family. */
	static from(input: FlowInput, options: FlowOptions = {}): ReclaimFlow {
		return new ReclaimFlow(input, options)
	}

	/** The `session`/object this flow was built from, or `undefined` when
	 *  `from()` was given a bare `verificationUrl` string. */
	get session(): VerificationSession | { verificationUrl: string } | undefined {
		return typeof this.#input === 'string' ? undefined : this.#input
	}

	/** Merges `options` for later `getUrl()`/`resolveTarget()`/`launch()`
	 *  calls. Chainable. */
	setOptions(options: FlowOptions): this {
		this.#options = { ...this.#options, ...options }
		if(options.environment) {
			this.#env = options.environment
		}

		// `verificationClientId` feeds target resolution (./target.ts), so a
		// change invalidates the cached parse.
		this.#parsed = undefined
		return this
	}

	/** Resolves the target and returns the claimant URL, without navigating. */
	async getUrl(): Promise<string> {
		const parsed = this.#parse()
		return resolveDestinationUrl(parsed.target, parsed, this.#options)
	}

	/** Which client and mechanism this flow will use on this device. A read:
	 *  reports the mechanism and changes nothing (the one exception is a
	 *  short-lived `postMessage` probe for an extension-bound session, which
	 *  navigates nothing and shows no UI). */
	async resolveTarget(): Promise<ResolvedTarget> {
		return this.#resolve()
	}

	/** Opens it. Rejects with `ReclaimFlowUnavailableError` for an
	 *  extension-bound session this device can't run, rather than silently
	 *  falling back to another mechanism. */
	async launch(): Promise<FlowHandle> {
		const resolved = await this.#resolve()
		if(!resolved.available) {
			throw new ReclaimFlowUnavailableError(
				resolved.reason ?? 'extension-not-found',
			)
		}

		return this.#execute(resolved)
	}

	#parse(): ParsedFlowUrl {
		this.#parsed ??= parseFlowUrl(
			inputVerificationUrl(this.#input),
			this.#options.verificationClientId,
		)
		return this.#parsed
	}

	async #resolve(): Promise<ResolvedTarget> {
		const parsed = this.#parse()
		const { device, confidence } = resolveDevice(this.#env)
		const client = parsed.target

		if(client === 'reclaim-browser-extension') {
			return this.#resolveExtensionTarget(client, device, confidence)
		}

		if(client === 'verifier-app') {
			let mechanism: LaunchMechanism
			if(device === 'desktop') {
				mechanism = 'qr-modal'
			} else if(device === 'ios') {
				mechanism = this.#options.useAppClip ? 'ios-app-clip' : 'ios-deep-link'
			} else {
				mechanism = 'android-deep-link'
			}

			return { client, device, confidence, mechanism, available: true }
		}

		// `builder` | `portals` | undefined (unrecognised path — degrades to a
		// tab). iframe embedding is desktop-only, per the plan's mechanism
		// table — mobile always gets a new tab even with `options.target` set.
		const wantsIframe = !!client && device === 'desktop'
			&& !!this.#options.target
		const mechanism: LaunchMechanism = wantsIframe ? 'iframe' : 'new-tab'
		return { client, device, confidence, mechanism, available: true }
	}

	async #resolveExtensionTarget(
		client: VerificationTarget,
		device: DeviceKind,
		confidence: DetectionConfidence,
	): Promise<ResolvedTarget> {
		const unavailable = (
			reason: ReclaimFlowUnavailableReason,
		): ResolvedTarget => ({
			client,
			device,
			confidence,
			mechanism: 'unavailable',
			available: false,
			reason,
		})

		if(device !== 'desktop') {
			return unavailable('mobile-device')
		}

		if(this.#options.useBrowserExtension === false) {
			return unavailable('extension-disabled')
		}

		const found = await probeExtension(this.#env, this.#options)
		if(!found) {
			return unavailable('extension-not-found')
		}

		return {
			client,
			device,
			confidence,
			mechanism: 'extension-handoff',
			available: true,
		}
	}

	#execute(resolved: ResolvedTarget): FlowHandle {
		const parsed = this.#parse()

		switch (resolved.mechanism) {
			case 'extension-handoff': {
				const handoff = {
					sessionId: parsed.sessionId ?? '',
					diag: parsed.diag,
					extensionID: this.#options.extensionID,
				}
				sendExtensionStartVerification(this.#env, handoff)
				return {
					target: resolved,
					close: () => sendExtensionCancelVerification(this.#env, handoff),
				}
			}

			case 'qr-modal': {
				const url = resolveDestinationUrl(parsed.target, parsed, this.#options)
				const modal = showQrModal(this.#env, url, {
					...this.#options.modalOptions,
					renderQr: this.#options.renderQr,
				})
				return { target: resolved, close: () => modal.close() }
			}

			case 'ios-app-clip': {
				const appClipUrl = appendSessionQuery(
					this.#options.appClipUrl ?? DEFAULT_APP_CLIP_URL,
					parsed,
				)
				const handle = redirectToAppClip(this.#env, appClipUrl)
				return { target: resolved, close: () => handle.close() }
			}

			case 'ios-deep-link': {
				const deepLinkUrl = appendSessionQuery(
					this.#options.iosDeepLinkBaseUrl ?? DEFAULT_IOS_DEEP_LINK_BASE_URL,
					parsed,
				)
				const storeUrl = this.#options.iosAppDownloadUrl
					?? DEFAULT_IOS_APP_DOWNLOAD_URL
				const handle = redirectToIosDeepLink(
					this.#env, { deepLinkUrl, storeUrl },
				)
				return { target: resolved, close: () => handle.close() }
			}

			case 'android-deep-link': {
				const shareUrl = resolveDestinationUrl(
					parsed.target, parsed, this.#options,
				)
				const deepLinkUrl = appendSessionQuery(
					this.#options.iosDeepLinkBaseUrl ?? DEFAULT_IOS_DEEP_LINK_BASE_URL,
					parsed,
				)
				const marketIntentUrl = buildAndroidMarketIntentUrl(
					shareUrl,
					resolveAndroidDeepLinkPackage(this.#options),
				)
				const handle = redirectToAndroid(this.#env, {
					deepLinkUrl,
					marketIntentUrl,
					shareUrl,
					canUseDeferredDeepLinksFlow: resolveCanUseDeferredDeepLinksFlow(
						this.#options, 'android',
					),
				})
				return { target: resolved, close: () => handle.close() }
			}

			case 'iframe': {
				const url = resolveDestinationUrl(parsed.target, parsed, this.#options)
				const container = this.#options.target
				if(!container) {
				// `#resolve()` only picks 'iframe' when `options.target` is set;
				// kept total rather than asserting, in case options changed
				// between `resolveTarget()` and `launch()`.
					return this.#openNewTab(resolved, url)
				}

				const handle = embedPortalIframe(this.#env, url, container)
				return {
					target: resolved, iframe: handle.iframe, close: () => handle.close(),
				}
			}

			case 'new-tab': {
				const url = resolveDestinationUrl(parsed.target, parsed, this.#options)
				return this.#openNewTab(resolved, url)
			}

			case 'unavailable':
				// `launch()` already rejected before calling `#execute()`.
				throw new ReclaimFlowUnavailableError(
					resolved.reason ?? 'extension-not-found',
				)
		}
	}

	#openNewTab(resolved: ResolvedTarget, url: string): FlowHandle {
		const handle = openPortalTab(this.#env, url, this.#options.preOpenedTab)
		return { target: resolved, tab: handle.tab, close: () => handle.close() }
	}
}

// Re-exported so a consumer building `androidAppDownloadUrl`/
// `androidDeepLinkPackage` defaults for display (e.g. an install-link
// banner) doesn't have to duplicate them.
export { resolveAndroidAppDownloadUrl, resolveAndroidDeepLinkPackage }
