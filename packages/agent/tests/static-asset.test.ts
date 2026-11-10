import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isStaticAsset, isStaticAssetMime } from '../src/cdp/capture.ts'

describe('isStaticAsset', () => {
	it('skips scripts/styles/fonts/images/media (query + hash ignored)', () => {
		for(const url of [
			'https://github.githubassets.com/assets/chunk-46403-f28dc.js',
			'https://github.githubassets.com/assets/5746.module.css?v=2',
			'https://cdn.example.com/logo.png',
			'https://cdn.example.com/photo.JPEG',
			'https://cdn.example.com/icon.svg#frag',
			'https://cdn.example.com/font.woff2',
			'https://cdn.example.com/app.js.map',
			'https://cdn.example.com/clip.mp4',
		]) {
			assert.equal(isStaticAsset(url), true, url)
		}
	})

	it('keeps API/document/data traffic recipes match', () => {
		for(const url of [
			// JSON APIs are the recipe shape — never dropped.
			'https://github.com/_global-navigation/payloads.json?v=1',
			'https://api.example.com/users/me',
			'https://github.com/settings/profile',
			'https://github.com/octocat',
			// Extensionless and dotted-path-without-file cases.
			'https://example.com/v1.2/data',
			'https://example.com/',
		]) {
			assert.equal(isStaticAsset(url), false, url)
		}
	})

	it('is not fooled by a static-looking segment in the query', () => {
		// The PATH is `/api/track`; `.png` only appears in the query.
		assert.equal(
			isStaticAsset('https://example.com/api/track?ref=/logo.png'),
			false,
		)
	})
})

describe('isStaticAssetMime', () => {
	it('drops asset Content-Types (prefix + exact, params/case ignored)', () => {
		for(const m of [
			'image/png', 'image/svg+xml', 'font/woff2', 'video/mp4', 'audio/mpeg',
			'text/css', 'application/javascript; charset=utf-8',
			'TEXT/JAVASCRIPT', 'application/wasm',
		]) {
			assert.equal(isStaticAssetMime(m), true, m)
		}
	})

	it('keeps document/API Content-Types', () => {
		for(const m of [
			'text/html', 'text/html; charset=utf-8',
			'application/json', 'application/json; charset=utf-8',
			'text/plain', undefined,
		]) {
			assert.equal(isStaticAssetMime(m), false, String(m))
		}
	})
})
