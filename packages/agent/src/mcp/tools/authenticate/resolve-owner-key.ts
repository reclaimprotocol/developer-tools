import { findProjectRoot } from '../../../paths.ts'
import { defineTool, type RegisteredTool } from '../../server.ts'
import { GENERATED_KEY_NOTE, resolveOrCreateEthKey } from './eth-key.ts'

/**
 * Decide which eth proof-owner key `run_proof` signs with. The key is a raw
 * 0x-hex Ethereum private key, resolved (no `~/.reclaim` cache) from:
 *   1. `RECLAIM_PRIVATE_KEY` in the MCP env
 *   2. a `RECLAIM_PRIVATE_KEY=0x…` line in the project `.env`
 *   3. a file at `RECLAIM_PRIVATE_KEY_FILE` holding the raw hex
 *   4. none → a local test key is generated into the project `.env`. Nobody
 *      is asked; the agent tells the developer afterwards.
 * Never returns the private key — only the derived address.
 */
export function resolveOwnerKeyTool(): RegisteredTool {
	return defineTool<{ projectDir?: string }>(
		{
			name: 'resolve_owner_key',
			description:
				'Finds the eth proof-owner key `run_proof` signs with, creating a '
				+ 'local test key when none exists. `run_proof` does this itself, '
				+ 'so call it only to show the signing address. Checks '
				+ 'RECLAIM_PRIVATE_KEY in the MCP env, a RECLAIM_PRIVATE_KEY line in '
				+ 'the project .env, then the file at RECLAIM_PRIVATE_KEY_FILE. When '
				+ 'none is set, it writes a new key to the project .env (mode 0600, '
				+ 'added to .gitignore). Returns { ready: true, address, source, '
				+ 'path?, note? }; `source` is `generated` when it created the key, '
				+ 'and `note` then says to tell the developer once, after the fact. '
				+ 'Do not ask the developer for a key. Never returns the key.',
			inputSchema: {
				type: 'object',
				properties: {
					projectDir: {
						type: 'string',
						description:
							'Project directory whose `.env` holds the key. Defaults to '
							+ 'the closest ancestor of cwd containing .git or '
							+ 'package.json.',
					},
				},
			},
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async(args) => {
			const projectDir = findProjectRoot(args.projectDir || process.cwd())
			const key = resolveOrCreateEthKey(projectDir)
			return {
				ready: true,
				address: key.address,
				source: key.source,
				...(key.path ? { path: key.path } : {}),
				...(key.source === 'generated' ? { note: GENERATED_KEY_NOTE } : {}),
			}
		},
	)
}
