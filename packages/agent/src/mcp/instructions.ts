/**
 * Loads concise, always-on mode instructions and topic guides served on
 * demand by `how_it_works`. Keeping detailed guidance out of tool schemas
 * avoids adding it to every request's context.
 *
 * `<!-- common: name -->` includes shared sections, `%CTX%` selects the
 * mode-specific context prefix, and `<!-- topic: name -->` creates a topic.
 */
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function readSkill(file: string): string {
	const url = new URL(`../../skill/${file}`, import.meta.url)
	return readFileSync(fileURLToPath(url), 'utf8')
		// These files are internal topic fragments, but tolerate skill frontmatter.
		.replace(/^---\n[\s\S]*?\n---\n/, '')
		.trim()
}

export const BUILDER_MODE_INSTRUCTIONS = readSkill('builder-mode.md')
export const OLD_MODE_INSTRUCTIONS = readSkill('old-mode.md')

/** Split `<!-- marker: name -->`-delimited blocks, keeping document order. */
function splitBlocks(text: string, marker: string): Map<string, string> {
	const blocks = new Map<string, string>()
	const re = new RegExp(
		`<!-- ${marker}: (\\S+) -->\\n([\\s\\S]*?)(?=\\n<!-- ${marker}: |$)`,
		'g',
	)
	for(const match of text.matchAll(re)) {
		// Trim blank lines only, not inline indentation. Some blocks are
		// list-continuation text that's intentionally indented on its first line.
		blocks.set(match[1], match[2].replace(/^\n+/, '').replace(/\n+$/, ''))
	}

	return blocks
}

const COMMON_SECTIONS = splitBlocks(readSkill('SKILL.common.md'), 'section')

/** Topics that read the same on both backends, each its own file. */
const SHARED_TOPIC_FILES: Record<string, string> = {
	'user-script': 'user-script.md',
	'interception': 'interception.md',
	'hash-validation': 'hash-validation.md',
	'report-bug': 'report-bug.md',
}

/** Detailed topics that exist only in Builder mode. */
const BUILDER_TOPIC_FILES: Record<string, string> = {
	'contributions': 'community-contributions.md',
	'ai-sessions': 'ai-sessions.md',
	'integration': 'verification-client-integration.md',
	'zkfetch': 'zkfetch.md',
}

/** One line per topic, shown in the `how_it_works` index so a caller can pick
 *  the right one without fetching several. Keyed across both modes; only the
 *  topics a mode actually has are listed back to it. */
const TOPIC_SUMMARIES: Record<string, string> = {
	'overview': 'Terminology, your stance, and the authoring checklist.',
	'contributions': 'Contributing a public provider as a volunteer: the '
		+ 'candidate-and-review workflow and the extra rules it adds.',
	'auth': 'Signing in to the backend, which token authorizes what, and '
		+ 'the backend mode (Builder or legacy devtools).',
	'devtools-migration': 'Importing a public legacy provider with the same '
		+ 'UUID.',
	'browser': 'The default local browser, the opt-in modes (attach, the '
		+ 'Reclaim runtime in Docker, a remote Builder browser, a custom CDP '
		+ 'endpoint), geolocation, live view, and launch troubleshooting.',
	'capture': 'Tabs, sign-in detection, capturing through the navigation '
		+ 'script, and picking an authenticated request to prove.',
	'draft': 'The OPRF/privacy decision, propose_provider, and the canonical '
		+ 'drafted shape.',
	'params': 'Extracted vs consumer-supplied vs secret params, the URL '
		+ 'character budget, and runtime resolution.',
	'prove': 'replay_request, the mandatory auth-bound check, run_proof '
		+ '(including the egress country), and diagnosing failures.',
	'publish': 'Creating a provider, provider versions, multi-request '
		+ 'providers, and going live.',
	'discover': 'Reusing existing providers: finding, resolving, copying one '
		+ 'that needs changes, and creating a verification session.',
	'ai-sessions': 'The first route for a backend integration: prove a claim '
		+ 'about a user\'s account with create_ai_verification_session, no '
		+ 'provider or capture. Setup, backend code, and when to fall back.',
	'integration': 'After start_integration: org key and keypair, callback '
		+ '(local proxy_callback_events or deployed webhook), frontend and '
		+ 'backend over the HTTP session API, js-sdk projects, trying a '
		+ 'session without an app; `api=2` and result verification.',
	'zkfetch': 'Proving a response the developer\'s own server fetches, such '
		+ 'as an API called with their key: zkFetch in Builder mode with the '
		+ 'org key, verifyRequestProof, quota, and failures.',
	'user-script': 'The navigation script (jsUserScripts): sign-in redirect, '
		+ 'multi-page walk, test_user_script with keep.',
	'interception': 'injectionType / interceptorType, live interception, the '
		+ 'document-replay flag, and what to do when a site won\'t load or '
		+ 'won\'t let the user sign in.',
	'hash-validation': 'bodySniff, and how verifyRequestProof({ providerId }) '
		+ 'gates on the declared spec hash.',
	'report-bug': 'Reporting or fixing a bug in @reclaimprotocol/client or this '
		+ 'MCP server: what to collect, redaction, and the fix-PR or issue path.',
	'credentials': 'The eth proof-owner key run_proof signs with.',
	'never-do': 'The short list of things that always break a provider.',
	'troubleshooting': 'Expired drafts, browser problems, and where to look '
		+ 'next.',
}

export interface Guide {
	/** Topic name → its markdown, in document order. */
	topics: Map<string, string>
	/** `{ topic, summary }` for every topic this mode has. */
	index: Array<{ topic: string, summary: string }>
	/** Every topic concatenated — the whole guide, as it used to be served. */
	full: string
}

function buildGuide(
	file: string,
	ctxPrefix: string,
	modeTopicFiles: Record<string, string> = {},
): Guide {
	const raw = readSkill(file)
		.replace(/<!-- common: (\S+) -->/g, (_whole, name: string) => {
			const section = COMMON_SECTIONS.get(name)
			assert(section, `${file}: no SKILL.common.md section named "${name}"`)
			return section
		})
		.replaceAll('%CTX%', ctxPrefix)

	const topics = splitBlocks(raw, 'topic')
	assert(topics.size, `${file}: no <!-- topic: … --> sections found`)
	for(const [name, path] of Object.entries(SHARED_TOPIC_FILES)) {
		topics.set(name, readSkill(path))
	}

	for(const [name, path] of Object.entries(modeTopicFiles)) {
		assert(topics.has(name), `${file}: no topic marker named "${name}"`)
		topics.set(name, readSkill(path))
	}

	const index = [...topics.keys()].map((topic) => {
		const summary = TOPIC_SUMMARIES[topic]
		assert(summary, `${file}: no TOPIC_SUMMARIES entry for "${topic}"`)
		return { topic, summary }
	})

	return { topics, index, full: [...topics.values()].join('\n\n') }
}

export const GUIDE_BUILDER = buildGuide(
	'SKILL.builder.md',
	'context.',
	BUILDER_TOPIC_FILES,
)
export const GUIDE_OLD = buildGuide('SKILL.old.md', 'context_')

export function guideFor(oldMode: boolean): Guide {
	return oldMode ? GUIDE_OLD : GUIDE_BUILDER
}
