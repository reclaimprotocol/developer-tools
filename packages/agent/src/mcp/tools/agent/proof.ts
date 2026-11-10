import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { agentTraceEnabled } from '../../../consts.ts'
import { reclaimHomeDirPath } from '../../../paths.ts'
import {
	type ProofResult,
	tailLogs,
	warnsAndErrors,
} from '../../../proof/attestor.ts'
import {
	type AttestorCheckResult,
	type CheckAttestorOptions,
	isNetworkError,
} from '../../../proof/check-attestor.ts'

function claimsDir(): string {
	return join(reclaimHomeDirPath(), 'claims')
}

function proofRunsDir(): string {
	return join(reclaimHomeDirPath(), 'proof-runs')
}

/** Persist everything we know about this proof attempt — input provider,
 *  sentParams the SDK saw, full captured logs, and the final result — to
 *  a file the dev can `cat` directly. This is the source of truth when
 *  the LLM's summary disagrees with reality. */
function writeProofRunDump(payload: {
	provider: unknown
	hasSecretParamsRef: boolean
	attestorUrl?: string
	result: Record<string, unknown>
}): string | undefined {
	try {
		mkdirSync(proofRunsDir(), { recursive: true })
		const path = join(proofRunsDir(), `${Date.now()}.json`)
		writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8')
		return path
	} catch{
		// Persistence is best-effort; never fail the proof for it.
		return undefined
	}
}

/**
 * Walk a claim object for display:
 *   - drop any `request` field at any depth (it's huge and only useful
 *     for low-level debugging — the on-disk claim still has it)
 *   - convert byte-like values (Uint8Array, or arrays where every entry
 *     is a number in [0,255]) to base64 strings so they render as
 *     readable text instead of `{"0":12,"1":34,...}`
 *
 * The on-disk file at claimPath is the raw, unprettified claim — this
 * function only affects what we return in the MCP tool response.
 */
function prettifyClaim(value: unknown): unknown {
	if(value === null || value === undefined) {
		return value
	}

	if(value instanceof Uint8Array) {
		return Buffer.from(value).toString('base64')
	}

	if(Array.isArray(value)) {
		if(isLikelyByteArray(value)) {
			return Buffer.from(value as number[]).toString('base64')
		}

		return value.map(prettifyClaim)
	}

	if(typeof value === 'object') {
		const out: Record<string, unknown> = {}
		for(const [k, v] of Object.entries(value as Record<string, unknown>)) {
			if(k === 'request') {
				continue
			}

			out[k] = prettifyClaim(v)
		}

		return out
	}

	return value
}

function isLikelyByteArray(v: unknown[]): boolean {
	if(v.length === 0) {
		return false
	}

	for(const x of v) {
		if(typeof x !== 'number' || !Number.isInteger(x) || x < 0 || x > 255) {
			return false
		}
	}

	return true
}

/**
 * The MCP's rich `run_proof` view: persist the full claim to disk, return
 * identifier + extractedParameters + a prettified claim (request dropped, byte
 * arrays as base64) + trimmed logs, and — under `RECLAIM_AGENT_TRACE=1` — a
 * forensic run dump. This is the developer-facing shape; the cloud backend
 * projects the same {@link ProofResult} to a lean summary instead.
 */
export function shapeRichProofResult(
	result: ProofResult,
	opts: {
		provider: unknown
		hasSecrets: boolean
		attestorUrl?: string
		/** The draft's latest authenticated in-browser replay, when tracked. */
		lastReplay?: { status: number, ok: boolean }
		/** Where the attestor's request went out from. */
		egress?: { geoLocation?: string }
	},
): Record<string, unknown> {
	// Persist the full claim to disk for the dev to inspect/share.
	let claimPath: string | undefined
	if(result.proof !== undefined && result.proof !== null) {
		try {
			mkdirSync(claimsDir(), { recursive: true })
			claimPath = join(claimsDir(), `${Date.now()}.json`)
			writeFileSync(claimPath, JSON.stringify(result.proof, null, 2), 'utf8')
		} catch{
			// Persistence is best-effort; don't fail the proof for it.
			claimPath = undefined
		}
	}

	const out: Record<string, unknown> = {
		verified: result.verified,
		extractedValue: result.extractedValue,
		extractedParameters: result.extractedParameters,
	}
	if(result.identifier !== undefined) {
		out.identifier = result.identifier
	}

	if(result.owner !== undefined) {
		out.owner = result.owner
	}

	if(claimPath !== undefined) {
		out.claimPath = claimPath
	}

	if(result.proof !== undefined && result.proof !== null) {
		out.claim = prettifyClaim(result.proof)
	}

	if(result.error !== undefined) {
		out.error = result.error
	}

	if(result.errorKind !== undefined) {
		out.errorKind = result.errorKind
	}

	const blocked = diagnoseBlockedClient(
		result, opts.lastReplay, opts.egress?.geoLocation,
	)
	if(blocked !== undefined) {
		out.diagnosis = blocked
	}

	// Trim the LLM-visible logs — full stream goes to runLogPath.
	if(result.attestorLogs !== undefined && result.attestorLogs.length > 0) {
		const logs = result.verified
			? warnsAndErrors(result.attestorLogs)
			: tailLogs(result.attestorLogs)
		if(logs.length > 0) {
			out.attestorLogs = logs
		}
	}

	if(result.sentParams !== undefined) {
		out.sentParams = result.sentParams
	}

	// Persist a diagnostic dump for forensics — gated behind
	// RECLAIM_AGENT_TRACE=1 (matches the attestor logger capture). Off by
	// default since happy-path runs don't need it; turn on when investigating
	// proof failures and the file at runLogPath will carry the input provider,
	// sentParams, full attestor log stream, and result.
	if(agentTraceEnabled()) {
		const runLogPath = writeProofRunDump({
			provider: opts.provider,
			hasSecretParamsRef: opts.hasSecrets,
			attestorUrl: opts.attestorUrl,
			result: {
				verified: result.verified,
				error: result.error,
				errorKind: result.errorKind,
				extractedValue: result.extractedValue,
				extractedParameters: result.extractedParameters,
				identifier: result.identifier,
				owner: result.owner,
				sentParams: result.sentParams,
				attestorLogs: result.attestorLogs,
				claimPath,
			},
		})
		if(runLogPath !== undefined) {
			out.runLogPath = runLogPath
		}
	}

	return out
}

/** HTTP statuses a site's bot protection answers non-browser clients with. */
const BLOCKING_STATUSES = new Set([403, 406, 429, 503])

/** Markers of a bot-protection / challenge page rather than real content. */
const CHALLENGE_BODY = new RegExp([
	'captcha', 'challenge', 'cf-chl', 'cf-ray', 'just a moment',
	'access denied', 'request unsuccessful', '_incapsula_', 'px-captcha',
	'perimeterx', 'datadome', 'akamai', 'bot detection', 'enable javascript',
	'are you a robot', 'unusual traffic',
].join('|'), 'i')

/** Below this, a response the browser rendered with the value in it is
 *  likely a shell or challenge page served to a non-browser client. */
const TINY_BODY_BYTES = 4096

export interface BlockedClientDiagnosis {
	kind: 'blocked-non-browser-client'
	/** HTTP status the attestor's request got, when the error carries one. */
	status?: number
	/** Set when the same draft's in-browser replay succeeded. */
	replayedInBrowser?: true
	likelyCause: string
	next: string
}

/**
 * Says when a failed proof looks like the site blocking non-browser clients:
 * the attestor's request got 403/406/429/503, or a tiny or challenge-looking
 * page where the browser got the real one. Returns undefined for verified
 * proofs and other failures. The raw `error` stays on the result.
 */
export function diagnoseBlockedClient(
	result: Pick<ProofResult, 'verified' | 'error'>,
	lastReplay?: { status: number, ok: boolean },
	geoLocation?: string,
): BlockedClientDiagnosis | undefined {
	if(result.verified || !result.error) {
		return undefined
	}

	const replayedInBrowser = lastReplay?.ok === true
	const statusMatch = new RegExp(
		'Expected status 2xx, got (\\d{3})|Provider returned error (\\d{3})',
	).exec(result.error)
	const status = Number(statusMatch?.[1] ?? statusMatch?.[2]) || undefined
	const blockedStatus = status !== undefined && BLOCKING_STATUSES.has(status)
	if(!blockedStatus && !(replayedInBrowser && challengeBody(result.error))) {
		return undefined
	}

	return {
		kind: 'blocked-non-browser-client',
		...(status !== undefined ? { status } : {}),
		...(replayedInBrowser ? { replayedInBrowser: true as const } : {}),
		likelyCause:
			(replayedInBrowser
				? 'The same request succeeded from inside the browser, but '
				: '')
			+ 'the site answered the attestor'
			+ (geoLocation
				? `, whose request went out from ${geoLocation}, with `
				: ', whose request went out from its own network, with ')
			+ (blockedStatus ? `HTTP ${status}` : 'a challenge or shell page')
			+ '. The site blocks traffic from that country, or non-browser '
			+ 'clients (bot protection or TLS fingerprinting). Copying headers or '
			+ 'cookies will not help.',
		next:
			'If the site serves one country (for example, a US airline), retry '
			+ 'run_proof once with `geoLocation` set to that country. If that '
			+ 'verifies, pin it with update_draft({ geoLocation }) so the '
			+ 'published version goes out from there too. Otherwise, try a '
			+ 'different endpoint that returns the value, such as a JSON API the '
			+ 'page calls (find_requests_containing), then propose and prove '
			+ 'that. If none works, stop retrying: publish the version from the '
			+ 'capture, unproven, and ask the developer to try a real '
			+ 'verification (how_it_works({ topic: "prove" })). Do not tweak '
			+ 'headers.',
	}
}

/** True when an attestor error embeds a response element (base64, from a
 *  regex redaction that didn't match) that is tiny or a challenge page. */
function challengeBody(error: string): boolean {
	const b64 = /does not match found element '([A-Za-z0-9+/=]*)/.exec(error)?.[1]
	if(b64 === undefined) {
		return false
	}

	// "Tiny" only means something for a whole document; an xPath-selected
	// element is small by design.
	const text = Buffer.from(b64, 'base64').toString('utf8')
	const tinyDocument = Buffer.byteLength(text) < TINY_BODY_BYTES
		&& /<!doctype|<html/i.test(text)
	return tinyDocument || CHALLENGE_BODY.test(text)
}

export interface ProofDiagnosis {
	attestor: AttestorCheckResult
	likelyCause: string
	next: string
}

/**
 * When an unverified proof failed with a network-like error, runs the
 * attestor check once and says whether the attestor or the target site is the
 * likely cause. Returns `undefined` for verified proofs and other errors.
 */
export async function diagnoseNetworkFailure(
	result: Pick<ProofResult, 'verified' | 'error' | 'errorKind'>,
	check: (opts: CheckAttestorOptions) => Promise<AttestorCheckResult>,
	attestorUrl?: string,
): Promise<ProofDiagnosis | undefined> {
	if(
		result.verified
		|| result.errorKind !== undefined
		|| !isNetworkError(result.error)
	) {
		return undefined
	}

	const attestor = await check(attestorUrl ? { attestorUrl } : {})
	if(attestor.ok) {
		return {
			attestor,
			likelyCause:
				'The attestor works from this machine, so the target site likely '
				+ 'blocks or drops the attestor\'s network (geo or IP restriction).',
			next:
				'If the browser attach mode is "builder", call `run_proof_via_pod`. '
				+ 'Otherwise tell the developer and suggest asking the Reclaim team. '
				+ 'Do not retry the same proof.',
		}
	}

	return {
		attestor,
		likelyCause:
			'The attestor check also failed, so this machine cannot reach the '
			+ 'attestor (network, VPN, firewall, or proxy).',
		next:
			'Tell the developer. To see the connection details, suggest '
			+ 'restarting the MCP server with `RECLAIM_AGENT_TRACE=1`. Do not '
			+ 'retry the same proof.',
	}
}
