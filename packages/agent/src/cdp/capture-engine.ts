/**
 * Transport-agnostic CDP Network → CapturedRequest state machine. The agent
 * (local CDP, page-level `Network.*` bindings) and the app (remote Popcorn,
 * events read off a session-filtered `event` stream) share this entire engine;
 * only how events are delivered and how a response body is fetched differ, so
 * those two are injected. See `cdp/capture.ts` and the app's
 * `capture/capture.ts` for the two thin transports that wire into it.
 */
import { randomUUID } from 'node:crypto'
import { extractGraphqlOp } from '../provider/graphql.ts'
import type { CapturedRequest } from '../provider/schema.ts'
import { BodyStore } from './eviction.ts'

/** The slice of CDP `Network.requestWillBeSent` the engine reads. Kept
 *  structural — not devtools-protocol's full event type — so a transport
 *  pinned to a different devtools-protocol version still satisfies it. */
export interface RequestWillBeSentLike {
	requestId: string
	request: {
		method: string
		url: string
		headers: Record<string, string>
		postData?: string
	}
}

/** The slice of CDP `Network.responseReceived` the engine reads. */
export interface ResponseReceivedLike {
	requestId: string
	response: {
		status: number
		mimeType: string
		encodedDataLength: number
		headers: Record<string, string>
	}
}

/** Drop HTTP/2 pseudo-headers (`:authority`, `:method`, `:path`, `:scheme`,
 *  `:status`) from a CDP header map. Chrome emits them on HTTP/2 requests,
 *  but they're a transport-layer abstraction with no place in our domain:
 *  the URL already carries authority/path/scheme, the request object carries
 *  method, and Node's `fetch` (undici) throws on any header starting with
 *  `:`. Stripping at capture time keeps every downstream consumer
 *  (`get_request`, draft, replay, proof) clean by construction. */
export function stripPseudoHeaders(
	headers: Record<string, string>,
): Record<string, string> {
	const out: Record<string, string> = {}
	for(const [k, v] of Object.entries(headers)) {
		if(!k.startsWith(':')) {
			out[k] = v
		}
	}

	return out
}

/** Extensions for static assets we never prove over — scripts, styles, fonts,
 *  images, media, source maps. A real page pulls hundreds of these; tracking
 *  them (and fetching their bodies) just bloats the request map and body store
 *  with traffic no recipe ever matches. Note: `.json` is deliberately absent —
 *  that's the API shape recipes care about. */
const STATIC_ASSET_EXTENSIONS = new Set([
	'js', 'mjs', 'cjs', 'css', 'map',
	'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp',
	'woff', 'woff2', 'ttf', 'otf', 'eot',
	'mp4', 'webm', 'mp3', 'ogg', 'wav',
])

/** True when the URL's path names a static asset (by file extension; query and
 *  hash are ignored, so `chunk.js?v=1` still counts). The capture engine drops
 *  these up front — they never carry JSON/HTML a recipe matches. */
export function isStaticAsset(url: string): boolean {
	let path: string
	try {
		path = new URL(url).pathname
	} catch{
		path = url.split(/[?#]/)[0] || url
	}

	// Extension of the last path segment only, so `/v1.2/data` isn't misread.
	const base = path.slice(path.lastIndexOf('/') + 1)
	const dot = base.lastIndexOf('.')
	if(dot <= 0) {
		return false
	}

	return STATIC_ASSET_EXTENSIONS.has(base.slice(dot + 1).toLowerCase())
}

/** Response Content-Types for static assets. The URL-extension filter misses
 *  extension-less bundler/CDN URLs (for example, `/assets/3b8f1c`), so we also
 *  drop by MIME at response time. `text/html`, `application/json`, and
 *  `text/plain` are NOT here — those are the document/API shapes recipes
 *  match. */
const STATIC_ASSET_MIME_EXACT = new Set([
	'text/css',
	'application/javascript', 'text/javascript', 'application/x-javascript',
	'application/ecmascript', 'text/ecmascript',
	'application/wasm',
	'application/font-woff', 'application/font-woff2',
	'application/vnd.ms-fontobject', 'application/x-font-ttf',
])

const STATIC_ASSET_MIME_PREFIXES = ['image/', 'font/', 'audio/', 'video/']

/** True when a response Content-Type is a static asset (scripts/styles/fonts/
 *  images/media). Parameters (`; charset=…`) and case are ignored. */
export function isStaticAssetMime(mimeType: string | undefined): boolean {
	if(!mimeType) {
		return false
	}

	const m = mimeType.toLowerCase().split(';')[0].trim()
	if(!m) {
		return false
	}

	if(STATIC_ASSET_MIME_PREFIXES.some((p) => m.startsWith(p))) {
		return true
	}

	return STATIC_ASSET_MIME_EXACT.has(m)
}

export interface CaptureSession {
	captureId: string
	requests: Map<string, CapturedRequest>
	bodies: BodyStore
	stop: () => Promise<void>
}

/** Public knobs a transport accepts; mapped into `CaptureEngineOptions`. */
export interface StartCaptureOptions {
	maxBodyBytes?: number
}

export interface CaptureEngineOptions {
	maxBodyBytes?: number
	/** Fetch a finished response body. Transport-specific: the agent calls
	 *  `Network.getResponseBody` on the page binding, the app routes the
	 *  command through its Popcorn session. */
	fetchBody: (
		requestId: string,
	) => Promise<{ body: string, base64Encoded: boolean }>
}

interface InFlight {
	requestId: string
	method: string
	url: string
	requestHeaders: Record<string, string>
	requestBody?: string
	startedAt: number
}

/** The engine state plus the handlers a transport drives. A transport feeds
 *  raw CDP events into these and exposes `captureId`/`requests`/`bodies` to
 *  its caller. */
export interface CaptureEngine {
	captureId: string
	requests: Map<string, CapturedRequest>
	bodies: BodyStore
	onRequestWillBeSent: (p: RequestWillBeSentLike) => void
	mergeRequestHeaders: (
		requestId: string,
		extra: Record<string, string>,
	) => void
	onResponseReceived: (p: ResponseReceivedLike) => void
	mergeResponseHeaders: (
		requestId: string,
		extra: Record<string, string>,
	) => void
	onLoadingFinished: (requestId: string) => Promise<void>
}

export function createCaptureEngine(opts: CaptureEngineOptions): CaptureEngine {
	const captureId = randomUUID()
	const requests = new Map<string, CapturedRequest>()
	const inFlight = new Map<string, InFlight>()
	const bodies = new BodyStore({
		maxBytes: opts.maxBodyBytes ?? 200 * 1024 * 1024,
	})
	// CDP doesn't guarantee `requestWillBeSent` arrives before
	// `requestWillBeSentExtraInfo` (same for the response pair). When extra
	// info lands first, buffer it here and drain on the matching primary
	// event. Without this, headers (Cookie, Authorization, …) get silently
	// dropped for any request whose events race in the unlucky order.
	const pendingRequestExtra = new Map<string, Record<string, string>>()
	const pendingResponseExtra = new Map<string, Record<string, string>>()

	return {
		captureId,
		requests,
		bodies,
		onRequestWillBeSent,
		mergeRequestHeaders,
		onResponseReceived,
		mergeResponseHeaders,
		onLoadingFinished,
	}

	/** Merge extra headers from the ...ExtraInfo events into either the
	 *  in-flight entry or the finalized captured request, whichever has
	 *  arrived. If neither exists yet (extra-info-first race), buffer the
	 *  headers and drain on the matching primary event. */
	function mergeRequestHeaders(
		requestId: string,
		extra: Record<string, string>,
	) {
		const clean = stripPseudoHeaders(extra)
		const f = inFlight.get(requestId)
		if(f) {
			f.requestHeaders = { ...f.requestHeaders, ...clean }
			return
		}

		const r = requests.get(requestId)
		if(r) {
			r.requestHeaders = { ...r.requestHeaders, ...clean }
			return
		}

		const buffered = pendingRequestExtra.get(requestId) ?? {}
		pendingRequestExtra.set(requestId, { ...buffered, ...clean })
	}

	function mergeResponseHeaders(
		requestId: string,
		extra: Record<string, string>,
	) {
		const clean = stripPseudoHeaders(extra)
		const r = requests.get(requestId)
		if(r) {
			r.responseHeaders = { ...r.responseHeaders, ...clean }
			return
		}

		const buffered = pendingResponseExtra.get(requestId) ?? {}
		pendingResponseExtra.set(requestId, { ...buffered, ...clean })
	}

	function onRequestWillBeSent(p: RequestWillBeSentLike) {
		// Static assets never match a recipe — never track them (so we don't
		// fetch their bodies or grow the store). Drop any extra-info that raced
		// ahead of this event so it can't linger.
		if(isStaticAsset(p.request.url)) {
			pendingRequestExtra.delete(p.requestId)
			return
		}

		const f: InFlight = {
			requestId: p.requestId,
			method: p.request.method,
			url: p.request.url,
			requestHeaders: stripPseudoHeaders(p.request.headers),
			startedAt: Date.now(),
		}
		if(p.request.postData !== undefined) {
			f.requestBody = p.request.postData
		}

		// Drain any extra-info that arrived before us.
		const buffered = pendingRequestExtra.get(p.requestId)
		if(buffered) {
			f.requestHeaders = { ...f.requestHeaders, ...buffered }
			pendingRequestExtra.delete(p.requestId)
		}

		inFlight.set(p.requestId, f)
	}

	function onResponseReceived(p: ResponseReceivedLike) {
		const f = inFlight.get(p.requestId)
		if(!f) {
			// No in-flight entry → the request was skipped (for example, a static
			// asset) or never seen. Discard any buffered response extra-info so a
			// skipped asset can't leave a dangling entry.
			pendingResponseExtra.delete(p.requestId)
			return
		}

		// Second-line asset filter by Content-Type: catches extension-less
		// bundler/CDN URLs the request-time URL filter can't. Forget the
		// in-flight entry so it never reaches `requests` and a later
		// loadingFinished/extra-info for it becomes a no-op.
		if(isStaticAssetMime(p.response.mimeType)) {
			inFlight.delete(p.requestId)
			pendingResponseExtra.delete(p.requestId)
			return
		}

		const captured: CapturedRequest = {
			requestId: p.requestId,
			method: f.method,
			url: f.url,
			status: p.response.status,
			contentType: p.response.mimeType,
			size: p.response.encodedDataLength,
			requestHeaders: f.requestHeaders,
			responseHeaders: stripPseudoHeaders(p.response.headers),
			finishedAt: 0,
		}

		// Drain any response extra-info that arrived before us.
		const bufferedResp = pendingResponseExtra.get(p.requestId)
		if(bufferedResp) {
			captured.responseHeaders = {
				...captured.responseHeaders,
				...bufferedResp,
			}
			pendingResponseExtra.delete(p.requestId)
		}

		if(f.requestBody !== undefined) {
			captured.requestBody = f.requestBody
		}

		const op = extractGraphqlOp(f.requestBody)
		if(op !== undefined) {
			captured.graphqlOp = op
		}

		requests.set(p.requestId, captured)
	}

	async function onLoadingFinished(requestId: string) {
		const r = requests.get(requestId)
		if(!r) {
			return
		}

		try {
			const { body, base64Encoded } = await opts.fetchBody(requestId)
			const text = base64Encoded
				? Buffer.from(body, 'base64').toString('utf8')
				: body
			bodies.set(requestId, text)
			r.responseBody = text
			r.finishedAt = Date.now()
		} catch{
			// Body might be unavailable for
			// some content-types (for example, websocket). Skip.
		}
	}
}
