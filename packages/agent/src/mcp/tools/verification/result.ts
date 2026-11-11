import {
	decryptCallback,
	type DecryptionKey,
	ReclaimVerification,
} from '@reclaimprotocol/client'
import assert from 'node:assert'
import { apiUrl, orgSecret } from '../../../consts.ts'
import { defineTool, type RegisteredTool } from '../../server.ts'
import { resolveDecryptionKey } from '../authenticate/decrypt-key.ts'
import { savedOrgKey } from '../authenticate/org-key-store.ts'

/** Statuses that can carry a Builder-managed terminal result. */
const TERMINAL = new Set([
	'success',
	'rejected',
	'error',
	'cancelled',
	'expired',
])

/** Events whose delivery is a signed result; the rest are plaintext event
 *  notifications. Mirrors `verification_result_events()`. */
const RESULT_EVENTS = new Set([
	'verification_success',
	'verification_rejected',
	'verification_error',
	'verification_cancelled',
])

/**
 * Resolve the org secret used to authenticate verification reads. Auth is a
 * single per-org bearer secret (`rorg_…`), not an eth signature: the call's
 * `orgToken`, else `RECLAIM_ORG_SECRET`.
 */
export function resolveOrgSecret(orgToken?: string): string {
	const secret = orgToken?.trim() || orgSecret()?.trim() || savedOrgKey()
	assert(
		secret,
		new Error(
			'No organization API key. Verification reads authenticate with the org '
				+ 'secret (rorg_…): run issue_org_token to save a key, pass orgToken, '
				+ 'or export RECLAIM_ORG_SECRET for the MCP server.',
		),
	)
	return secret
}

/**
 * `get_verification_result` — check a session's status and, once a result has
 * been submitted, pull the stored payload(s) and verify locally. Auth is the
 * org token; delivery is org-scoped. Each stored payload is either the
 * plaintext signed JWS (when the org's encryption is off) or an ECIES
 * ciphertext that we decrypt here with the optional eth key
 * (`RECLAIM_DECRYPT_KEY` or the `reclaim-decrypt.key` hex file). The Builder
 * creates, signs, optionally encrypts, and stores the delivery payload.
 * Decryption, when needed, happens here.
 */
export function verificationResultTool(): RegisteredTool {
	return defineTool<{ reclaimSessionId: string, orgToken?: string }>(
		{
			name: 'get_verification_result',
			description:
				'Fetches and verifies a terminal Builder result for one session, '
				+ 'while Builder still holds it: until its callback is delivered, or '
				+ '7 days undelivered. The callback is the normal way to get results. '
				+ 'Authenticates with the org API key: `orgToken`, else '
				+ '`RECLAIM_ORG_SECRET`, else the key saved by `issue_org_token`. '
				+ 'Encrypted deliveries also require '
				+ 'the matching ETH decryption key. Returns `ready: false` until a '
				+ 'payload is available. Invalid results fail verification and are not '
				+ 'returned. Use `list_verification_events` to diagnose '
				+ 'an unfinished session.',
			inputSchema: {
				type: 'object',
				required: ['reclaimSessionId'],
				properties: {
					reclaimSessionId: {
						type: 'string',
						description:
							'The verification session id from create_verification_session.',
					},
					orgToken: {
						type: 'string',
						pattern: '^rorg_',
						maxLength: 200,
						description: 'The organization API key (`rorg_…`): from '
							+ '`issue_org_token`, or the app\'s RECLAIM_ORG_SECRET. '
							+ 'Defaults to the MCP server\'s RECLAIM_ORG_SECRET, then the '
							+ 'key saved by `issue_org_token`. Never echo it back to the '
							+ 'user.',
					},
				},
			},
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		async(args) => {
			const secret = resolveOrgSecret(args.orgToken)
			// Optional eth decryption key — absent ⇒ plaintext-only.
			const decryptionKey: DecryptionKey | undefined =
				await resolveDecryptionKey()

			const reclaim = ReclaimVerification.create({
				baseUrl: apiUrl(),
				orgSecret: secret,
			})

			const sessionRes = await reclaim.api('GetVerificationSession', {
				params: { sessionId: args.reclaimSessionId },
			})
			const status = sessionRes.data.status

			if(!TERMINAL.has(status)) {
				return { reclaimSessionId: args.reclaimSessionId, status, ready: false }
			}

			const resultRes = await reclaim.api('GetVerificationResult', {
				params: { sessionId: args.reclaimSessionId },
			})
			const signed = resultRes.data.items
				.filter((item) => RESULT_EVENTS.has(item.event))
			if(!signed.length) {
				return {
					reclaimSessionId: args.reclaimSessionId,
					status,
					ready: false,
					note: 'Session is terminal but no result is stored: none submitted '
						+ 'yet, or no callback subscription covers its ending event.',
				}
			}

			// Builder keeps a result (which can carry proofs) only until its
			// callback is delivered, or 7 days undelivered.
			const items = signed.flatMap((item) => (
				item.payload === null ? [] : [{ ...item, payload: item.payload }]
			))
			if(!items.length) {
				return {
					reclaimSessionId: args.reclaimSessionId,
					status,
					ready: false,
					delivered: signed.some((item) => (
						item.deliveryStatus === 'delivered'
					)),
					note: 'Builder no longer holds this result: it was delivered to '
						+ 'the callback (read it there), or went undelivered for 7 days. '
						+ 'See list_verification_deliveries.',
				}
			}

			// Each item's `payload` is an ECIES ciphertext encrypted to the org's
			// public key, or the plaintext signed JWS. `decryptCallback`
			// branches on the body shape; an encrypted delivery with no key throws
			// a clear error, which we surface per-subscription rather than skip.
			const results: unknown[] = []
			const undecryptable: string[] = []
			for(const item of items) {
				let jws
				try {
					jws = await decryptCallback(decryptionKey, item.payload)
				} catch(err) {
					undecryptable.push(item.subscriptionId)
					void err
					continue
				}

				const outcome = await reclaim.results.verify(jws, {
					reclaimSessionId: args.reclaimSessionId,
				})
				results.push({
					subscriptionId: item.subscriptionId,
					payload: outcome.payload,
					proofs: outcome.proofs,
				})
			}

			if(!results.length) {
				return {
					reclaimSessionId: args.reclaimSessionId,
					status,
					ready: false,
					note:
						'A result was stored, but no payload could be read — it is ' +
						'corrupt, or encrypted (ECIES) to a key this consumer does not ' +
						'hold. Set RECLAIM_DECRYPT_KEY (or reclaim-decrypt.key) to the ' +
						'eth private key matching the org keypair.',
				}
			}

			return {
				reclaimSessionId: args.reclaimSessionId,
				status,
				ready: true,
				results,
				...(undecryptable.length ? { undecryptable } : {}),
			}
		},
	)
}
