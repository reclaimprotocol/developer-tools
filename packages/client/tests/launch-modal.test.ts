import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { showQrModal } from '../src/launch/index.ts'
import { createFakeEnvironment } from './launch-fakes.ts'

const URL = 'https://build.reclaimprotocol.org/share/verifier-app?id=abc'

type Fixture = ReturnType<typeof createFakeEnvironment>

/** The dialog's own elements, found by the marks the layout leaves. */
function parts(fixture: Fixture) {
	const elements = fixture.document.elements
	return {
		overlay: elements.find((el) => el.style.position === 'fixed'),
		closeButton: elements.find((el) => el.attributes['aria-label'] === 'Close'),
		countdown: elements.find((el) => el.innerHTML.startsWith('Closes in')),
		progress: elements.find((el) => el.style.transition === 'width 1s linear'),
		copy: elements.find((el) => el.innerHTML === 'Copy link'),
	}
}

describe('QR dialog', () => {
	it('renders the card, the QR and a countdown', () => {
		const fixture = createFakeEnvironment()
		const handle = showQrModal(fixture.env, URL)
		const { overlay, closeButton, countdown, progress } = parts(fixture)

		assert.ok(overlay, 'an overlay covers the page')
		assert.ok(closeButton, 'the card has a close button')
		const dialog = fixture.document.elements.find(
			(el) => el.attributes.role === 'dialog',
		)
		assert.equal(dialog?.attributes['aria-modal'], 'true')
		assert.equal(dialog?.attributes['aria-label'], 'Verify with Reclaim')
		assert.equal(countdown?.innerHTML, 'Closes in 1:00')
		assert.equal(progress?.style.width, '100%')
		assert.equal(handle.remainingSeconds, 60)

		const qr = fixture.document.elements.find(
			(el) => el.innerHTML.includes('<svg') && el.innerHTML.includes('QR code'),
		)
		assert.ok(qr, 'the QR itself is rendered inline')
	})

	it('rounds a positive partial second up to one tick', () => {
		const fixture = createFakeEnvironment()
		const handle = showQrModal(fixture.env, URL, { autoCloseSeconds: 0.5 })
		assert.equal(handle.remainingSeconds, 1)
		assert.equal(parts(fixture).progress?.style.width, '100%')

		fixture.scheduler.flush()
		assert.equal(handle.remainingSeconds, 0)
		assert.equal(parts(fixture).overlay?.removed, true)
	})

	it('counts down and closes itself when the time runs out', () => {
		const fixture = createFakeEnvironment()
		let closed = 0
		const handle = showQrModal(fixture.env, URL, {
			autoCloseSeconds: 3,
			onClose: () => closed++,
		})
		assert.equal(parts(fixture).countdown?.innerHTML, 'Closes in 0:03')

		fixture.scheduler.flush()
		assert.equal(handle.remainingSeconds, 2)
		assert.equal(parts(fixture).countdown?.innerHTML, 'Closes in 0:02')
		// The bar drains in step with the count, rather than on its own clock.
		assert.match(parts(fixture).progress?.style.width ?? '', /^66\./)

		fixture.scheduler.flush()
		fixture.scheduler.flush()
		assert.equal(handle.remainingSeconds, 0)
		assert.equal(parts(fixture).overlay?.removed, true)
		assert.equal(closed, 1)
	})

	it('stays open indefinitely when asked to, and shows no timer', () => {
		const fixture = createFakeEnvironment()
		const handle = showQrModal(fixture.env, URL, { autoCloseSeconds: 0 })

		assert.equal(handle.remainingSeconds, null)
		assert.equal(parts(fixture).countdown, undefined,
			'a timer that never moves would read as broken, so there is none')
		assert.equal(parts(fixture).progress, undefined)

		// Nothing is scheduled, so time passing changes nothing.
		fixture.scheduler.flush()
		assert.equal(parts(fixture).overlay?.removed, false)

		handle.close()
		assert.equal(parts(fixture).overlay?.removed, true)
	})

	it('closes on the close button, the backdrop and Escape', () => {
		for(const shut of [
			(f: Fixture) => parts(f).closeButton?.click(),
			(f: Fixture) => parts(f).overlay?.click(),
			(f: Fixture) => f.document.fireKeydown('Escape'),
		]) {
			const fixture = createFakeEnvironment()
			let closed = 0
			showQrModal(fixture.env, URL, { onClose: () => closed++ })
			shut(fixture)
			assert.equal(parts(fixture).overlay?.removed, true)
			assert.equal(closed, 1)
		}
	})

	it('ignores a key that is not Escape', () => {
		const fixture = createFakeEnvironment()
		showQrModal(fixture.env, URL)
		fixture.document.fireKeydown('Enter')
		assert.equal(parts(fixture).overlay?.removed, false)
	})

	it('reports closing once, however many times it is closed', () => {
		const fixture = createFakeEnvironment()
		let closed = 0
		const handle = showQrModal(fixture.env, URL, { onClose: () => closed++ })
		handle.close()
		handle.close()
		parts(fixture).closeButton?.click()
		assert.equal(closed, 1)
	})

	it('stops its timer on close, so a closed dialog cannot fire again', () => {
		const fixture = createFakeEnvironment()
		let closed = 0
		showQrModal(fixture.env, URL, {
			autoCloseSeconds: 5, onClose: () => closed++,
		})
		parts(fixture).closeButton?.click()

		fixture.scheduler.flush()
		fixture.scheduler.flush()
		assert.equal(closed, 1)
	})

	it('copies the share link', () => {
		const fixture = createFakeEnvironment()
		showQrModal(fixture.env, URL)
		parts(fixture).copy?.click()
		assert.deepEqual(fixture.navigator.clipboardWrites, [URL])
	})

	it('offers the extension only when given somewhere to send people', () => {
		const withoutTip = createFakeEnvironment()
		showQrModal(withoutTip.env, URL)
		assert.ok(!withoutTip.document.elements.some(
			(el) => el.innerHTML.includes('Install extension'),
		))

		const withTip = createFakeEnvironment()
		showQrModal(withTip.env, URL, {
			extensionUrl: 'https://example.test/ext',
		})
		const tip = withTip.document.elements.find(
			(el) => el.innerHTML.includes('Install extension'),
		)
		assert.ok(tip)
		assert.match(tip.innerHTML, /rel="noopener noreferrer"/)
	})

	it('escapes a caller-supplied title and description', () => {
		const fixture = createFakeEnvironment()
		showQrModal(fixture.env, URL, { title: '<img src=x onerror=alert(1)>' })
		const injected = fixture.document.elements.some(
			(el) => el.innerHTML.includes('<img src=x'),
		)
		assert.equal(injected, false, 'the title must not reach the DOM as markup')
	})

	it('does nothing at all without a document', () => {
		const fixture = createFakeEnvironment({ hasDocument: false })
		const handle = showQrModal(fixture.env, URL)
		assert.equal(handle.remainingSeconds, null)
		handle.close()
	})
})
