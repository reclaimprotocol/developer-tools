import { generateKeypair } from '@reclaimprotocol/client'
import { findProjectRoot } from '../../../paths.ts'
import { defineTool, type RegisteredTool } from '../../server.ts'
import { writeEthKey } from './eth-key.ts'

export function issueTool(): RegisteredTool {
	return defineTool<{ projectDir?: string }>(
		{
			name: 'issue_credentials',
			description:
				'Generates a new secp256k1 eth proof-owner key and writes the '
				+ 'private key to the project `.env` as RECLAIM_PRIVATE_KEY (mode '
				+ '0600; `.env` added to .gitignore). Returns the address and the '
				+ '`.env` path; never the key. The key is a local signing key only: '
				+ 'it is not registered with any server and is unrelated to org auth '
				+ 'or encryption. Confirm with the developer before replacing an '
				+ 'existing key. `run_proof` then picks it up through '
				+ '`resolve_owner_key`.',
			inputSchema: {
				type: 'object',
				properties: {
					projectDir: {
						type: 'string',
						description:
							'Project directory whose `.env` the key is written to. ' +
							'Defaults to the closest ancestor of cwd containing .git or ' +
							'package.json.',
					},
				},
			},
			annotations: { destructiveHint: false },
		},
		async(args) => {
			const projectDir = findProjectRoot(args.projectDir || process.cwd())
			const keypair = generateKeypair()
			const { path, address } = writeEthKey(keypair.privateKey, projectDir)

			return {
				address,
				path,
				note:
					'Eth proof-owner key written to .env as RECLAIM_PRIVATE_KEY ' +
					'(mode 0600); the private key is NOT in this response on purpose. ' +
					'resolve_owner_key will now resolve it from .env (or set ' +
					'RECLAIM_PRIVATE_KEY in the environment to override). Keep .env ' +
					'secret — it has been added to .gitignore.',
			}
		},
	)
}
