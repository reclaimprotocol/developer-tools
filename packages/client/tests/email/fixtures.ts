import { keccak_256 } from '@noble/hashes/sha3.js'
import { createHash } from 'node:crypto'
import type { EmailProofV1 } from '../../src/email/core/contracts.ts'
import {
	canonicalJson,
	type EmailRequest,
	normalizeEmailPolicy,
} from '../../src/email/core/protocol.ts'
import { bytesToHex } from '../../src/encoding.ts'
import {
	deriveFromPrivateKey,
	generateKeypair,
	signEip191,
} from '../../src/index.ts'

export const RAW_EMAIL = Buffer.from([
	'From: Shop <receipts@shop.example>',
	'To: alice@gmail.com',
	'',
	'Total: 12',
	'',
].join('\r\n'))

/** A throwaway Portal signer for this test run. */
export const ISSUER = generateKeypair()

export interface EmailFixtureOptions {
	/** Overrides merged into the signed claim parameters. */
	parameters?: Record<string, unknown>
	/** Unix seconds when the proof was issued. */
	issuedAtS?: number
	signerKey?: string
	request?: EmailRequest
	/** Changes the email proof before Portal signs its digest. */
	editEmailProof?: (emailProof: EmailProofV1['emailProof']) => void
}

export function emailRequest(createdAt = Date.now()): EmailRequest {
	const sessionId = 'a'.repeat(32)
	const emailApiUrl = 'https://email-api.example'
	return {
		method: 'email',
		version: 1,
		appId: '0x' + '1'.repeat(40),
		provider: 'gmail',
		sessionId,
		nonce: 'b'.repeat(32),
		createdAt,
		expiresAt: createdAt + 600_000,
		policy: normalizeEmailPolicy({
			sender: 'regex:.*@shop[.]example',
			allowedDkimSigningDomains: ['regex:shop[.]example'],
			params: [{ name: 'total', instructions: 'Find the order total.' }],
			contentScope: 'body-only',
		}),
		context: { orderId: 'order-1' },
		callbackUrl: `${emailApiUrl}/api/email/requests/${sessionId}/callback`,
		cancelCallbackUrl:
			`${emailApiUrl}/api/email/requests/${sessionId}/error-callback`,
		jsonProofResponse: true,
		emailPortalUrl: 'https://portal.example/email',
		emailApiUrl,
	}
}

/** Signs an email proof the way Reclaim Portal does. */
export function emailProof(opts: EmailFixtureOptions = {}): EmailProofV1 {
	const request = opts.request ?? emailRequest()
	const issuedAtS = opts.issuedAtS ?? Math.floor(request.createdAt / 1000) + 1
	const hash = sha256Hex('fixture')
	const extracted = { total: '12' }
	const emailProof: EmailProofV1['emailProof'] = {
		version: 1,
		source: {
			kind: 'raw-rfc822-v1',
			rawEmailBase64: RAW_EMAIL.toString('base64'),
		},
		rawEmailSha256: sha256Hex(RAW_EMAIL),
		authenticatedAddress: 'alice@gmail.com',
		policyVersion: 'email-dkim-v5',
		textPolicyVersion: 'email-text-v1',
		acceptedDkimSignature: {
			headerIndex: 0,
			signingDomain: 'shop.example',
			selector: 'fixture',
			signatureSha256: hash,
			headerCanonicalization: 'relaxed',
			bodyCanonicalization: 'relaxed',
		},
		contentScope: 'body-only',
		sourceManifest: [{ id: 'body:0', kind: 'body', textSha256: hash }],
		aiContentCheck: {
			outcome: 'pass',
			promptVersion: 'email-content-v10',
			model: 'fixture-model',
			inputSha256: hash,
			reviewedSourceIds: ['body:0'],
		},
		evidence: {
			total: {
				sourceId: 'body:0',
				sourceSha256: hash,
				quoteStart: 0,
				quoteEnd: 9,
				quote: 'Total: 12',
				valueStart: 7,
				valueEnd: 9,
				transform: 'verbatim',
			},
		},
	}
	opts.editEmailProof?.(emailProof)
	const parameters = canonicalJson({
		proofType: 'email-v1',
		appId: request.appId,
		sessionId: request.sessionId,
		requestHash: sha256Hex(canonicalJson(request)),
		requestNonce: request.nonce,
		sender: request.policy.sender,
		emailProvider: request.provider,
		sourceKind: 'raw-rfc822-v1',
		emailProofSha256: sha256Hex(canonicalJson(emailProof)),
		issuedAtS,
		expiresAtS: issuedAtS + 3600,
		consentVersion: 'full-email-v1',
		...opts.parameters,
	})
	const context = canonicalJson({
		...request.context,
		reclaimSessionId: request.sessionId,
		extractedParameters: extracted,
	})
	const identifier = '0x' + bytesToHex(keccak_256(
		new TextEncoder().encode(`email\n${parameters}\n${context}`),
	))
	const timestampS = issuedAtS
	const signerKey = opts.signerKey ?? ISSUER.privateKey
	const signature = signEip191(
		[identifier, request.appId.toLowerCase(), String(timestampS), '1']
			.join('\n'),
		signerKey,
	)
	return {
		proofType: 'email-v1',
		identifier,
		claimData: {
			provider: 'email',
			parameters,
			context,
			owner: request.appId,
			timestampS,
			identifier,
			epoch: 1,
		},
		signatures: [signature],
		issuer: {
			type: 'reclaim-portal',
			address: deriveFromPrivateKey(signerKey).address,
		},
		extractedParameterValues: extracted,
		emailProof,
	}
}

export function sha256Hex(value: string | Uint8Array) {
	return createHash('sha256').update(value).digest('hex')
}
