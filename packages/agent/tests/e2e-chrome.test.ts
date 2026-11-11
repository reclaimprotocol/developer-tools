// Gated Chrome CDP end-to-end test. Skipped by default — opt in with
//   npm run test:e2e
// or
//   RECLAIM_AGENT_E2E=1 node --test tests/e2e-chrome.test.ts
//
// What this covers (none of which the unit tests touch):
//   - startChrome actually starts Chrome and CDP listens on the port
//   - connectCdp / listTabs / attachToTab end-to-end
//   - startCapture's full event wiring: requestWillBeSent +
//     requestWillBeSentExtraInfo (Cookie header capture),
//     responseReceived + responseReceivedExtraInfo, loadingFinished
//     pulling the body
//   - the find tool synthesizing a candidate from the captured response
//
// Requires Chrome on the local machine. If `findChromeBinary` can't
// find one, the test self-skips rather than failing — set
// RECLAIM_AGENT_CHROME_PATH if needed.

import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { makeDraftStore } from '../src/authoring/index.ts'
import { startCapture } from '../src/cdp/capture.ts'
import type { CdpTabClient } from '../src/cdp/client.ts'
import { type CdpHandles, connectCdp } from '../src/cdp/client.ts'
import { findChromeBinary, startChrome } from '../src/cdp/launcher.ts'
import { listTabs } from '../src/cdp/tabs.ts'
import { sharedAuthoringTools } from '../src/mcp/tools/agent/shared.ts'

const RUN_E2E = process.env.RECLAIM_AGENT_E2E === '1'

let chromeAvailable = false
try {
	findChromeBinary()
	chromeAvailable = true
} catch{
	// chromeAvailable stays false; tests will skip
}

describe('Chrome CDP E2E', { skip: !RUN_E2E || !chromeAvailable }, () => {
	let chrome: ChildProcess
	let handles: CdpHandles
	let port: number
	let profileDir: string
	let origin: Server
	let originPort: number

	before(async() => {
		// Local fixture HTTP server. /api/me returns a known JSON body
		// containing the value we'll search for.
		origin = createServer((req, res) => {
			if(req.url === '/api/me') {
				res.setHeader('content-type', 'application/json')
				res.end(JSON.stringify({ login: 'alice', followers: 42 }))
				return
			}

			res.statusCode = 404
			res.end()
		})
		await new Promise<void>((r) => origin.listen(0, () => r()))
		originPort = (origin.address() as AddressInfo).port

		// Fresh dedicated profile + a debug port unlikely to collide.
		port = 49152 + Math.floor(Math.random() * 1000)
		profileDir = mkdtempSync(join(tmpdir(), 'reclaim-agent-e2e-'))
		chrome = await startChrome(findChromeBinary(), {
			port, profileDir, headless: true,
		})
		handles = await connectCdp(port)
	})

	after(async() => {
		await handles?.close().catch(() => {})
		chrome?.kill()
		await new Promise<void>((r) => origin.close(() => r()))
		// Windows briefly holds file handles after process exit; let
		// Chrome release them before rimraf. Cleanup is best-effort —
		// the temp dir gets reaped by the OS eventually.
		await new Promise((r) => setTimeout(r, 500))
		try {
			rmSync(profileDir, { recursive: true, force: true })
		} catch{
			// Ignore — temp dir lives under tmpdir() and the OS cleans up.
		}
	})

	it('captures a real navigation and finds the request by its response value',
		async() => {
			const tabs = await listTabs(port)
			const tab = tabs[0]
			assert.ok(tab, 'expected at least one tab on launch')

			const tabClient = await handles.attachToTab(tab.tabId)
			const capture = await startCapture(tabClient)

			await tabClient.send('Page.enable')

			// Wait for the API call's response body to be fetched and stored.
			const requestUrl = `http://127.0.0.1:${originPort}/api/me`
			const captured = waitForCaptured(tabClient, requestUrl, 5000)

			await tabClient.send('Page.navigate', { url: requestUrl })
			await captured

			const captures = {
				sessions: new Map([[capture.captureId, {
					session: capture, tabClient, drafts: makeDraftStore(),
				}]]),
			}
			const find = sharedAuthoringTools(captures).find(
				(t) => t.definition.name === 'find_requests_containing',
			)!
			const result = (await find.handler({
				captureId: capture.captureId,
				value: '42',
			})) as {
				candidates: Array<{
					requestId: string
					url: string
					contentType: string
				}>
			}

			assert.ok(
				result.candidates.length > 0,
				'expected ≥1 candidate request containing 42',
			)
			const top = result.candidates[0]
			assert.match(top.url, /\/api\/me$/)
			assert.match(top.contentType, /json/)

			await capture.stop()
		}
	)
})

/** Resolve when the response body for `url` has been pulled into the
 *  body store (loadingFinished + getResponseBody completed). */
function waitForCaptured(
	tab: CdpTabClient,
	url: string,
	timeoutMs: number,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`timed out waiting for ${url}`)),
			timeoutMs,
		)
		let matchedId: string | undefined
		tab.subscribe('Network.responseReceived', ({ requestId, response }) => {
			if(response.url === url) {
				matchedId = requestId
			}
		})
		tab.subscribe('Network.loadingFinished', ({ requestId }) => {
			if(requestId === matchedId) {
				clearTimeout(timer)
				// Give the async getResponseBody in startCapture a tick to
				// finish writing into the body store.
				setTimeout(resolve, 50)
			}
		})
	})
}
