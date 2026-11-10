import { decryptCallback, ReclaimVerification } from '@reclaimprotocol/client'
import { apiUrl } from '../../../consts.ts'
import { defineTool, type RegisteredTool } from '../../server.ts'
import { resolveDecryptionKey } from '../authenticate/decrypt-key.ts'
import {
	type CallbackDeps,
	type CallbackEvent,
	ensureListener,
	orgClient,
} from './callback-listener.ts'
import { resolveOrgSecret } from './result.ts'

interface ReadArgs {
	sessionId?: string
	after?: string
	limit?: number
	pending?: boolean
	orgToken?: string
}

/** Events whose `data` is the signed result (encrypted or plaintext JWS). */
const RESULT_EVENTS = new Set([
	'verification_success',
	'verification_rejected',
	'verification_error',
	'verification_cancelled',
])

export function readCallbackEventsTool(
	deps: CallbackDeps = {},
): RegisteredTool {
	return defineTool<ReadArgs>(
		{
			name: 'read_callback_events',
			description:
				'Reads the events Reclaim sent to the organization\'s pull '
				+ 'listener, and decodes them: each result event is decrypted and '
				+ 'signature-verified into `result`, and each lifecycle event '
				+ 'returns its `eventData`. Call it to try a provider without an '
				+ 'app or to check what Reclaim sent for a session. Creates the '
				+ 'listener on first use, so it is not read-only. Filter with '
				+ '`sessionId`, or pass the previous `next` as `after` to read on. '
				+ 'Items with a lower sequence can appear late, so for a complete '
				+ 'read use `pending: true`. Returns `{ listener, items, next }`. '
				+ 'Encrypted results need the `RECLAIM_DECRYPT_KEY` that matches '
				+ 'the org keypair. To deliver events to your app\'s callback '
				+ 'route, call `proxy_callback_events`.',
			inputSchema: {
				type: 'object',
				properties: {
					sessionId: {
						type: 'string',
						format: 'uuid',
						description: 'Only events of this verification session.',
					},
					after: {
						type: 'string',
						pattern: '^[0-9]{1,19}$',
						description: 'The `next` value of a previous call.',
					},
					limit: {
						type: 'integer',
						minimum: 1,
						maximum: 100,
						description: 'Events to return. Defaults to 50.',
					},
					pending: {
						type: 'boolean',
						description:
							'Only events not yet acknowledged. `proxy_callback_events` '
							+ 'acknowledges the events it delivers.',
					},
					orgToken: {
						type: 'string',
						pattern: '^rorg_',
						maxLength: 200,
						description: 'The organization API key (`rorg_…`). Defaults to '
							+ 'the server\'s `RECLAIM_ORG_SECRET`, then the key saved by '
							+ '`issue_org_token`. Never echo it back to the user.',
					},
				},
			},
			annotations: {
				readOnlyHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async(args) => {
			const secret = resolveOrgSecret(args.orgToken)
			const client = orgClient(secret, deps)
			const listener = await ensureListener(secret, deps)
			const { data } = await client.call('ListCallbackEvents', {
				query: {
					after: args.after,
					limit: args.limit,
					sessionId: args.sessionId,
					pending: args.pending,
				},
			})

			const hasResults = data.items.some((e) => RESULT_EVENTS.has(e.event))
			const key = hasResults ? await resolveDecryptionKey() : undefined
			const reclaim = ReclaimVerification.create({
				baseUrl: apiUrl(),
				orgSecret: secret,
				fetch: deps.fetch,
			})
			const items = []
			for(const item of data.items) {
				items.push(await decode(item))
			}

			return {
				listener,
				items,
				next: data.next,
				...(listener.created
					? {
						_notes: 'Created the pull listener; only sessions created from '
							+ 'now on are recorded. It works only while this MCP server '
							+ 'runs.',
					}
					: {}),
			}

			async function decode(item: CallbackEvent) {
				const base = {
					id: item.id,
					sessionId: item.sessionId,
					event: item.event,
					deliveryStatus: item.deliveryStatus,
					createdAt: item.createdAt,
				}
				try {
					if(!RESULT_EVENTS.has(item.event)) {
						const received = await reclaim.results.receive(item.envelope)
						return received.kind === 'event'
							? { ...base, eventData: received.eventData }
							: base
					}

					const jws = await decryptCallback(key, item.envelope)
					const outcome = await reclaim.results.verify(jws, {
						reclaimSessionId: item.sessionId,
					})
					return {
						...base,
						result: { payload: outcome.payload, proofs: outcome.proofs },
					}
				} catch(err) {
					const message = err instanceof Error ? err.message : String(err)
					return RESULT_EVENTS.has(item.event)
						? { ...base, resultError: message }
						: { ...base, eventError: message }
				}
			}
		},
	)
}
