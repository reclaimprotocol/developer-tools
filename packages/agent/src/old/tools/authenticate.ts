import { agentDisabled } from '../../consts.ts'
import { defineTool, type RegisteredTool } from '../../mcp/server.ts'
import type { OldIdentity, ReclaimOldClient } from '../client.ts'
import { persistIdentity, toEthUid } from '../identity.ts'
import { captureFirebaseTokenViaCdp } from '../login-cdp.ts'

/**
 * OLD-devtools authenticate. The default, zero-arg flow drives only a local
 * Chrome through loopback CDP. It never uses a Builder, container, custom-CDP,
 * or shared browser. It opens the devtools dashboard, waits for the developer
 * to sign in, reads the Firebase ID token from page storage, then closes the
 * tab or the dedicated browser it launched. Two manual overrides remain:
 *
 *   - `token`: paste a Firebase ID token yourself (skips the browser).
 *   - `ethAddress`: an `eth:<addr>`/`0x…` uid for an already-provisioned eth
 *     user (header carries no signature, so the uid must already exist).
 *
 * The chosen identity is attached to the shared client and persisted to
 * `~/.reclaim/config.json` so later calls and future restarts reuse it. A
 * zero-arg call reuses a still-valid stored identity before falling back to
 * the browser flow.
 */
export function authenticateTool(client: ReclaimOldClient): RegisteredTool {
	/** Validate an identity against the backend (throws on failure). */
	const validate = async(identity: OldIdentity): Promise<void> => {
		client.setIdentity(identity)
		if(identity.kind === 'bearer') {
			await client.loginWithToken()
		} else {
			await client.getMyProviders({ pageSize: 1 })
		}
	}

	return defineTool<{
		token?: string
		ethAddress?: string
		loginUrl?: string
		timeoutMs?: number
		useBrowser?: boolean
	}>(
		{
			name: 'reclaim_authenticate',
			description:
				'Authenticate against the OLD Reclaim devtools backend. \n\n' +
				'Default (no args): opens the devtools dashboard in a LOCAL Chrome ' +
				'over loopback CDP. It never uses a Builder, container, custom-CDP, ' +
				'or shared browser. It ' +
				'waits for you to sign in, grabs the Firebase token automatically, ' +
				'and closes the tab. A previously stored identity that is still ' +
				'valid is reused first (pass `useBrowser: true` to force a fresh ' +
				'login). \n\n' +
				'EXPECT THIS TO TAKE A WHILE ON A FIRST RUN: a fresh Chrome ' +
				'profile downloads the dashboard cold, so tell the developer it is ' +
				'loading and that the window is waiting for them — do not re-run ' +
				'the tool while it is still waiting. It polls for up to 6 minutes ' +
				'and reports whether the page ever became interactive.\n\n' +
				'Manual overrides:\n' +
				'- `token`: paste a Firebase ID token (skips the browser).\n' +
				'- `ethAddress`: an `eth:0x…` / `0x…` uid for an already-provisioned ' +
				'eth user (returns 401 "ETH user not found" if unknown).\n\n' +
				'The identity is cached locally for subsequent publish / ' +
				'get_me_providers calls. Firebase tokens are short-lived (~1h) — ' +
				're-run this when calls start returning 401.',
			inputSchema: {
				type: 'object',
				properties: {
					token: {
						type: 'string',
						description: 'Firebase ID token (skips the browser flow).',
					},
					ethAddress: {
						type: 'string',
						description: 'eth uid (`eth:0x…`) or bare `0x…` address.',
					},
					loginUrl: {
						type: 'string',
						description:
							'Dashboard URL to open for the browser flow ' +
							'(default https://dev.reclaimprotocol.org).',
					},
					timeoutMs: {
						type: 'number',
						description:
							'How long to wait for sign-in, in ms (default 360000, i.e. 6 '
							+ 'minutes). A fresh Chrome profile loads the dashboard cold, '
							+ 'which can take tens of seconds before the form is usable — '
							+ 'that time comes out of this budget.',
					},
					useBrowser: {
						type: 'boolean',
						description:
							'Force the browser login even if a stored identity exists.',
					},
				},
			},
		},
		async({ token, ethAddress, loginUrl, timeoutMs, useBrowser }) => {
			if(token && ethAddress) {
				throw new Error(
					'Provide only ONE of `token` or `ethAddress`, not both.',
				)
			}

			// Explicit credential paths skip the browser entirely.
			if(token || ethAddress) {
				const identity: OldIdentity = token
					? { kind: 'bearer', token: token.trim() }
					: toEthUid(ethAddress!)
				await validate(identity)
				persistIdentity(identity)
				return {
					authenticated: true,
					method: identity.kind === 'bearer' ? 'token' : 'eth',
					identity:
						identity.kind === 'bearer'
							? { kind: 'bearer' }
							: { kind: 'eth', uid: identity.uid },
				}
			}

			// Reuse a still-valid stored/env identity before opening a browser.
			if(!useBrowser) {
				const existing = client.getIdentity()
				if(existing) {
					try {
						await validate(existing)
						persistIdentity(existing)
						return {
							authenticated: true,
							method: 'reused',
							identity:
								existing.kind === 'bearer'
									? { kind: 'bearer' }
									: { kind: 'eth', uid: existing.uid },
						}
					} catch{
						// Stale/expired — fall through to the browser flow.
					}
				}
			}

			// CDP browser login (the default headline flow).
			if(agentDisabled()) {
				throw new Error(
					'Browser login is unavailable (RECLAIM_AGENT_DISABLED=1). Pass a ' +
					'`token` (Firebase ID token) or `ethAddress` instead.',
				)
			}

			const result = await captureFirebaseTokenViaCdp({ loginUrl, timeoutMs })
			const identity: OldIdentity = { kind: 'bearer', token: result.token }
			await validate(identity)
			persistIdentity(identity)
			return {
				authenticated: true,
				method: 'browser',
				browser: 'local-chrome',
				closedBrowser: result.closedBrowser,
				note:
					'Signed in via the dashboard; Firebase token captured and cached. ' +
					'Tokens expire (~1h) — re-run reclaim_authenticate on 401.',
			}
		},
	)
}
