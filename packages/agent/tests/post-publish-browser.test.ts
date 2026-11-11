import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	postPublishBrowserNotes,
} from '../src/provider/post-publish-browser.ts'

describe('postPublishBrowserNotes', () => {
	it('is silent when no browser remains attached', () => {
		assert.deepEqual(postPublishBrowserNotes(undefined, {
			initialUrl: 'https://example.com/login',
			hasUserScript: true,
			hasInterceptor: true,
		}), [])
	})

	it('requests an advisory retest without forcing login', () => {
		const notes = postPublishBrowserNotes({
			mode: 'container',
			browserSessionId: 'browser-1',
		}, {
			initialUrl: 'https://example.com/login',
			hasUserScript: true,
			hasInterceptor: true,
		})
		const text = notes.join(' ')

		assert.match(text, /already-authenticated path/)
		assert.match(text, /test_user_script/)
		assert.match(text, /without clearing cookies or forcing another login/)
		assert.match(text, /fresh sign-in and an already-signed-in landing/)
		assert.match(text, /advisory/)
		assert.match(text, /does not prove compatibility.*production interceptor/)
		assert.match(text, /dispose_browser/)
	})
})
