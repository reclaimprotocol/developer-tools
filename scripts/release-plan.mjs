#!/usr/bin/env node
// Decides which @reclaimprotocol packages release.yml must publish.
// Writes client_publish, agent_publish, release, version, tag, tag_needed and
// registry_needed to $GITHUB_OUTPUT when set, otherwise to stdout.
// tag_needed is true when the v<version> tag doesn't exist yet. It lets a rerun
// finish the tag and registry steps after a run that published to npm and then
// failed.

import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Pure planning logic. `published` maps a package name to the list of
 * versions already on npm.
 */
export function planRelease({ client, agent, published, tagExists = false }) {
	if (client.version !== agent.version) {
		throw new Error(`Lockstep violation: client is ${client.version} but agent is ${agent.version}.`)
	}
	const dependency = agent.dependencies?.['@reclaimprotocol/client']
	if (dependency !== client.version) {
		throw new Error(
			`Lockstep violation: agent depends on @reclaimprotocol/client ${dependency} but client is ${client.version}.`
		)
	}
	const version = agent.version
	const clientPublish = !published[client.name]?.includes(version)
	const agentPublish = !published[agent.name]?.includes(version)
	const release = clientPublish || agentPublish
	const tagNeeded = !tagExists
	return {
		client_publish: clientPublish,
		agent_publish: agentPublish,
		release,
		version,
		tag: `v${version}`,
		tag_needed: tagNeeded,
		registry_needed: release || tagNeeded,
	}
}

/**
 * Returns true when the tag exists in the repository. Uses the GitHub API when
 * GITHUB_REPOSITORY is set, otherwise `git ls-remote`. Pass `run` to inject
 * the command runner in tests: it receives the command and arguments and
 * returns stdout, or throws when the command fails.
 */
export function tagExistsInRepo(tag, { env = process.env, run = defaultRun } = {}) {
	if (env.GITHUB_REPOSITORY && env.GITHUB_TOKEN) {
		try {
			run('gh', ['api', `repos/${env.GITHUB_REPOSITORY}/git/ref/tags/${tag}`, '--silent'], env)
			return true
		} catch (error) {
			// gh prints "HTTP 404" for a missing ref. Anything else is a real failure.
			if (/404|Not Found/i.test(`${error.stderr ?? ''}${error.message}`)) {
				return false
			}
			throw error
		}
	}
	const out = run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], env)
	return out.trim().length > 0
}

function defaultRun(command, args, env) {
	return execFileSync(command, args, { env, cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** Returns the versions of a package on npm, or [] when it was never published. */
export async function fetchPublishedVersions(name, fetchFn = fetch) {
	const response = await fetchFn(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, {
		headers: { accept: 'application/json' },
	})
	if (response.status === 404) {
		return []
	}
	if (!response.ok) {
		throw new Error(`npm registry returned ${response.status} for ${name}.`)
	}
	const body = await response.json()
	return Object.keys(body.versions ?? {})
}

async function main() {
	const read = (dir) => JSON.parse(readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8'))
	const client = read('client')
	const agent = read('agent')
	const published = {
		[client.name]: await fetchPublishedVersions(client.name),
		[agent.name]: await fetchPublishedVersions(agent.name),
	}
	const tagExists = tagExistsInRepo(`v${agent.version}`)
	const plan = planRelease({ client, agent, published, tagExists })
	const lines = Object.entries(plan).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, lines)
	}
	process.stdout.write(lines)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error.message)
		process.exit(1)
	})
}
