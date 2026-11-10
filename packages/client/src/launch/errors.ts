/**
 * Distinguishable rejection for an extension-bound session this device can't
 * run — no extension present, or opened on a phone (the extension has no
 * mobile mechanism at all). `launch()` rejects with this rather than
 * silently falling back to another mechanism: the session names one client,
 * and switching would misattribute it (see the launch-API plan's "Launch
 * mechanisms" section).
 *
 * A plain `Error` subclass, not a `@hapi/boom` error:
 * `packages/client/AGENTS.md` requires browser-safe modules to avoid
 * `node:assert` and the Boom runtime, and `src/launch/` is loaded directly
 * into a browser bundle.
 */
export type ReclaimFlowUnavailableReason =
	| 'mobile-device'
	| 'extension-disabled'
	| 'extension-not-found'

export class ReclaimFlowUnavailableError extends Error {
	readonly name = 'ReclaimFlowUnavailableError'
	readonly reason: ReclaimFlowUnavailableReason

	constructor(reason: ReclaimFlowUnavailableReason) {
		super(reasonMessage(reason))
		this.reason = reason
	}
}

export function isReclaimFlowUnavailableError(
	error: unknown,
): error is ReclaimFlowUnavailableError {
	return error instanceof ReclaimFlowUnavailableError
}

function reasonMessage(reason: ReclaimFlowUnavailableReason): string {
	switch (reason) {
		case 'mobile-device':
			return 'This session is bound to the Reclaim browser extension, '
			+ 'which has no mobile mechanism. Open it on a desktop browser '
			+ 'instead.'
		case 'extension-disabled':
			return 'This session is bound to the Reclaim browser extension, '
			+ 'but options.useBrowserExtension is false.'
		case 'extension-not-found':
			return 'This session is bound to the Reclaim browser extension, '
			+ 'which was not found on this device. Offer the install link '
			+ 'instead.'
	}
}
