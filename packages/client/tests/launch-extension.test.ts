import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	probeExtension,
	RECLAIM_CANCEL_VERIFICATION,
	RECLAIM_EXTENSION_CHECK,
	RECLAIM_EXTENSION_RESPONSE,
	RECLAIM_START_VERIFICATION,
	sendExtensionCancelVerification,
	sendExtensionStartVerification,
} from '../src/launch/extension.ts'
import { createFakeEnvironment } from './launch-fakes.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

describe('probeExtension', () => {
	it('resolves false when nothing answers before the timeout', async() => {
		const { env, window, scheduler } = createFakeEnvironment()
		const probe = probeExtension(env, { extensionTimeout: 200 })

		assert.equal(window.sentMessages.length, 1)
		const [sent] = window.sentMessages
		assert.ok(isRecord(sent))
		assert.equal(sent.action, RECLAIM_EXTENSION_CHECK)

		scheduler.flush()
		assert.equal(await probe, false)
	})

	it('resolves true when the extension answers before the timeout', async() => {
		const { env, window, scheduler } = createFakeEnvironment()
		const probe = probeExtension(env, { extensionTimeout: 200 })

		const [sent] = window.sentMessages
		assert.ok(isRecord(sent))
		window.dispatchMessage({
			action: RECLAIM_EXTENSION_RESPONSE,
			messageId: sent.messageId,
			installed: true,
		})

		assert.equal(await probe, true)
		// The timeout never fires because the response resolved first, but
		// nothing throws if it's flushed anyway (the listener already
		// unsubscribed).
		scheduler.flush()
	})

	it('ignores a response for a different probe\'s messageId', async() => {
		const { env, window, scheduler } = createFakeEnvironment()
		const probe = probeExtension(env, { extensionTimeout: 200 })

		window.dispatchMessage({
			action: RECLAIM_EXTENSION_RESPONSE,
			messageId: 'some-other-probe',
			installed: true,
		})
		scheduler.flush()
		assert.equal(await probe, false)
	})

	it('resolves false with no window at all', async() => {
		const { env } = createFakeEnvironment({ hasWindow: false })
		assert.equal(await probeExtension(env), false)
	})
})

describe('the extension handoff', () => {
	it('never includes a verificationClientId — the extension supplies '
		+ 'its own', () => {
		const { env, window } = createFakeEnvironment()
		sendExtensionStartVerification(env, { sessionId: 's1', diag: false })

		const [sent] = window.sentMessages
		assert.ok(isRecord(sent))
		assert.equal(sent.action, RECLAIM_START_VERIFICATION)
		assert.ok(isRecord(sent.data))
		const builderPayload = sent.data.builder
		assert.ok(isRecord(builderPayload))
		assert.equal(builderPayload.apiVersion, '2')
		assert.equal(builderPayload.sessionId, 's1')
		assert.equal('verificationClientId' in builderPayload, false)
	})

	it('propagates diag but never invents it', () => {
		const { env, window } = createFakeEnvironment()
		sendExtensionStartVerification(env, { sessionId: 's1', diag: true })
		const [sent] = window.sentMessages
		assert.ok(
			isRecord(sent) && isRecord(sent.data) && isRecord(sent.data.builder),
		)
		assert.equal(sent.data.builder.diagnosticMode, true)

		window.sentMessages.length = 0
		sendExtensionStartVerification(env, { sessionId: 's1', diag: false })
		const [sentNoDiag] = window.sentMessages
		assert.ok(
			isRecord(sentNoDiag)
				&& isRecord(sentNoDiag.data)
				&& isRecord(sentNoDiag.data.builder),
		)
		assert.equal('diagnosticMode' in sentNoDiag.data.builder, false)
	})

	it('cancel sends RECLAIM_CANCEL_VERIFICATION for the same session', () => {
		const { env, window } = createFakeEnvironment()
		sendExtensionCancelVerification(env, { sessionId: 's1' })
		const [sent] = window.sentMessages
		assert.ok(isRecord(sent))
		assert.equal(sent.action, RECLAIM_CANCEL_VERIFICATION)
		assert.equal(sent.messageId, 's1')
	})
})
