/**
 * Declarative entry point for the consumer SDK. The ONLY config is the org
 * secret (`rorg_…`) — it authenticates every call and identifies the org
 * server-side. Pass the optional organization ETH private key only to the
 * operation that needs it:
 *
 *   const reclaim = ReclaimVerification.create({ orgSecret })
 *   const session = await reclaim.sessions.create({
 *   	providers,
 *   	context,
 *   	orgEthPrivateKey, // optional TEE session binding
 *   })
 *   // …end-user completes session.verificationUrl…
 *   const outcome = await reclaim.results.receive(callbackBody, {
 *   	orgEthPrivateKey, // optional decryption and TEE proof verification
 *   	reclaimSessionId: session.id,
 *   })
 *
 * Built by composition over the package's pure helpers (`decryptCallback`,
 * `verifyResultFull`, …) — drop down to those, or to `reclaim.api`, for full
 * control.
 */
import type { components } from './types/openapi.gen.ts'
import { ReclaimClient } from './client.ts'
import {
	type DecryptionKey,
	type DecryptionKeyInput,
	loadDecryptionKey,
} from './enckeys.ts'
import type { BuilderProofRecipe } from './proof-recipe.ts'
import { proofHashesFromBuilderRecipe } from './proof-recipe.ts'
import type { ReclaimRequestProof } from './proof-types.ts'
import {
	type CallbackBody,
	decryptCallback,
	type Jws,
	verifyResultFull,
	type VerifyResultFullOptions,
	type VerifyResultFullOutcome,
} from './result.ts'
import {
	createBuilderTeeBinding,
	type LegacyTeeNonceMode,
} from './tee-binding.ts'

type VerificationSession = components['schemas']['VerificationSession']
type VerificationEvent = components['schemas']['VerificationEvent']
type VerificationEventRecord = components['schemas']['VerificationEventRecord']

const SIGNED_RESULT_EVENTS = [
	'verification_success',
	'verification_rejected',
	'verification_error',
] as const

export interface CreateSessionInput {
	/** Providers to verify, in run order. The end-user proves each (one browser
	 *  session) and one combined result is delivered; all are required. */
	providers: { providerId: string, version?: string }[]
	context: Record<string, unknown>
	/** Exact registered Verification Client base URL. Defaults to the Portal.
	 *  It may contain a
	 *  `{sessionId}` placeholder; Builder otherwise adds the session id as a
	 *  query parameter. Open the returned `verificationUrl`, not this base
	 *  URL. */
	verificationClientUrl?: string
	/** Optional legacy-compatible TEE session binding. The organization's ETH
	 *  private key never leaves this process.
	 *  Session creation returns only after Builder stores the signed binding. */
	orgEthPrivateKey?: string
	/** Override the legacy TEE nonce mode when binding a session. */
	teeNonceMode?: LegacyTeeNonceMode
	/** Opt this session into diagnostic mode: more event detail, including
	 *  personal data such as the claimant's IP addresses. Builder builds
	 *  `verificationUrl` with `diag=1` for a diagnostic session — do not
	 *  append `diag` to the URL directly, since Builder strips it and derives
	 *  the parameter from this flag instead. Treat a diagnostic
	 *  `verificationUrl` as sensitive. */
	diagnostics?: boolean
}

/** Input for explicitly binding a session's legacy-compatible TEE context. */
export interface BindSessionTeeNonceInput {
	orgEthPrivateKey: string
	timestamp?: string
	/** `hash` is the default. Use `signature` only for an older Verification
	 * Client that expects the 65-byte EIP-191 nonce. */
	teeNonceMode?: LegacyTeeNonceMode
}

export interface ReclaimConfig {
	/** The org secret (`rorg_…`). Authenticates ALL API calls and identifies
	 *  the org server-side. The only required config. */
	orgSecret: string
	/** Backend base URL. Defaults to the production Builder. */
	baseUrl?: string
	/** Custom fetch implementation. */
	fetch?: typeof fetch
	/** Extra headers merged into every request. */
	headers?: Record<string, string>
}

/** Serializable SDK configuration.
 *  Credentials and runtime hooks are omitted. */
export interface ReclaimVerificationState {
	version: 1
	baseUrl: string
}

/** Runtime-only values required to restore serialized SDK configuration. */
export type ImportReclaimVerificationConfig = Omit<ReclaimConfig, 'baseUrl'>

/** Options for `results.receive` — the verification options plus an optional
 *  eth decryption key (the org's eth private key as `0x`-hex). The key is
 *  needed only when the delivery is an ECIES ciphertext. */
export type ReceiveOptions = VerifyResultFullOptions

/** A thin backend-side handle on a session's `verificationUrl` — see
 *  `reclaim.flow`. Not the browser launcher: this holds no device
 *  detection or launch mechanism, only the URL the browser needs. The
 *  browser-only `ReclaimFlow.from(session)` in
 *  `@reclaimprotocol/client/launch` is the counterpart that actually
 *  resolves how to open it. */
export interface SessionFlow {
	/** `session.verificationUrl`. A `Promise` so backend code calling this
	 *  doesn't need to special-case it against the browser `ReclaimFlow`'s
	 *  `getUrl()`, which does real async work. */
	getUrl(): Promise<string>
	readonly session: VerificationSession
}

/** `reclaim.flow(session)` wraps a session already created via
 *  `sessions.create`/`sessions.get`; `reclaim.flow.create(input)` creates one
 *  and wraps it in the same step. */
export interface ReclaimFlowFactory {
	(session: VerificationSession): SessionFlow
	create(input: CreateSessionInput): Promise<SessionFlow>
}

export interface ReclaimVerification {
	/** Serialize non-secret configuration. Credentials, headers, and custom
	 *  fetch implementations are never included. */
	export(): string
	/** Typed escape hatch: `reclaim.api('OperationId', args)` for any spec
	 *  operation. */
	api: ReclaimClient['call']
	sessions: {
		/** Create a verification session. `verificationClientUrl` defaults to
		 *  the Portal, `VerificationClient.portals`. */
		create(input: CreateSessionInput): Promise<VerificationSession>
		/** Add the immutable legacy-compatible TEE context after session
		 *  creation. Normally use
		 *  `sessions.create({ orgEthPrivateKey })`; this method
		 *  supports retrying or explicitly orchestrating the two-step flow. */
		bindTeeNonce(
			reclaimSessionId: string,
			input: BindSessionTeeNonceInput,
		): Promise<VerificationSession>
		get(reclaimSessionId: string): Promise<VerificationSession>
		listEvents(reclaimSessionId: string): Promise<VerificationEventRecord[]>
	}
	results: {
		/** Decrypt a callback body (ECIES ciphertext or plaintext JWS) to the
		 *  signed JWS. Pass `orgEthPrivateKey` only when the delivery is
		 *  encrypted. */
		decrypt(
			body: CallbackBody,
			orgEthPrivateKey?: DecryptionKeyInput,
		): Promise<Jws>
		/** Verify a decrypted JWS: JWKS discovery, ES256K signature,
		 *  `reclaimSessionId`/`aud`, any legacy `exp`, and exact proofs. */
		verify(
			jws: Jws,
			opts?: VerifyResultFullOptions,
		): Promise<VerifyResultFullOutcome>
		/** Handle any callback delivery in one call — the 90% path. Branches on
		 *  the envelope's `event`: a terminal event is decrypted (with
		 *  `opts.orgEthPrivateKey` when encrypted) and verified into a `result`; a
		 *  non-terminal event is returned as a plaintext (unsigned) `event`
		 *  notification without decryption. (A raw JWE/JWS body with no envelope
		 *  `event` is treated as a terminal result.) */
		receive(
			body: CallbackBody,
			opts?: ReceiveOptions,
		): Promise<ReceivedDelivery>
	}
	/** `reclaim.flow(session)` — see `ReclaimFlowFactory`. */
	flow: ReclaimFlowFactory
}

/** Outcome of `results.receive` — a verified terminal result or a plaintext
 *  non-terminal progress notification. Branch on `kind`. */
export type ReceivedDelivery =
	| { kind: 'result', result: VerifyResultFullOutcome }
	| {
		kind: 'event'
		event: VerificationEvent
		eventData: Record<string, unknown>
	}

export const ReclaimVerification = Object.freeze({
	create: createReclaimVerification,
	import: importReclaimVerification,
})

function importReclaimVerification(
	serialized: string,
	config: ImportReclaimVerificationConfig,
) {
	const state = parseReclaimVerificationState(serialized)
	return createReclaimVerification({ ...config, baseUrl: state.baseUrl })
}

function createReclaimVerification(
	config: ReclaimConfig,
): ReclaimVerification {
	if(!config?.orgSecret) {
		throw new Error(
			'ReclaimVerification.create requires an org secret — pass '
				+ 'ReclaimVerification.create({ orgSecret: <rorg_… org secret> })',
		)
	}

	const client = new ReclaimClient({
		baseUrl: config.baseUrl,
		token: config.orgSecret,
		fetch: config.fetch,
		headers: config.headers,
	})

	// Load the eth decryption key on demand — `undefined` input ⇒ no key, so
	// plaintext-only consumers never touch the loader.
	const resolveKey = (
		input: DecryptionKeyInput | undefined,
	): DecryptionKey | undefined => (
		input === undefined ? undefined : loadDecryptionKey(input)
	)

	return {
		export() {
			return JSON.stringify({
				version: 1,
				baseUrl: client.baseUrl,
			} satisfies ReclaimVerificationState)
		},
		api: client.call.bind(client),
		sessions: {
			create: createSession,
			async bindTeeNonce(reclaimSessionId, input) {
				const { data } = await client.call('GetVerificationSession', {
					params: { sessionId: reclaimSessionId },
				})
				return bindTeeNonce(data, input)
			},
			async get(reclaimSessionId) {
				const { data } = await client.call('GetVerificationSession', {
					params: { sessionId: reclaimSessionId },
				})
				return data
			},
			async listEvents(reclaimSessionId) {
				const { data } = await client.call('ListVerificationEvents', {
					params: { sessionId: reclaimSessionId },
				})
				return data.items
			},
		},
		results: {
			async decrypt(body, orgEthPrivateKey) {
				return decryptCallback(resolveKey(orgEthPrivateKey), body)
			},
			verify(jws, opts) {
				return verifyResultFull(jws, {
					fetchImpl: config.fetch,
					...withBuilderTrust(opts),
				})
			},
			async receive(body, opts) {
				// A delivery envelope tagged with a non-terminal event carries a
				// plaintext, unsigned `{ event, eventData }` payload — return it
				// directly, no decryption/verification.
				if(
					body && typeof body === 'object'
					&& !(body instanceof Uint8Array)
					&& !(body instanceof ArrayBuffer)
				) {
					const env = body
					if(
						env.event
						&& !(SIGNED_RESULT_EVENTS as readonly string[]).includes(env.event)
					) {
						const decoded = parseEventData(env.data)
						return {
							kind: 'event',
							event: env.event,
							eventData: decoded,
						}
					}
				}

				const { orgEthPrivateKey, ...verifyOpts } = opts ?? {}
				const key = resolveKey(orgEthPrivateKey)
				const jws = await decryptCallback(key, body)
				const result = await verifyResultFull(jws, {
					fetchImpl: config.fetch,
					...withBuilderTrust({ ...verifyOpts, orgEthPrivateKey }),
				})
				return { kind: 'result', result }
			},
		},
		flow: Object.assign(
			(session: VerificationSession): SessionFlow => makeSessionFlow(session),
			{
				async create(input: CreateSessionInput): Promise<SessionFlow> {
					return makeSessionFlow(await createSession(input))
				},
			},
		),
	}

	async function createSession(
		input: CreateSessionInput,
	): Promise<VerificationSession> {
		const {
			orgEthPrivateKey,
			teeNonceMode,
			...request
		} = input
		const body:
		components['schemas']['CreateVerificationSessionRequest'] = {
			...request,
		}
		const { data } = await client.call('CreateVerificationSession', {
			body,
		})
		return orgEthPrivateKey
			? bindTeeNonce(data, {
				orgEthPrivateKey,
				teeNonceMode,
			})
			: data
	}

	async function bindTeeNonce(
		session: VerificationSession,
		input: BindSessionTeeNonceInput,
	) {
		const binding = createBuilderTeeBinding({
			organizationId: session.orgId,
			organizationVerificationPrivateKey: input.orgEthPrivateKey,
			sessionId: session.id,
			timestamp: input.timestamp ?? Date.now().toString(),
			nonceMode: input.teeNonceMode,
		})
		const { data } = await client.call('BindVerificationSessionTeeNonce', {
			params: { sessionId: session.id },
			body: {
				attestationNonce: binding.attestationNonce,
				attestationNonceData: binding.attestationNonceData,
				signature: binding.signature,
			},
		})
		return data
	}

	async function resolvedSession(id: string) {
		const { data } = await client.call(
			'GetVerificationRecipe',
			{ params: { sessionId: id } },
		)
		return { recipes: data.recipes satisfies BuilderProofRecipe[] }
	}

	async function resolvedProvider(
		providerId: string,
		providerVersion: string | undefined,
		_allowedTags: string[] | undefined,
		proofs: ReclaimRequestProof[],
	) {
		let exactVersion = providerVersion
		if(!exactVersion) {
			const { data: provider } = await client.call('GetProvider', {
				params: { providerId },
			})
			if(!provider.latestVersion) {
				throw new Error(`Provider ${providerId} has no live version`)
			}

			exactVersion = canonicalVersion(provider.latestVersion)
		}

		const { data: version } = await client.call('GetProviderVersion', {
			params: { providerId, version: exactVersion },
		})
		return [{
			hashes: proofHashesFromBuilderRecipe({
				providerId,
				resolvedVersion: exactVersion,
				initialUrl: version.initialUrl,
				requests: version.requests,
				allowedJsRequests: version.allowedJsRequests,
			}, proofs),
		}]
	}

	function withBuilderTrust(opts: VerifyResultFullOptions = {}) {
		const reclaimSessionId = opts.reclaimSessionId
		const requestedProofValidation = opts.proofValidation
		const resolvedOpts: VerifyResultFullOptions = {
			...opts,
			proofValidation: {
				...requestedProofValidation,
				resolveProvider: requestedProofValidation?.resolveProvider
					?? resolvedProvider,
			},
			...(reclaimSessionId && !opts.resolveSession && !opts.proofRecipes
				? { resolveSession: resolvedSession }
				: {}),
		}
		if(
			opts.signerPublicKey
			|| opts.trustedIssuers?.length
			|| opts.jwksUrl
		) {
			return resolvedOpts
		}

		return {
			...resolvedOpts,
			trustedIssuers: [client.baseUrl],
			jwksUrl: `${client.baseUrl}/.well-known/jwks.json`,
		}
	}
}

function makeSessionFlow(session: VerificationSession): SessionFlow {
	return {
		session,
		async getUrl() {
			return session.verificationUrl
		},
	}
}

function canonicalVersion(
	version: components['schemas']['ProviderVersionRef'],
) {
	const base = `${version.major}.${version.minor}.${version.patch}`
	return version.branch
		? `${base}-${version.branch}${version.buildNumber === undefined
			? ''
			: `.${version.buildNumber}`}`
		: base
}

/** Non-terminal `data` is a base64-encoded JSON `{ event, eventData }`. */
function parseEventData(data: string | undefined): Record<string, unknown> {
	if(!data) {
		return {}
	}

	try {
		const decoded = JSON.parse(
			Buffer.from(data, 'base64').toString('utf8'),
		) as { eventData?: Record<string, unknown> }
		return decoded.eventData ?? {}
	} catch{
		return {}
	}
}

function parseReclaimVerificationState(
	serialized: string,
): ReclaimVerificationState {
	const state: unknown = JSON.parse(serialized)
	if(
		!state
		|| typeof state !== 'object'
		|| Array.isArray(state)
		|| !('version' in state)
		|| state.version !== 1
		|| !('baseUrl' in state)
		|| typeof state.baseUrl !== 'string'
	) {
		throw new Error('Invalid ReclaimVerification state')
	}

	return { version: 1, baseUrl: state.baseUrl }
}
