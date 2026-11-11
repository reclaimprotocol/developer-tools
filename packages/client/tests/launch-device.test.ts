import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveDevice } from '../src/launch/device.ts'
import {
	androidEnvironment,
	createFakeEnvironment,
	desktopEnvironment,
	iosEnvironment,
	iPadReportingAsMacEnvironment,
} from './launch-fakes.ts'

describe('resolveDevice', () => {
	it('detects a desktop fixture with high confidence', () => {
		const { env } = desktopEnvironment()
		const result = resolveDevice(env)
		assert.equal(result.device, 'desktop')
		assert.equal(result.confidence, 'high')
	})

	it('detects an iPhone fixture as iOS with high confidence', () => {
		const { env } = iosEnvironment()
		const result = resolveDevice(env)
		assert.equal(result.device, 'ios')
		assert.equal(result.confidence, 'high')
	})

	it('detects an Android fixture as android with high confidence', () => {
		const { env } = androidEnvironment()
		const result = resolveDevice(env)
		assert.equal(result.device, 'android')
		assert.equal(result.confidence, 'high')
	})

	it('detects an iPad reporting as macOS as iOS, flagged low-confidence',
		() => {
		// The device-vs-desktop score only just crosses the mobile threshold
		// for this fixture (touch without a mouse, plus the Mac+touch special
		// case) — genuinely a device deliberately disguising itself as a
		// laptop, so a caller is right to be offered a chooser rather than a
		// silent commit even though the OS guess itself (`ios`) is correct.
			const { env } = iPadReportingAsMacEnvironment()
			const result = resolveDevice(env)
			assert.equal(result.device, 'ios')
			assert.equal(result.confidence, 'low')
		})

	it('surfaces a borderline signal set as low confidence', () => {
		// Touch with no precise mouse (+2) and a smallish screen (+2) is
		// enough to cross the mobile threshold, but with no OS-identifying
		// signal at all (no mobile keyword in the UA, no vendor-specific
		// API) the score sits right next to the cutoff rather than clearly
		// past it.
		const { env } = createFakeEnvironment({
			userAgent: 'Mozilla/5.0 (compatible)',
			innerWidth: 400,
			innerHeight: 700,
			maxTouchPoints: 5,
			hasTouch: true,
			matchMedia: () => false,
		})
		const result = resolveDevice(env)
		assert.equal(result.confidence, 'low')
	})

	it('surfaces a mobile UA with no OS signal as low confidence', () => {
		// `hasMobileUserAgent` fires (scores solidly mobile) but nothing in the
		// iOS/Android cascade matches, so the OS pick falls through to the
		// reference SDK's "assume Android" default — a guess, not a read.
		const { env } = createFakeEnvironment({
			userAgent: 'SomeMobileBrowser/1.0 mobile',
			innerWidth: 360,
			innerHeight: 640,
			maxTouchPoints: 5,
			hasTouch: true,
			matchMedia: () => false,
		})
		const result = resolveDevice(env)
		assert.equal(result.device, 'android')
		assert.equal(result.confidence, 'low')
	})

	it('assumes desktop with no window/navigator at all (SSR)', () => {
		const { env } = createFakeEnvironment({ hasWindow: false })
		const result = resolveDevice(env)
		assert.equal(result.device, 'desktop')
	})
})
