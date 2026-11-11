import type { ReclaimClient } from '@reclaimprotocol/client/api'
import type { RegisteredTool } from '../../server.ts'
import { authenticateTool, waitForSignInTool } from './authenticate.ts'
import { importTool } from './import.ts'
import { issueTool } from './issue.ts'
import { issueOrgKeypairTool } from './issue-org-keypair.ts'
import { issueOrgTokenTool } from './issue-org-token.ts'
import { resolveOwnerKeyTool } from './resolve-owner-key.ts'

/**
 * Local-only key tools — no backend client needed. These manage the eth
 * proof-owner key entirely on disk (as a secp256k1 PEM) or via env: generate,
 * import, and resolve which key to sign proofs with. No `~/.reclaim` caching;
 * useful in BOTH builder and OLD-devtools mode.
 */
export function buildLocalCredentialTools(): RegisteredTool[] {
	return [
		resolveOwnerKeyTool(),
		issueTool(),
		importTool(),
	]
}

/**
 * Full builder-mode credential set: the local key tools plus the backend
 * `reclaim_authenticate` sign-in flow and its `wait_for_sign_in` companion.
 * Old mode does NOT use the authenticate tool — it has its own.
 */
export function buildCredentialTools(client: ReclaimClient): RegisteredTool[] {
	return [
		authenticateTool(client),
		waitForSignInTool(client),
		issueOrgTokenTool(client),
		issueOrgKeypairTool(client),
		...buildLocalCredentialTools(),
	]
}
