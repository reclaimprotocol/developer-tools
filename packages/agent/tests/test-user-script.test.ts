import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AuthoringBackend } from '../src/authoring/backend.ts'
import { authoringTools } from '../src/authoring/tools.ts'

/** A fake tab: `Page.addScriptToEvaluateOnNewDocument` records the installed
 *  source and returns an `identifier` (real CDP does too);
 *  `Page.removeScriptToEvaluateOnNewDocument` records removal by that
 *  identifier; `Page.navigate` "runs" the installed source (unless it was
 *  removed) via INDIRECT eval — global scope, like a real browser executing
 *  an injected top-level script — with `window` set on the real global so
 *  the wrapper's own nested `new Function(script)()` call (which, like the
 *  browser, resolves free variables against the realm's global scope, not
 *  the wrapper's local scope) sees the same `window`; `Runtime.evaluate`
 *  reads back from `pageState`. */
function fakeBackend(): {
	backend: AuthoringBackend
	installed: () => string
	removed: () => string[]
} {
	let installedSource: string | undefined
	let identifierSeq = 0
	const removedIds: string[] = []
	let pageState: Record<string, unknown> = {}
	const backend = {
		sendCdp: async(method: string, params?: Record<string, unknown>) => {
			if(method === 'Page.addScriptToEvaluateOnNewDocument') {
				installedSource = String(params?.source)
				return { identifier: String(++identifierSeq) }
			}

			if(method === 'Page.removeScriptToEvaluateOnNewDocument') {
				removedIds.push(String(params?.identifier))
				installedSource = undefined
				return {}
			}

			if(method === 'Page.enable') {
				return {}
			}

			if(method === 'Page.navigate') {
				pageState = {}
				const win = {
					__reclaimUserScriptResult: undefined as unknown,
					addEventListener: () => {},
				}
				const g = globalThis as unknown as { window?: unknown }
				const hadWindow = 'window' in g
				const prevWindow = g.window
				g.window = win
				try {
					if(installedSource !== undefined) {
						;(0, eval)(installedSource)
					}
				} finally {
					if(hadWindow) {
						g.window = prevWindow
					} else {
						delete g.window
					}
				}

				pageState = { window: win }
				return {}
			}

			if(method === 'Runtime.evaluate') {
				const expr = String(params?.expression)
				if(expr === 'window.__reclaimUserScriptResult') {
					const win = pageState.window as
						{ __reclaimUserScriptResult?: unknown } | undefined
					return { result: { value: win?.__reclaimUserScriptResult } }
				}

				return { result: { value: undefined } }
			}

			return {}
		},
		waitForEvent: async() => 'fired' as const,
	} as unknown as AuthoringBackend
	return {
		backend,
		installed: () => String(installedSource),
		removed: () => removedIds,
	}
}

function runTool(backend: AuthoringBackend, args: Record<string, unknown>) {
	const tool = authoringTools(() => backend)
		.find((t) => t.definition.name === 'test_user_script')
	assert.ok(tool, 'test_user_script tool should be registered')
	return tool.handler(args)
}

describe('test_user_script', () => {
	it('reports ran:true for a script that runs cleanly', async() => {
		const { backend } = fakeBackend()
		const res = await runTool(backend, {
			script: 'window.sawIt = true;',
			navigateUrl: 'https://example.com',
		}) as {
			installed: boolean
			navigated: boolean
			ran: boolean
			errors: string[]
		}
		assert.equal(res.installed, true)
		assert.equal(res.navigated, true)
		assert.equal(res.ran, true)
		assert.deepEqual(res.errors, [])
	})

	it('captures a thrown error instead of the tool call failing', async() => {
		const { backend } = fakeBackend()
		const res = await runTool(backend, {
			script: 'throw new Error("boom");',
			navigateUrl: 'https://example.com',
		}) as { ran: boolean, errors: string[] }
		assert.equal(res.ran, false)
		assert.ok(res.errors.some((e) => e.includes('boom')))
	})

	it('installs but does not run without a navigateUrl', async() => {
		const { backend, installed } = fakeBackend()
		const res = await runTool(backend, {
			script: 'window.sawIt = true;',
		}) as { installed: boolean, note: string }
		assert.equal(res.installed, true)
		assert.match(res.note, /next navigation/i)
		assert.match(installed(), /sawIt/)
	})

	it(
		'a syntax error in the script is reported, not swallowed as ' +
		'ran:false/errors:[]',
		async() => {
			const { backend } = fakeBackend()
			const res = await runTool(backend, {
				script: 'this is not valid js (((',
				navigateUrl: 'https://example.com',
			}) as { ran: boolean, errors: string[] }
			assert.equal(res.ran, false)
			assert.ok(
				res.errors.length > 0,
				'a parse error in the user script should surface as an error, ' +
				'not an empty list',
			)
		},
	)

	it(
		'removes the installed script after a navigateUrl test (self-cleaning ' +
		'— does not keep running on later navigations)',
		async() => {
			const { backend, removed } = fakeBackend()
			await runTool(backend, {
				script: 'window.sawIt = true;',
				navigateUrl: 'https://example.com',
			})
			assert.equal(removed().length, 1)
		},
	)

	it(
		'does NOT remove the script in manual mode (no navigateUrl) — it must '
		+ 'stay installed for the caller to navigate themselves',
		async() => {
			const { backend, removed } = fakeBackend()
			await runTool(backend, { script: 'window.sawIt = true;' })
			assert.equal(removed().length, 0)
		},
	)
})
