import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import { startCapture } from '../src/cdp/capture.ts'
import type { CdpTabClient } from '../src/cdp/client.ts'

/** Minimal fake CDP client using chrome-remote-interface's raw `event` stream,
 *  which both local targets and flattened remote sessions expose. */
function makeFakeTab(): {
	tab: CdpTabClient
	emit: (event: string, payload: unknown) => void
} {
	const bus = new EventEmitter()
	return {
		tab: {
			send: async(method: string) => method === 'Network.getResponseBody'
				? { body: '', base64Encoded: false }
				: {},
			getResponseBody: async() => ({ body: '', base64Encoded: false }),
			subscribe(event, listener) {
				bus.on(event, listener)
				return () => bus.removeListener(event, listener)
			},
			subscribeOnce(event, listener) {
				bus.once(event, listener)
				return () => bus.removeListener(event, listener)
			},
			close: async() => {},
		},
		emit: (event, payload) => bus.emit(`Network.${event}`, payload),
	}
}

describe('capture race: extra-info before primary event', () => {
	it('merges request extra-info that arrived before requestWillBeSent',
		async() => {
			const { tab, emit } = makeFakeTab()
			const session = await startCapture(tab)

			// ExtraInfo lands first (the racy case).
			emit('requestWillBeSentExtraInfo', {
				requestId: 'r1',
				headers: { Cookie: 'session=abc', Authorization: 'Bearer x' },
			})

			// Primary event arrives later.
			emit('requestWillBeSent', {
				requestId: 'r1',
				request: {
					method: 'GET',
					url: 'https://api.example.com/me',
					headers: { Accept: 'application/json' },
				},
			})

			emit('responseReceived', {
				requestId: 'r1',
				response: {
					status: 200,
					mimeType: 'application/json',
					encodedDataLength: 0,
					headers: {},
				},
			})

			const captured = session.requests.get('r1')
			assert.ok(captured, 'expected request to be captured')
			assert.equal(
				captured.requestHeaders['Cookie'],
				'session=abc',
				'cookie from early ExtraInfo must survive into final captured request',
			)
			assert.equal(captured.requestHeaders['Authorization'], 'Bearer x')
			assert.equal(captured.requestHeaders['Accept'], 'application/json')
		}
	)

	it('merges response extra-info that arrived before responseReceived',
		async() => {
			const { tab, emit } = makeFakeTab()
			const session = await startCapture(tab)

			emit('requestWillBeSent', {
				requestId: 'r2',
				request: {
					method: 'GET',
					url: 'https://api.example.com/me',
					headers: {},
				},
			})

			// Response ExtraInfo lands before the responseReceived primary.
			emit('responseReceivedExtraInfo', {
				requestId: 'r2',
				headers: { 'set-cookie': 'k=v', 'x-trace': 'abc' },
			})

			emit('responseReceived', {
				requestId: 'r2',
				response: {
					status: 200,
					mimeType: 'application/json',
					encodedDataLength: 0,
					headers: { 'content-type': 'application/json' },
				},
			})

			const captured = session.requests.get('r2')
			assert.ok(captured)
			assert.equal(
				captured.responseHeaders['set-cookie'],
				'k=v',
				'set-cookie from early response ExtraInfo must survive',
			)
			assert.equal(captured.responseHeaders['x-trace'], 'abc')
			assert.equal(captured.responseHeaders['content-type'], 'application/json')
		}
	)

	it('still works in the normal order (primary before extra-info)', async() => {
		const { tab, emit } = makeFakeTab()
		const session = await startCapture(tab)

		emit('requestWillBeSent', {
			requestId: 'r3',
			request: {
				method: 'GET',
				url: 'https://api.example.com/me',
				headers: { Accept: '*/*' },
			},
		})

		emit('requestWillBeSentExtraInfo', {
			requestId: 'r3',
			headers: { Cookie: 'session=def' },
		})

		emit('responseReceived', {
			requestId: 'r3',
			response: {
				status: 200,
				mimeType: 'application/json',
				encodedDataLength: 0,
				headers: {},
			},
		})

		const captured = session.requests.get('r3')
		assert.ok(captured)
		assert.equal(captured.requestHeaders['Cookie'], 'session=def')
		assert.equal(captured.requestHeaders['Accept'], '*/*')
	})
})
