import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineTool, type RegisteredTool } from '../../mcp/server.ts'
import { findProjectRoot } from '../../paths.ts'
import type { ReclaimOldClient } from '../client.ts'

interface Check {
	name: string
	ok: boolean
	detail: string
}

function readEnvFile(dir: string): Record<string, string> {
	const path = join(dir, '.env')
	if(!existsSync(path)) {
		return {}
	}

	const out: Record<string, string> = {}
	for(const line of readFileSync(path, 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
		if(m) {
			out[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
		}
	}

	return out
}

/**
 * Health-check a project's @reclaimprotocol/js-sdk setup: SDK installed,
 * RECLAIM_APP_ID/RECLAIM_APP_SECRET present (env or .env), and (if an appId
 * is found) whether that app is actually linked/has quota, via the real
 * check_app_status endpoint — not just static file checks.
 */
export function verifySdkSetupTool(client: ReclaimOldClient): RegisteredTool {
	return defineTool<{ projectDir?: string }>(
		{
			name: 'verify_reclaim_sdk_setup',
			description:
				'Health-check a project\'s @reclaimprotocol/js-sdk integration: SDK ' +
				'installed, RECLAIM_APP_ID/RECLAIM_APP_SECRET present, and (if an ' +
				'appId is found) whether that app is actually linked and has quota ' +
				'left, by calling the real status endpoint.',
			inputSchema: {
				type: 'object',
				properties: {
					projectDir: {
						type: 'string',
						description: 'Project directory (default: detected project root).',
					},
				},
			},
		},
		async({ projectDir }) => {
			const dir = projectDir ?? findProjectRoot(process.cwd())
			const checks: Check[] = []

			const pkgPath = join(dir, 'package.json')
			let sdkInPkg = false
			if(existsSync(pkgPath)) {
				try {
					const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
					sdkInPkg = Boolean(
						pkg.dependencies?.['@reclaimprotocol/js-sdk'] ||
						pkg.devDependencies?.['@reclaimprotocol/js-sdk'],
					)
				} catch{
					// malformed package.json — fall through, reported below
				}
			}

			const sdkInstalled = existsSync(
				join(dir, 'node_modules', '@reclaimprotocol', 'js-sdk'),
			)
			checks.push({
				name: 'sdk_dependency',
				ok: sdkInPkg,
				detail: sdkInPkg
					? '@reclaimprotocol/js-sdk is listed in package.json'
					: '@reclaimprotocol/js-sdk is NOT in package.json — run ' +
						'`npm install @reclaimprotocol/js-sdk`.',
			})
			checks.push({
				name: 'sdk_installed',
				ok: sdkInstalled,
				detail: sdkInstalled
					? '@reclaimprotocol/js-sdk found in node_modules'
					: 'Not found in node_modules — run your package manager\'s ' +
						'install command.',
			})

			const env = { ...readEnvFile(dir), ...process.env }
			const appId = env.RECLAIM_APP_ID
			const appSecret = env.RECLAIM_APP_SECRET
			checks.push({
				name: 'app_id',
				ok: Boolean(appId),
				detail: appId
					? `RECLAIM_APP_ID set (${appId})`
					: 'RECLAIM_APP_ID missing (env or .env) — run ' +
						'issue_app_credentials or link_app_to_account.',
			})
			checks.push({
				name: 'app_secret',
				ok: Boolean(appSecret),
				detail: appSecret
					? 'RECLAIM_APP_SECRET set'
					: 'RECLAIM_APP_SECRET missing (env or .env).',
			})

			// Informational only — PUBLIC_URL is only needed for the async
			// webhook callback, not the frontend-only flow, so a missing value
			// doesn't fail the overall check.
			const publicUrl = env.PUBLIC_URL
			checks.push({
				name: 'public_url',
				ok: true,
				detail: publicUrl
					? `PUBLIC_URL set (${publicUrl}) — used as the webhook callback ` +
						'base for setAppCallbackUrl.'
					: 'PUBLIC_URL not set — fine if you only read the proof from the ' +
						'frontend flow, but the async webhook callback needs a ' +
						'publicly-reachable URL or it will never fire. Get one via a ' +
						'tunnel (for example, `ngrok http <port>`) or by deploying to a ' +
						'dev/staging server you already have — ask the user which they ' +
						'prefer.',
			})

			if(appId) {
				try {
					const status = await client.getApplicationStatus(appId) as {
						isLinked?: boolean
						sandboxMode?: boolean
						available?: boolean
					}
					const linked = status?.isLinked === true
					checks.push({
						name: 'app_status',
						ok: status?.available !== false,
						detail:
							`isLinked=${linked}, sandboxMode=${status?.sandboxMode}, ` +
							`available=${status?.available}` +
							(linked
								? ''
								: ' — run link_app_to_account to lift the sandbox limit.'),
					})
				} catch(err) {
					checks.push({
						name: 'app_status',
						ok: false,
						detail: `Could not reach status endpoint: ${
							err instanceof Error ? err.message : String(err)
						}`,
					})
				}
			}

			return { projectDir: dir, checks, ok: checks.every((c) => c.ok) }
		},
	)
}
