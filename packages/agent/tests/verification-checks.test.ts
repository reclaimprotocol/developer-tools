import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ReclaimProvider } from '../src/provider/schema.ts'
import { verificationWarnings } from '../src/provider/verification-checks.ts'

function draft(overrides: Partial<ReclaimProvider> = {}): ReclaimProvider {
	return {
		name: 'github-username',
		url: 'https://github.com/github-copilot/chat?skip_anchor=true',
		method: 'GET',
		responseMatches: [
			{ type: 'contains', value: '"currentUserLogin":"{{username}}"' },
		],
		responseRedactions: [{ jsonPath: '$.currentUserLogin' }],
		paramValues: { username: 'octocat' },
		...overrides,
	}
}

describe('verificationWarnings', () => {
	it('stays quiet for a clean draft (shape is not its business)', () => {
		// The verification client tests candidates itself (CDP sees all
		// traffic); the lint only surfaces author-only decisions.
		const w = verificationWarnings(draft())
		assert.deepEqual(w, [])
	})

	it('flags a captured param value baked literally into the URL', () => {
		const p = draft({
			url: 'https://github.com/octocat/repos',
			responseRedactions: [{ xPath: '//div' }],
		})
		const w = verificationWarnings(p)
		assert.ok(w.some((m) => (/\{\{context\.username\}\}/).test(m)))
	})
})
