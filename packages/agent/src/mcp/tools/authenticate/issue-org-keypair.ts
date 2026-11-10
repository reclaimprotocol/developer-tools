import { conflict } from '@hapi/boom'
import { deriveFromPrivateKey, generateKeypair } from '@reclaimprotocol/client'
import { isProblemError, type ReclaimClient } from '@reclaimprotocol/client/api'
import assert from 'node:assert'
import { isAbsolute, relative, resolve } from 'node:path'
import { defineTool, type RegisteredTool } from '../../server.ts'
import {
	backupEnvVar,
	normalizeEthHex,
	readDotenvKey,
	removeEnvVar,
	upsertEnvVar,
} from './eth-key.ts'

/**
 * Creates the organization's eth key pair for session binding and encrypted
 * results: writes the private key to the app's server env file and registers
 * only the public key with Builder, so the private key never passes through
 * the agent's transcript. Reuses a key the env file already holds, so a
 * repeat call (for example, to turn on encryption) keeps the same key. With
 * `replace`, always generates a fresh key and rotates the org's key to it.
 */
export function issueOrgKeypairTool(client: ReclaimClient): RegisteredTool {
	return defineTool<{
		orgId: string
		projectDir: string
		envFile?: string
		envVar?: string
		encryptResults?: boolean
		replace?: boolean
	}>(
		{
			name: 'issue_org_keypair',
			description:
				'Sets up the organization\'s eth key pair, used for TEE session '
				+ 'binding (`sessions.create({ orgEthPrivateKey })`) and, with '
				+ '`encryptResults`, encrypted result delivery '
				+ '(`results.receive(body, { orgEthPrivateKey })`). Writes the '
				+ 'private key to a server env file in the project (reusing a key '
				+ 'already there) and registers only the public key. Returns the '
				+ 'address, file, and variable; never the key. Returns 409 when the '
				+ 'org already has a different key. Set `replace: true` only when '
				+ 'the developer asked to rotate or replace the key: it generates '
				+ 'a new key and swaps it in one step, and apps holding the old '
				+ 'key can no longer decrypt new results. The old key is first '
				+ 'appended to `<envFile>.backup` (gitignored); tell the developer '
				+ 'its path.',
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
							'Variable name to set. Default `RECLAIM_ORG_ETH_PRIVATE_KEY`.',
					},
					encryptResults: {
						type: 'boolean',
						description:
							'Encrypt delivered results to this key. Default false, or the '
							+ 'org\'s current setting with `replace`.',
					},
					replace: {
						type: 'boolean',
						description:
							'Rotate: generate a new key and replace the org\'s current '
							+ 'one. Default false.',
					},
				},
			},
			annotations: { openWorldHint: true, destructiveHint: true },
		},
		async(args) => {
			assert(
				isAbsolute(args.projectDir),
				new Error('`projectDir` must be an absolute path.'),
			)
			const envFile = args.envFile || '.env'
			const envVar = args.envVar || 'RECLAIM_ORG_ETH_PRIVATE_KEY'
			const envPath = resolve(args.projectDir, envFile)
			const inside = relative(args.projectDir, envPath)
			assert(
				inside && !inside.startsWith('..') && !isAbsolute(inside),
				new Error('`envFile` must be inside `projectDir`.'),
			)

			const replace = args.replace ?? false
			// Rotation always generates a fresh key: the env file's key may or
			// may not be the one the org holds, and reuse would be a no-op.
			const existing = replace ? undefined : readDotenvKey(envPath, envVar)
			const keypair = existing
				? deriveFromPrivateKey(normalizeEthHex(existing))
				: generateKeypair()
			// A rotation keeps the org's current setting unless the caller sets it.
			const canEncryptResult = args.encryptResults
				?? (replace && await currentCanEncryptResult())
			// Back up and save the key before the org switches to it, so a
			// failed write can't leave the org on a key no app holds. A failed
			// registration (for example, a 409) puts the env file back.
			const old = readDotenvKey(envPath, envVar)
			const backupFile = old && !existing
				? backupEnvVar(
					args.projectDir, envFile, envVar, 'replaced by issue_org_keypair',
				)
				: undefined
			const path = upsertEnvVar(
				args.projectDir, envFile, envVar, keypair.privateKey,
			)
			try {
				await client.call('SetOrgKeypair', {
					params: { orgId: args.orgId },
					body: {
						publicKey: keypair.publicKey,
						canEncryptResult,
						replace,
					},
				})
			} catch(err) {
				if(old) {
					upsertEnvVar(args.projectDir, envFile, envVar, old)
				} else {
					removeEnvVar(args.projectDir, envFile, envVar)
				}

				if(!replace && isProblemError(err) && err.output.statusCode === 409) {
					throw conflict(
						'The org already has a different key. Ask the developer to '
						+ 'choose: (a) reuse it: they paste its private key into '
						+ `\`${envFile}\` as \`${envVar}\` themselves, never into the `
						+ 'chat; (b) rotate it: call `issue_org_keypair` again with '
						+ '`replace: true`, after which apps holding the old key can no '
						+ 'longer decrypt new results; (c) turn off result encryption: '
						+ 'call `update_org_keypair` with `canEncryptResult: false`, '
						+ 'which keeps the key.',
					)
				}

				throw err
			}

			return {
				orgId: args.orgId,
				address: keypair.address,
				canEncryptResult,
				envFile: path,
				envVar,
				reused: Boolean(existing),
				backupFile: backupFile ?? null,
				...(replace && !backupFile && !old
					? {
						note: 'Nothing was backed up: the old private key is not in '
							+ 'this file. Another app may hold it.',
					}
					: {}),
			}

			async function currentCanEncryptResult() {
				try {
					const { data } = await client.call('GetOrgKeypair', {
						params: { orgId: args.orgId },
					})
					return data.canEncryptResult
				} catch(err) {
					if(isProblemError(err) && err.output.statusCode === 404) {
						return false
					}

					throw err
				}
			}
		},
	)
}
