import { readFileSync } from 'node:fs'
import { findProjectRoot } from '../../../paths.ts'
import { defineTool, type RegisteredTool } from '../../server.ts'
import { writeEthKey } from './eth-key.ts'

export function importTool(): RegisteredTool {
	return defineTool<{
		keyFile: string
		projectDir?: string
	}>(
		{
			name: 'import_credentials',
			description:
				'Imports an eth proof-owner key from a file the developer already '
				+ 'holds. Reads the raw 0x-hex key from `keyFile` and writes it to '
				+ 'the project `.env` as RECLAIM_PRIVATE_KEY (mode 0600; `.env` '
				+ 'added to .gitignore). Returns the derived address and the `.env` '
				+ 'path; never the key. The key is a local signing key only: it is '
				+ 'not registered with any server and is unrelated to org auth or '
				+ 'encryption. To create a new key instead, use `issue_credentials`.',
			inputSchema: {
				type: 'object',
				required: ['keyFile'],
				properties: {
					keyFile: {
						type: 'string',
						description:
							'Path to a file containing the raw 0x-hex private key '
							+ '(absolute or relative to the working directory).',
					},
					projectDir: {
						type: 'string',
						description:
							'Project directory whose `.env` the key is written to. '
							+ 'Defaults to the closest ancestor of cwd containing .git or '
							+ 'package.json.',
					},
				},
			},
			annotations: { readOnlyHint: false, destructiveHint: false },
		},
		async(args) => {
			const projectDir = findProjectRoot(args.projectDir || process.cwd())
			const { path, address } = writeEthKey(
				readFileSync(args.keyFile, 'utf8'), projectDir,
			)

			return {
				address,
				path,
				note:
					'Eth proof-owner key written to .env as RECLAIM_PRIVATE_KEY '
					+ '(mode 0600). resolve_owner_key resolves it from .env. Keep .env '
					+ 'secret: it has been added to .gitignore.',
			}
		},
	)
}
