/**
 * The `reclaim-browser-extension` target's mechanism: no navigation, just a
 * `window.postMessage` handshake with the content script the extension
 * injects into every page. Speaks the protocol directly rather than
 * depending on `@reclaimprotocol/browser-extension-sdk` (a second SDK for a
 * ping and a handoff).
 *
 * Action constants match `reclaim-browser-extension-sdk/src/utils/constants/
 * interfaces.js`'s `RECLAIM_SDK_ACTIONS`. The extension now supplies its own
 * Verification Client id (`reclaim-browser-extension-sdk` commit b2f35fa —
 * "the extension is always the `reclaim-browser-extension` client, so it
 * supplies its own id rather than trusting the page for one"), so the
 * `RECLAIM_START_VERIFICATION` payload below deliberately does NOT carry
 * one: a page handing the extension a different client's id would leave a
 * session recorded against a codebase that never ran it.
 */
import type { LaunchEnvironment } from './environment.ts'

export const RECLAIM_EXTENSION_CHECK = 'RECLAIM_EXTENSION_CHECK'
export const RECLAIM_EXTENSION_RESPONSE = 'RECLAIM_EXTENSION_RESPONSE'
export const RECLAIM_START_VERIFICATION = 'RECLAIM_START_VERIFICATION'
export const RECLAIM_CANCEL_VERIFICATION = 'RECLAIM_CANCEL_VERIFICATION'

export interface ExtensionHandoff {
	sessionId: string
	diag: boolean
	extensionID?: string
}

/** `postMessage` target for the page's own window, where the extension's
 *  content script listens: only a receiver on this page's origin gets the
 *  session id, never a frame or opener on another origin. */
const SAME_ORIGIN = '/'

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

/** Probes for the extension with a short-lived `postMessage` round trip.
 *  Resolves `false` on timeout, on no `window`, or if nothing answers —
 *  never rejects. */
export function probeExtension(
	env: LaunchEnvironment,
	options: { extensionID?: string, extensionTimeout?: number } = {},
): Promise<boolean> {
	const win = env.window
	if(!win) {
		return Promise.resolve(false)
	}

	const extensionTimeout = options.extensionTimeout ?? 200
	const messageId = `reclaim-check-${Math.random().toString(36).slice(2)}`

	return new Promise(resolve => {
		// An arrow (not a hoisted `function`) so TypeScript's control-flow
		// analysis keeps treating `win` as defined inside this closure — a
		// nested function *declaration* can in principle be invoked before the
		// enclosing `if(!win) return` runs, so TS won't narrow through one.
		const onMessage = (event: { data: unknown }) => {
			const data = event.data
			if(
				isRecord(data)
				&& data.action === RECLAIM_EXTENSION_RESPONSE
				&& data.messageId === messageId
			) {
				env.clearTimeout(timeoutHandle)
				win.removeEventListener('message', onMessage)
				resolve(!!data.installed)
			}
		}

		const timeoutHandle = env.setTimeout(() => {
			win.removeEventListener('message', onMessage)
			resolve(false)
		}, extensionTimeout)

		win.addEventListener('message', onMessage)
		win.postMessage(
			{
				action: RECLAIM_EXTENSION_CHECK,
				extensionID: options.extensionID,
				messageId,
			},
			SAME_ORIGIN,
		)
	})
}

/** Hands the session off to the extension. No navigation, no return value —
 *  the extension runs the verification and the consumer's backend receives
 *  the callback (see the launch-API plan's "The page cannot poll" risk). */
export function sendExtensionStartVerification(
	env: LaunchEnvironment,
	handoff: ExtensionHandoff,
): void {
	env.window?.postMessage(
		{
			action: RECLAIM_START_VERIFICATION,
			messageId: handoff.sessionId,
			extensionID: handoff.extensionID,
			data: {
				builder: {
					apiVersion: '2',
					sessionId: handoff.sessionId,
					...(handoff.diag ? { diagnosticMode: true } : {}),
				},
			},
		},
		SAME_ORIGIN,
	)
}

/** Tears down the extension's in-progress verification UI. This is what
 *  `FlowHandle.close()` does for the extension-handoff mechanism — there's
 *  no tab or iframe to close instead. Does not cancel the Builder session
 *  itself (see `FlowHandle.close()`'s contract in ./flow.ts). */
export function sendExtensionCancelVerification(
	env: LaunchEnvironment,
	handoff: Pick<ExtensionHandoff, 'sessionId' | 'extensionID'>,
): void {
	env.window?.postMessage(
		{
			action: RECLAIM_CANCEL_VERIFICATION,
			messageId: handoff.sessionId,
			extensionID: handoff.extensionID,
		},
		SAME_ORIGIN,
	)
}
