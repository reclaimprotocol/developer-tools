import type { ReclaimClient } from '@reclaimprotocol/client/api'
import assert from 'node:assert'
import { isAbsolute, relative, resolve } from 'node:path'
import { defineTool, type RegisteredTool } from '../../server.ts'
import { backupEnvVar, readDotenvKey, upsertEnvVar } from './eth-key.ts'
import { saveOrgKey } from './org-key-store.ts'

/**
 * Issues an organization API key and stores it on disk, so the key never
 * passes through the agent's transcript. Replaces the generated
 * `issue_org_token` operation, which returned the key in its response.
 */
export function issueOrgTokenTool(client: ReclaimClient): RegisteredTool {
	return defineTool<{
		orgId: string
		projectDir: string
		envFile?: string
		envVar?: string
	}>(
		{
			name: 'issue_org_token',
			description:
				'Issues an organization API key (owner only) and writes it to a '
				+ 'server env file in the project, so the app can read it at runtime. '
				+ 'Also saves it on this machine for the org-key tools. Returns the '
				+ 'org, file, variable, and last four characters; never the key. '
				+ 'Replaces an existing variable of the same name in the file, first '
				+ 'appending the old value to `<envFile>.backup` (gitignored); tell '
				+ 'the developer its path. '
				+ 'Adds the file to .gitignore. Use when the app needs a key, or '
				+ 'before `create_verification_session`.',
			inputSchema: {
				type: 'object',
				required: ['orgId', 'projectDir'],
				properties: {
					orgId: { type: 'string', format: 'uuid' },
					projectDir: {
						type: 'string',
						description: 'Absolute path of the app\'s project directory.',
					},
					envFile: {
						type: 'string',
						description:
							'Env file to write, relative to `projectDir`. Default `.env`.',
					},
					envVar: {
						type: 'string',
						pattern: '^[A-Za-z_][A-Za-z0-9_]*$',
						description:
							'Variable name to set. Default `RECLAIM_ORG_SECRET`.',
					},
				},
			},
			annotations: { openWorldHint: true, destructiveHint: false },
		},
		async(args) => {
			assert(
				isAbsolute(args.projectDir),
				new Error('`projectDir` must be an absolute path.'),
			)
			const envFile = args.envFile || '.env'
			const envVar = args.envVar || 'RECLAIM_ORG_SECRET'
			const inside = relative(
				args.projectDir, resolve(args.projectDir, envFile),
			)
			assert(
				inside && !inside.startsWith('..') && !isAbsolute(inside),
				new Error('`envFile` must be inside `projectDir`.'),
			)

			const { data } = await client.call('IssueOrgToken', {
				params: { orgId: args.orgId },
			})
			const old = readDotenvKey(
				resolve(args.projectDir, envFile), envVar,
			)
			const backupFile = old && old !== data.orgSecret
				? backupEnvVar(
					args.projectDir, envFile, envVar, 'replaced by issue_org_token',
				)
				: undefined
			const path = upsertEnvVar(
				args.projectDir, envFile, envVar, data.orgSecret,
			)
			saveOrgKey(args.orgId, data.orgSecret)
			return {
				orgId: args.orgId,
				envFile: path,
				envVar,
				last4: data.last4,
				backupFile: backupFile ?? null,
			}
		},
	)
}
