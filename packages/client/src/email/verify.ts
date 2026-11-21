/**
 * Consumer verification of a Reclaim Portal email proof (`email-v1`).
 *
 * `signature` mode checks the issuer signature, the signed claim, the
 * email-proof digest, and the raw-email digest. It needs only the client's
 * regular dependencies. `full` mode also re-runs DKIM, re-parses the email,
 * and re-checks the extracted evidence, which needs the optional peer
 * dependencies, Linux, and Bubblewrap 0.12 or later.
 */
import { badData, badRequest, Boom, forbidden } from '@hapi/boom'
import { keccak_256 } from '@noble/hashes/sha3.js'
import assert from 'node:assert'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import { recoverEip191Address } from '../eip191.ts'
import { bytesToHex } from '../encoding.ts'
import type { EmailProofV1 } from './core/contracts.ts'
import {
	canonicalJson,
	EMAIL_RESULT_TTL_S,
	emailProofParametersSchema,
	type EmailProvider,
	type EmailRequest,
	emailRequestSchema,
	plainCopy,
	snapshotEmailProof,
	strictJson,
} from './core/protocol.ts'

export type EmailVerificationMode = 'signature' | 'full'

/** Machine-readable reasons carried by email verification errors. */
export type EmailVerificationFailureReason =
	| 'email-proof-invalid'
	| 'email-issuer-not-trusted'
	| 'email-full-verification-unavailable'
	| 'email-request-required'

export interface VerifyEmailProofOptions {
	/**
	 * Reclaim Portal signer addresses you trust (`0x` and 40 hex digits).
	 * Compared case-insensitively. A malformed address throws a 400 error.
	 */
	trustedIssuers: string[]
	/** `signature` (default) or `full`. `full` requires `request`. */
	mode?: EmailVerificationMode
	/**
	 * The email request the proof must answer. When given, the proof must
	 * match its app, session, nonce, hash, sender, provider, context, and
	 * time window.
	 */
	request?: EmailRequest
	/** Override "now", in Unix seconds. */
	now?: number
	signal?: AbortSignal
}

export interface EmailProofOutcome {
	/** Lowercase address of the Portal key that signed the proof. */
	issuer: string
	emailProvider: EmailProvider
	/** Sender rule from the request policy that the email matched. */
	sender: string
	/** Domain of the DKIM signature that authenticated the email. */
	dkimSigner: string
	/** Mailbox the user signed in with. */
	authenticatedAddress: string
	extractedParameters: Record<string, string>
	emailCheck: EmailVerificationMode
}

/** Minimum Bubblewrap release that `full` mode accepts. */
const MIN_BWRAP_MINOR = 12

const execute = promisify(execFile)

/**
 * Verify an email proof issued by Reclaim Portal. Throws a Boom error whose
 * `reason` (also `data.reason`) is an {@link EmailVerificationFailureReason}.
 * `full` mode never falls back to `signature` mode.
 */
export async function verifyEmailProof(
	proof: unknown,
	opts: VerifyEmailProofOptions,
): Promise<EmailProofOutcome> {
	const mode = opts.mode ?? 'signature'
	const signal = opts.signal ?? new AbortController().signal
	assert(
		mode === 'signature' || mode === 'full',
		badRequest('mode must be "signature" or "full"'),
	)
	const trustedIssuers = normalizeEmailIssuers(opts.trustedIssuers)
	assert(
		mode !== 'full' || opts.request,
		emailError(
			'email-request-required',
			'full email verification requires the email request',
		),
	)

	// Snapshot synchronously, before any await can let the caller mutate it.
	let snapshot: EmailProofV1
	try {
		snapshot = snapshotEmailProof(proof)
	} catch{
		throw emailError('email-proof-invalid', 'email proof is malformed')
	}

	if(mode === 'full') {
		await assertFullVerificationAvailable(signal)
	}

	const outcome = verifyEmailProofSignature(
		snapshot,
		{ ...opts, mode, trustedIssuers },
	)
	if(mode === 'full' && opts.request) {
		await verifySource(snapshot, opts.request, signal)
		if(opts.now === undefined) {
			const { expiresAtS } = signedParameters(snapshot)
			assert(
				Date.now() / 1000 < expiresAtS,
				emailError('email-proof-invalid', 'email proof expired'),
			)
		}
	}

	signal.throwIfAborted()
	return outcome
}

/** The issuer, claim, and digest checks shared by both modes. */
function verifyEmailProofSignature(
	proof: EmailProofV1,
	opts: VerifyEmailProofOptions & { mode: EmailVerificationMode },
): EmailProofOutcome {
	const trusted = opts.trustedIssuers
	const claim = proof.claimData
	let parameters: ReturnType<typeof signedParameters>
	let context: Record<string, unknown>
	try {
		parameters = signedParameters(proof)
		context = signedContext(proof)
	} catch{
		throw emailError(
			'email-proof-invalid',
			'email proof parameters or context are not canonical',
		)
	}

	const identifier = '0x' + bytesToHex(keccak_256(new TextEncoder().encode(
		`email\n${claim.parameters}\n${claim.context}`,
	)))
	invalidUnless(
		identifier === proof.identifier && identifier === claim.identifier,
		'email proof identifier does not match its claim',
	)

	let signer: string
	try {
		signer = recoverEip191Address(
			[identifier, claim.owner.toLowerCase(), String(claim.timestampS), '1']
				.join('\n'),
			proof.signatures[0],
		).toLowerCase()
	} catch{
		throw emailError('email-proof-invalid', 'email proof signature is invalid')
	}

	invalidUnless(
		signer === proof.issuer.address.toLowerCase(),
		'email proof signature does not match its issuer',
	)
	assert(
		trusted.includes(signer),
		emailError(
			'email-issuer-not-trusted',
			`email proof issuer ${signer} is not trusted`,
		),
	)

	const email = proof.emailProof
	invalidUnless(
		parameters.emailProofSha256 === sha256Hex(canonicalJson(email)),
		'email proof digest does not match the signed parameters',
	)
	invalidUnless(
		parameters.sourceKind === email.source.kind,
		'email source kind does not match the signed parameters',
	)
	const raw = Buffer.from(email.source.rawEmailBase64, 'base64')
	try {
		invalidUnless(
			raw.length > 0
			&& raw.toString('base64') === email.source.rawEmailBase64
			&& sha256Hex(raw) === email.rawEmailSha256,
			'raw email does not match its digest',
		)
	} finally {
		raw.fill(0)
	}

	invalidUnless(
		claim.owner === parameters.appId,
		'email proof owner does not match the signed app',
	)
	invalidUnless(
		context.reclaimSessionId === parameters.sessionId
		&& isSameJson(context.extractedParameters, proof.extractedParameterValues),
		'extracted parameters do not match the signed context',
	)

	const now = opts.now ?? Date.now() / 1000
	invalidUnless(
		parameters.expiresAtS > parameters.issuedAtS
		&& parameters.expiresAtS - parameters.issuedAtS <= EMAIL_RESULT_TTL_S
		&& parameters.issuedAtS <= now + 60,
		'email proof validity window is invalid',
	)
	invalidUnless(now < parameters.expiresAtS, 'email proof expired')

	if(opts.request) {
		verifyRequestBinding(proof, parameters, opts.request, now)
	}

	return {
		issuer: signer,
		emailProvider: parameters.emailProvider,
		sender: parameters.sender,
		dkimSigner: email.acceptedDkimSignature.signingDomain,
		authenticatedAddress: email.authenticatedAddress,
		extractedParameters: { ...proof.extractedParameterValues },
		emailCheck: opts.mode,
	}
}

/** The checks `@reclaimprotocol/ai-sdk` applies against the request. */
function verifyRequestBinding(
	proof: EmailProofV1,
	parameters: ReturnType<typeof signedParameters>,
	input: EmailRequest,
	now: number,
) {
	let request: EmailRequest
	try {
		request = emailRequestSchema.parse(plainCopy(input, -2))
	} catch{
		throw emailError('email-proof-invalid', 'email request is malformed')
	}

	const claim = proof.claimData
	invalidUnless(
		parameters.issuedAtS >= Math.floor(request.createdAt / 1000)
		&& parameters.issuedAtS * 1000 < request.expiresAt
		&& parameters.issuedAtS <= now + 60,
		'email proof was not issued during the request',
	)
	invalidUnless(
		parameters.appId === request.appId
		&& claim.owner === request.appId
		&& parameters.sessionId === request.sessionId
		&& parameters.requestNonce === request.nonce
		&& parameters.requestHash === sha256Hex(canonicalJson(request))
		&& parameters.sender === request.policy.sender
		&& parameters.emailProvider === request.provider,
		'email proof does not answer this request',
	)
	invalidUnless(
		claim.context === canonicalJson({
			...request.context,
			reclaimSessionId: request.sessionId,
			extractedParameters: proof.extractedParameterValues,
		}),
		'email proof context does not match the request',
	)
}

/** DKIM, re-parse, sandboxed attachments, and evidence: `full` mode only. */
async function verifySource(
	proof: EmailProofV1,
	request: EmailRequest,
	signal: AbortSignal,
) {
	const { verifyEmailProofSource } = await import('./core/proof-source.ts')
		.catch((error: unknown) => {
			throw emailError(
				'email-full-verification-unavailable',
				'full email verification needs the optional email peer'
					+ ' dependencies of @reclaimprotocol/client',
				error,
			)
		})
	try {
		await verifyEmailProofSource(proof, request, signal)
	} catch(error) {
		if(signal.aborted) {
			throw signal.reason
		}

		// The sandbox failing to start is a host problem, not a bad proof.
		if(
			error instanceof Error
			&& 'code' in error
			&& error.code === 'DOCUMENT_ISOLATION_UNAVAILABLE'
		) {
			throw emailError(
				'email-full-verification-unavailable',
				'the Bubblewrap document sandbox could not start',
				error,
			)
		}

		throw emailError(
			'email-proof-invalid',
			'email source, DKIM, or evidence verification failed',
			error,
		)
	}
}

/**
 * Fail fast when this host can't run the document sandbox. The sandbox
 * itself still reports a failure at run time, for example when user
 * namespaces are blocked.
 */
async function assertFullVerificationAvailable(signal: AbortSignal) {
	const runtime = process.env.EMAIL_DOCUMENT_BWRAP ?? '/usr/bin/bwrap'
	assert(
		process.platform === 'linux' && isAbsolute(runtime),
		unavailable('full email verification runs only on Linux'),
	)
	let stdout: string
	try {
		({ stdout } = await execute(runtime, ['--version'], {
			env: {},
			timeout: 2000,
			maxBuffer: 1024,
			signal,
		}))
	} catch(error) {
		throw unavailable(`Bubblewrap is not runnable at ${runtime}`, error)
	}

	const match = /^bubblewrap (\d+)\.(\d+)\.(\d+)\s*$/.exec(stdout)
	assert(
		match && (
			Number(match[1]) > 0 || Number(match[2]) >= MIN_BWRAP_MINOR
		),
		unavailable(
			`full email verification needs Bubblewrap 0.${MIN_BWRAP_MINOR}`
				+ ' or later',
		),
	)
}

function signedParameters(proof: EmailProofV1) {
	const parameters = emailProofParametersSchema.parse(
		strictJson(proof.claimData.parameters),
	)
	assert(canonicalJson(parameters) === proof.claimData.parameters)
	return parameters
}

function signedContext(proof: EmailProofV1) {
	const context = strictJson(proof.claimData.context)
	assert(canonicalJson(context) === proof.claimData.context)
	assert(isRecord(context))
	return context
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isSameJson(a: unknown, b: unknown) {
	try {
		return canonicalJson(a) === canonicalJson(b)
	} catch{
		return false
	}
}

/**
 * Lowercase and dedupe trusted email issuer addresses. Throws a 400 error on
 * a malformed address, so a misconfigured issuer list fails loudly instead
 * of every proof failing with `email-issuer-not-trusted`.
 */
export function normalizeEmailIssuers(issuers: string[]) {
	return [...new Set(issuers.map((issuer) => {
		const normalized = String(issuer).trim().toLowerCase()
		assert(
			/^0x[0-9a-f]{40}$/.test(normalized),
			badRequest('invalid email issuer address'),
		)
		return normalized
	}))]
}

function sha256Hex(value: string | Uint8Array) {
	return createHash('sha256').update(value).digest('hex')
}

function invalidUnless(condition: boolean, message: string) {
	assert(condition, emailError('email-proof-invalid', message))
}

function unavailable(message: string, cause?: unknown) {
	return emailError('email-full-verification-unavailable', message, cause)
}

/**
 * A Boom error carrying `reason`. The status code tells callers whether
 * the proof (422), the issuer (403), or this host (501) is the problem.
 */
export function emailError(
	reason: EmailVerificationFailureReason,
	message: string,
	cause?: unknown,
) {
	const error = reason === 'email-issuer-not-trusted'
		? forbidden(message, { reason })
		: reason === 'email-full-verification-unavailable'
			? new Boom(message, { statusCode: 501, data: { reason } })
			: reason === 'email-request-required'
				? badRequest(message, { reason })
				: badData(message, { reason })
	return Object.assign(error, { reason, ...(cause ? { cause } : {}) })
}
