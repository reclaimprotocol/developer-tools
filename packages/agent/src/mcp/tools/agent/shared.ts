/**
 * Build the shared authoring tools for the MCP, bound to a per-capture LOCAL
 * backend: a Chrome tab over CDP + the in-process attestor SDK. The tool logic
 * (navigate/inspect/propose/replay/prove) is authored once in `../../../
 * authoring` with the shared `defineTool` primitive; this only supplies the
 * MCP host — resolve the backend from `captureId` (the session handle from
 * `start_capture`, since one capture bundles the tab, its requests, and its
 * drafts) and the rich, credential-aware `run_proof` schema.
 */
import type { JSONSchema } from 'zod/v4/core'
import {
	type AuthoringBackend,
	authoringTools,
	extendTool,
	type KeptScriptRef,
} from '../../../authoring/index.ts'
import { lookupIpCountry } from '../../../cdp/geo.ts'
import { runAttestorProof } from '../../../proof/attestor.ts'
import { checkAttestor } from '../../../proof/check-attestor.ts'
import { replayProviderInPage } from '../../../proof/page-replay.ts'
import {
	DYNAMIC_GEO,
	normalizeGeoLocation,
	type OprfMode,
	type ReclaimProvider,
} from '../../../provider/schema.ts'
import type { RegisteredTool } from '../../server.ts'
import {
	GENERATED_KEY_NOTE,
	resolveOrCreateEthKey,
} from '../authenticate/eth-key.ts'
import type { CaptureEntry, CaptureStore } from './capture.ts'
import { diagnoseNetworkFailure, shapeRichProofResult } from './proof.ts'

/**
 * OPRF mode this LOCAL (non-TEE) attestor can actually run. Recipes carry
 * `oprf-mpc` — the canonical/publish mode a TEE expects — but the local dev
 * attestor can't do MPC. gnark `oprf` (Linux/Mac, needs ZK circuits) is the
 * strongest it supports; Windows falls back to server-side `oprf-raw` (no
 * circuits). Proving with the wrong mode fails, which is what pushed the agent
 * to hand-craft a plaintext workaround.
 */
const LOCAL_OPRF_MODE: OprfMode =
	process.platform === 'win32' ? 'oprf-raw' : 'oprf'

/**
 * Clone `provider` with every `oprf-mpc` redaction remapped to the mode this
 * local attestor can run, so the PROOF validates locally. The draft itself is
 * untouched — it keeps `oprf-mpc`, so the PUBLISHED recipe is always the
 * TEE-canonical mode regardless of where it was proved.
 */
function withLocalOprfMode(provider: ReclaimProvider): ReclaimProvider {
	const reds = provider.responseRedactions
	if(!reds?.some((r) => r.hash === 'oprf-mpc')) {
		return provider
	}

	return {
		...provider,
		responseRedactions: reds.map((r) => {
			return r.hash === 'oprf-mpc' ? { ...r, hash: LOCAL_OPRF_MODE } : r
		}),
	}
}

/** Templates a verification client replaces with the end user's country. */
const DYNAMIC_GEO_TEMPLATES = new Set([DYNAMIC_GEO, '{{DYNAMIC_GEO_SECRET}}'])

export interface ProofEgress {
	/** ISO country (or param template) the attestor's request goes out from;
	 *  absent when it goes out from the attestor's own network. */
	geoLocation?: string
	source: 'argument' | 'draft' | 'developer-ip' | 'none'
}

/**
 * Where a local proof's request goes out from, resolved the way a
 * verification client does it: the `geoLocation` argument, else the draft's
 * fixed country, else (unset or `{{DYNAMIC_GEO}}`) the developer's own IP
 * country, which is what `{{DYNAMIC_GEO}}` becomes when they verify.
 */
async function resolveProofEgress(
	provider: ReclaimProvider,
	argument: string | undefined,
	lookupCountry: () => Promise<string | undefined>,
): Promise<ProofEgress> {
	if(argument) {
		return { geoLocation: argument.toUpperCase(), source: 'argument' }
	}

	const fixed = normalizeGeoLocation(provider.geoLocation)
	if(fixed && !DYNAMIC_GEO_TEMPLATES.has(fixed)) {
		return { geoLocation: fixed, source: 'draft' }
	}

	const country = await lookupCountry()
	return country
		? { geoLocation: country, source: 'developer-ip' }
		: { source: 'none' }
}

/** The local backend for one capture: drive its tab over CDP, read its
 *  captured requests, prove via the in-process attestor, replay by re-fetching
 *  FROM INSIDE the tab (real cookies/session — see proof/page-replay.ts). */
function localBackend(
	entry: CaptureEntry,
	kept: KeptScriptRef,
	check: typeof checkAttestor,
	runProof: typeof runAttestorProof,
	lookupCountry: () => Promise<string | undefined>,
): AuthoringBackend {
	const { tabClient, session, drafts } = entry
	const sendCdp = (method: string, params?: Record<string, unknown>) => {
		return tabClient.send(method, params ?? {})
	}

	return {
		kept,
		capture: session,
		drafts,
		sendCdp,
		waitForEvent: (method, timeoutMs) => new Promise((resolve) => {
			let stopListening = () => {}

			const onEvent = () => {
				cleanup()
				resolve('fired')
			}

			const timer = setTimeout(() => {
				cleanup()
				resolve('timeout')
			}, timeoutMs)
			const cleanup = () => {
				clearTimeout(timer)
				stopListening()
			}

			stopListening = tabClient.subscribeOnce(method, onEvent)
		}),
		replay: async(draft, opts) => {
			// Replayed FROM INSIDE the attached tab (real cookies/session), not
			// a detached Node fetch — see proof/page-replay.ts.
			const result = await replayProviderInPage(
				{ sendCdp }, draft.provider, draft.secrets, opts,
			)
			// Remember the authenticated replay so a failed proof can tell "the
			// site blocks non-browser clients" from a broken recipe.
			if(!opts?.withoutSecrets) {
				draft.lastReplay = {
					status: result.status,
					ok: result.status >= 200 && result.status < 300
						&& result.matchesOriginal,
				}
			}

			return {
				status: result.status,
				matchesOriginal: result.matchesOriginal,
				bodySnippet: result.body.slice(0, 256),
				...(result.hints !== undefined ? { hints: result.hints } : {}),
			}
		},
		prove: async(draft, opts) => {
			// No ownerAddress: resolve the configured key, or create a local test
			// key, so a proof never stops to ask the developer for one.
			const ownerKey = opts?.ownerAddress
				? undefined
				: resolveOrCreateEthKey()
			const ownerAddress = opts?.ownerAddress ?? ownerKey?.address
			const egress = await resolveProofEgress(
				draft.provider, opts?.geoLocation, lookupCountry,
			)
			// Prove with the locally-runnable OPRF mode and the resolved egress;
			// the draft (→ published recipe) keeps oprf-mpc and its template.
			const { geoLocation: _template, ...provider } = withLocalOprfMode(
				draft.provider,
			)
			void _template
			const result = await runProof(
				{
					...provider,
					...(egress.geoLocation ? { geoLocation: egress.geoLocation } : {}),
				},
				draft.secrets,
				{
					...(ownerAddress ? { ownerAddress } : {}),
					...(opts?.attestorUrl ? { attestorUrl: opts.attestorUrl } : {}),
				},
			)
			const shaped = shapeRichProofResult(result, {
				provider: draft.provider,
				hasSecrets: Object.keys(draft.secrets).length > 0,
				...(opts?.attestorUrl ? { attestorUrl: opts.attestorUrl } : {}),
				...(draft.lastReplay ? { lastReplay: draft.lastReplay } : {}),
				egress,
			})
			const diagnosis = await diagnoseNetworkFailure(
				result, check, opts?.attestorUrl,
			)
			return {
				...shaped,
				egress,
				...(diagnosis ? { diagnosis } : {}),
				...(ownerKey?.source === 'generated'
					? {
						ownerKey: {
							address: ownerKey.address,
							source: ownerKey.source,
							path: ownerKey.path,
							note: GENERATED_KEY_NOTE,
						},
					}
					: {}),
			}
		},
	}
}

/** The MCP's rich, credential-aware `run_proof` schema, merged onto the shared
 *  tool by the host below (the cloud's TEE signs in-enclave, so it needs none
 *  of this). */
const RUN_PROOF_EXTRAS = {
	description:
		'Proves the drafted recipe with a full zkTLS proof through the attestor '
		+ 'SDK. Call it after `replay_request` looks right; attestor calls are '
		+ 'expensive. It signs with the configured proof-owner key and creates '
		+ 'a local test key in the project `.env` when none exists; then the '
		+ 'result has `ownerKey` with a `note`: tell the developer once, after '
		+ 'the fact. Do not ask for a key first. Writes the full claim to '
		+ '`~/.reclaim/claims/<timestamp>.json`. Returns `identifier`, '
		+ '`extractedParameters`, `claimPath`, and a readable `claim` (request '
		+ 'removed, byte arrays as base64). Set `RECLAIM_AGENT_TRACE=1` to also '
		+ 'get `runLogPath`, a diagnostic dump with the attestor log stream. '
		+ 'Set `attestorUrl` only if the developer supplied one; never invent '
		+ 'backup URLs. If `errorKind` is `missing-owner-key`, the '
		+ '`ownerAddress` you passed has no known private key: retry without '
		+ '`ownerAddress`. Unlike `replay_request`, which re-sends from '
		+ 'inside the attached browser tab, the attestor calls the target from '
		+ 'its own network and IP. A request that replayed can still fail here '
		+ 'for geo- or IP-bound content, such as country-locked pages or '
		+ 'IP-allowlisted APIs. That is a property of the site, not a draft '
		+ 'bug. The request goes out from `egress.geoLocation` in the result: '
		+ 'the `geoLocation` argument, else the draft\'s fixed country, else '
		+ 'your own IP country. After a network-like failure ("connection closed", '
		+ '`ERROR_NETWORK_ERROR`, timeout), the result includes `diagnosis` '
		+ 'with `attestor` (a `check_attestor` result), `likelyCause`, and '
		+ '`next`. Follow `next`; do not retry the same proof. When the '
		+ 'attestor gets HTTP 403/406/429/503 or a challenge page, `diagnosis` '
		+ 'has `kind: "blocked-non-browser-client"`: the site blocks '
		+ 'non-browser clients or traffic from that country, and copying '
		+ 'headers or cookies will not help. Follow its `next`. Run '
		+ '`check_matchers` first to rule out the recipe offline.',
	properties: {
		ownerAddress: {
			type: 'string',
			pattern: '^0x[0-9a-fA-F]{40}$',
			description:
				'Optional ETH address the resolved signing key must match. Omit '
				+ 'it: run_proof resolves (or creates) the key itself. The '
				+ 'private key is resolved locally (env / .env / key file), '
				+ 'never passed here.',
		},
		attestorUrl: { type: 'string' },
		geoLocation: {
			type: 'string',
			pattern: '^[A-Za-z]{2}$',
			description:
				'ISO country the attestor\'s request goes out from, for example '
				+ '`US`. Omit it to use the draft\'s fixed country, or else your '
				+ 'own IP country, as `{{DYNAMIC_GEO}}` resolves for you when you '
				+ 'verify.',
		},
	},
	required: [],
} satisfies {
	description: string
	properties: JSONSchema.ObjectSchema['properties']
	required: string[]
}

/** The shared authoring tools mapped to the MCP's shape: resolve each call's
 *  local backend from `args.captureId`, and widen the input schema — every tool
 *  takes `captureId`; `run_proof` also gets the credential-aware contract. The
 *  tools are authored plain in `../../../authoring`; this only wraps them with
 *  `extendTool` (handlers untouched — loose arg parse keeps `captureId`). */
export function sharedAuthoringTools(
	captures: CaptureStore,
	check: typeof checkAttestor = checkAttestor,
	runProof: typeof runAttestorProof = runAttestorProof,
	lookupCountry: () => Promise<string | undefined> = lookupIpCountry,
): RegisteredTool[] {
	const resolveBackend = (args: Record<string, unknown>): AuthoringBackend => {
		const captureId = String(args.captureId)
		const entry = captures.sessions.get(captureId)
		if(!entry) {
			throw new Error(
				`no capture ${captureId} — call start_capture first `
				+ '(it has been reset or never started).',
			)
		}

		return localBackend(entry, captures, check, runProof, lookupCountry)
	}

	return authoringTools(resolveBackend).map((tool) => {
		if(tool.definition.name === 'run_proof') {
			return extendTool(tool, {
				description: RUN_PROOF_EXTRAS.description,
				properties: {
					captureId: { type: 'string' },
					...RUN_PROOF_EXTRAS.properties,
				},
				required: ['captureId', ...RUN_PROOF_EXTRAS.required],
			})
		}

		return extendTool(tool, {
			properties: { captureId: { type: 'string' } },
			required: ['captureId'],
		})
	})
}
