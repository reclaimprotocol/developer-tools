/**
 * Local-CDP transport for the capture engine. Binds the page-level `Network.*`
 * events directly and fetches bodies via the page's `getResponseBody`. All the
 * request/response bookkeeping lives in `capture-engine.ts`, shared with the
 * app's remote-Popcorn transport.
 */
import {
	type CaptureSession,
	createCaptureEngine,
	type StartCaptureOptions,
} from './capture-engine.ts'
import type { CdpTabClient } from './client.ts'

export {
	isStaticAsset,
	isStaticAssetMime,
	stripPseudoHeaders,
} from './capture-engine.ts'
export type { CaptureSession, StartCaptureOptions } from './capture-engine.ts'

export async function startCapture(
	tab: CdpTabClient,
	opts: StartCaptureOptions = {},
): Promise<CaptureSession> {
	const engine = createCaptureEngine({
		...(opts.maxBodyBytes !== undefined && { maxBodyBytes: opts.maxBodyBytes }),
		fetchBody: tab.getResponseBody,
	})

	const unsubscribe = [
		tab.subscribe(
			'Network.requestWillBeSent', engine.onRequestWillBeSent,
		),
		tab.subscribe('Network.requestWillBeSentExtraInfo', (event) => {
			engine.mergeRequestHeaders(event.requestId, event.headers)
		}),
		tab.subscribe('Network.responseReceived', engine.onResponseReceived),
		tab.subscribe('Network.responseReceivedExtraInfo', (event) => {
			engine.mergeResponseHeaders(event.requestId, event.headers)
		}),
		tab.subscribe('Network.loadingFinished', (event) => {
			void engine.onLoadingFinished(event.requestId)
		}),
	]
	await tab.send('Network.enable', {})

	return {
		captureId: engine.captureId,
		requests: engine.requests,
		bodies: engine.bodies,
		stop: async() => {
			for(const stopListening of unsubscribe) {
				stopListening()
			}

			await tab.send('Network.disable', {}).catch(() => {})
		},
	}
}
