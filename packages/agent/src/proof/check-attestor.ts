/**
 * Attestor reachability check. Proves a public request with a throwaway owner
 * key to show whether the attestor works from this machine, independent of any
 * developer provider or site.
 */
import { createClaimOnAttestor } from '@reclaimprotocol/attestor-core'
import { generateKeypair } from '@reclaimprotocol/client'
import './patch-domhandler.ts'
import {
	claimRejection,
	ensureAttestorCrypto,
	parseClaim,
	resolveAttestorUrl,
} from './proof-core.ts'
import { ensureZkFiles, type ZkFilesState, zkFilesState } from './zk-files.ts'

/**
 * Default time budget for one check. A live run takes about 8 s; a longer
 * budget risks the MCP client's own tool-call timeout.
 */
export const CHECK_ATTESTOR_TIMEOUT_MS = 45_000

/* eslint-disable @stylistic/max-len -- the source URL cannot wrap. */
/**
 * Request params for the check: the public CoinGecko price request from the
 * attestor-core examples. Source:
 * https://raw.githubusercontent.com/reclaimprotocol/attestor-core/refs/heads/main/example/coin-gecko.json
 */
/* eslint-enable @stylistic/max-len */
export const COIN_GECKO_PARAMS = {
	url: 'https://api.coingecko.com/api/v3/simple/price'
		+ '?ids=cardano,solana&vs_currencies=usd',
	method: 'GET' as const,
	body: '',
	headers: {
		'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) '
			+ 'AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1',
		'Sec-Fetch-Mode': 'same-origin',
		'Sec-Fetch-Site': 'same-origin',
	},
	responseMatches: [
		{
			invert: false,
			type: 'regex' as const,
			value: 'cardano":{"usd":(?<cardanoPrice>\\d*\\.*\\d*)}',
		},
		{
			invert: false,
			type: 'regex' as const,
			value: 'solana":{"usd":(?<solanaPrice>\\d*\\.*\\d*)}',
		},
	],
	responseRedactions: [
		{ jsonPath: '$.cardano', regex: 'cardano":{"usd":(.*?)}', xPath: '' },
		{ jsonPath: '$.solana', regex: 'solana":{"usd":(.*?)}', xPath: '' },
	],
	additionalClientOptions: {},
}

/** The only secret in the example request. */
const COIN_GECKO_SECRET_HEADERS = {
	Referer: 'https://www.coingecko.com/en/nft',
}

export type AttestorCheckErrorKind =
	/** Socket, connection, DNS, TLS, or timeout failure, with the proof files
	 *  ready: the attestor itself didn't answer. */
	| 'attestor-unreachable'
	/** The attestor answered and rejected or failed the claim. */
	| 'attestor-error'
	/** The proof files are still downloading; the attestor wasn't contacted. */
	| 'proof-files-downloading'
	/** The proof file download failed; the attestor wasn't contacted. */
	| 'proof-files-failed'
	/** Other local setup failed before the attestor was contacted. */
	| 'setup-failed'

export interface AttestorCheckResult {
	ok: boolean
	attestorUrl: string
	durationMs: number
	extractedParameters?: Record<string, string>
	error?: string
	errorKind?: AttestorCheckErrorKind
	/** The proof file download state when the check finished. */
	proofFiles?: ZkFilesState
}

/** Creates the claim on the attestor (`createClaimOnAttestor` by default). */
export type CreateClaim = (
	args: Parameters<typeof createClaimOnAttestor>[0],
) => Promise<unknown>

export interface CheckAttestorOptions {
	attestorUrl?: string
	timeoutMs?: number
	/** Replaces the network call in tests. */
	createClaim?: CreateClaim
	/** Replaces the ZK file download in tests. */
	prepare?: () => Promise<void>
	/** Reports the ZK file download state (`zkFilesState` by default). */
	proofFilesState?: () => ZkFilesState
}

/** Prefix of the error raised when the check exceeds its time budget. */
const CHECK_TIMEOUT_MESSAGE = 'attestor check timed out'

/**
 * Signals that the attestor connection failed. Bare "timeout", "timed out",
 * and "websocket" are left out: a target site's errors contain them too.
 */
const NETWORK_ERROR_PATTERN = new RegExp(
	[
		'connection closed',
		'ERROR_NETWORK_ERROR',
		'ECONNRESET',
		'ECONNREFUSED',
		'ENOTFOUND',
		'EAI_AGAIN',
		'ETIMEDOUT',
		'EHOSTUNREACH',
		'ENETUNREACH',
		'socket hang up',
		'websocket (connection|error|closed|failed)',
		'(failed|unable|could not) to connect',
		CHECK_TIMEOUT_MESSAGE,
	].join('|'),
	'i',
)

/** True when `message` looks like a network failure rather than a rejection. */
export function isNetworkError(message: string | undefined): boolean {
	return message !== undefined && NETWORK_ERROR_PATTERN.test(message)
}

/** Prove the public CoinGecko request once and classify the outcome. */
export async function checkAttestor(
	opts: CheckAttestorOptions = {},
): Promise<AttestorCheckResult> {
	const attestorUrl = resolveAttestorUrl(opts.attestorUrl)
	const timeoutMs = opts.timeoutMs ?? CHECK_ATTESTOR_TIMEOUT_MS
	const createClaim = opts.createClaim ?? createClaimOnAttestor
	const prepare = opts.prepare ?? (async() => {
		ensureAttestorCrypto()
		await ensureZkFiles()
	})
	const proofFilesState = opts.proofFilesState ?? zkFilesState
	const startedAt = Date.now()
	const finish = (
		outcome: Omit<AttestorCheckResult, 'attestorUrl' | 'durationMs'>,
	): AttestorCheckResult => {
		return {
			...outcome,
			attestorUrl,
			durationMs: Date.now() - startedAt,
			proofFiles: proofFilesState(),
		}
	}

	let timer: NodeJS.Timeout | undefined
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			reject(new Error(`${CHECK_TIMEOUT_MESSAGE} after ${timeoutMs} ms`))
		}, timeoutMs)
	})

	try {
		try {
			await Promise.race([prepare(), timeout])
		} catch(err) {
			return finish({ ok: false, ...setupFailure(messageOf(err)) })
		}

		const claim = await Promise.race([
			createClaim({
				name: 'http',
				params: COIN_GECKO_PARAMS,
				secretParams: { headers: COIN_GECKO_SECRET_HEADERS },
				ownerPrivateKey: generateKeypair().privateKey,
				client: { url: attestorUrl },
				zkEngine: 'stwo',
			}),
			timeout,
		])

		const rejection = claimRejection(claim)
		if(rejection !== undefined) {
			return finish({
				ok: false,
				error: rejection,
				errorKind: isNetworkError(rejection)
					? 'attestor-unreachable'
					: 'attestor-error',
			})
		}

		return finish({
			ok: true,
			extractedParameters: parseClaim(claim).extractedParameters,
		})
	} catch(err) {
		const error = messageOf(err)
		return finish({
			ok: false,
			error,
			errorKind: isNetworkError(error)
				? 'attestor-unreachable'
				: 'attestor-error',
		})
	} finally {
		clearTimeout(timer)
	}

	/** Classify a failure before the attestor was contacted by the proof
	 *  file download state, so a slow or failed download never reads as an
	 *  unreachable attestor. */
	function setupFailure(error: string) {
		const files = proofFilesState()
		if(files.status === 'downloading') {
			const done = files.bytesDownloaded !== undefined
				? `, ${files.bytesDownloaded}`
					+ (files.totalBytes !== undefined ? `/${files.totalBytes}` : '')
					+ ' bytes'
				: ''
			return {
				error:
					`proof files are still downloading (${files.method}, `
					+ `${Math.round(files.elapsedMs / 1000)}s${done}); the attestor `
					+ 'was not contacted. Run check_attestor again shortly.',
				errorKind: 'proof-files-downloading' as const,
			}
		}

		if(files.status === 'failed') {
			return {
				error: `proof file download failed: ${files.reason}`,
				errorKind: 'proof-files-failed' as const,
			}
		}

		return {
			error,
			errorKind: error.startsWith(CHECK_TIMEOUT_MESSAGE)
				? 'attestor-unreachable' as const
				: 'setup-failed' as const,
		}
	}
}

function messageOf(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}
