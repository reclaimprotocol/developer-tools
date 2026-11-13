/* eslint-disable @stylistic/max-len */
import { boundedDnsResolver } from '../lib/email/dkim-verifier.ts'
import {
	copyCheckedEmailSource,
	inspectCheckedEmail,
	validateAiContentCheck,
} from './ai-check.ts'
import {
	approveWithResolver,
	inspectApprovedEmail,
	releaseApprovedEmail,
} from './approval.ts'
import type {
	CheckedEmailResult,
	EmailProofV1,
	TrustedEmailBinding,
} from './contracts.ts'
import { canonicalJson, hashEmailPolicy, sha256 } from './policy.ts'
import type { EmailRequest } from './protocol.ts'

/** No signer here: only Portal may authenticate this server-owned checked result. */
export function buildCheckedEmailExtension(
	result: CheckedEmailResult,
	binding: TrustedEmailBinding,
	request: EmailRequest,
) {
	if(
		binding.appId !== request.appId ||
		binding.sessionId !== request.sessionId ||
		binding.requestHash !== sha256(canonicalJson(request)) ||
		binding.policyHash !== hashEmailPolicy(request.policy)
	) {
		throw new Error('EMAIL_REQUEST_MISMATCH')
	}

	const { checked, summary, raw } = copyCheckedEmailSource(result, binding)
	try {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { headerSha256: _header, ...signature } = summary.signature
		const values = Object.fromEntries(
			Object.entries(checked.fields).map(([name, field]) => [
				name,
				field.value,
			]),
		)
		const emailProof: EmailProofV1['emailProof'] = {
			version: 1,
			source: { kind: 'raw-rfc822-v1', rawEmailBase64: raw.toString('base64') },
			rawEmailSha256: summary.rawEmailSha256,
			authenticatedAddress: binding.accountAddress,
			policyVersion: request.policy.version,
			textPolicyVersion: summary.textVersion,
			acceptedDkimSignature: signature,
			contentScope: summary.contentScope,
			sourceManifest: checked.sourceManifest,
			aiContentCheck: {
				outcome: 'pass',
				...checked.analysis,
				reviewedSourceIds: checked.sourceManifest.map((s) => s.id),
			},
			evidence: Object.fromEntries(
				Object.entries(checked.fields).map(([name, field]) => [
					name,
					field.evidence,
				]),
			),
		}
		return { emailProof, values, timestampS: summary.timestampS }
	} finally {
		raw.fill(0)
	}
}

/** Called only after SDK issuer/request verification. No Google or AI calls. */
export async function verifyEmailProofSource(
	proof: EmailProofV1,
	request: EmailRequest,
	signal: AbortSignal,
): Promise<void> {
	const e = proof.emailProof
	if(e.source.kind !== 'raw-rfc822-v1') {
		throw new Error('EMAIL_SOURCE_UNSUPPORTED')
	}

	const raw = Buffer.from(e.source.rawEmailBase64, 'base64')
	let approved
	try {
		if(
			!raw.length ||
			raw.length > 8 * 1024 * 1024 ||
			raw.toString('base64') !== e.source.rawEmailBase64 ||
			sha256(raw) !== e.rawEmailSha256
		) {
			throw new Error('EMAIL_RAW_MISMATCH')
		}

		if(
			e.policyVersion !== request.policy.version ||
			e.textPolicyVersion !== request.policy.textVersion ||
			e.contentScope !== request.policy.contentScope
		) {
			throw new Error('EMAIL_POLICY_MISMATCH')
		}

		// Interaction expiry is checked separately by the envelope verifier. Reconstruction
		// gets a short local lifetime so a submitted proof can be verified during retention.
		const binding: TrustedEmailBinding = {
			appId: request.appId,
			sessionId: request.sessionId,
			requestHash: sha256(canonicalJson(request)),
			policyHash: hashEmailPolicy(request.policy),
			accountId: 'proof-verification',
			accountAddress: e.authenticatedAddress,
			messageId: e.rawEmailSha256,
			attemptId: 'proof-verification',
			expiresAt: Date.now() + 60_000,
		}
		approved = await approveWithResolver(
			raw,
			request.policy,
			binding,
			signal,
			boundedDnsResolver,
			undefined,
			e.acceptedDkimSignature,
		)
		const summary = inspectApprovedEmail(approved, binding)
		if(
			summary.timestampS !== proof.claimData.timestampS ||
			canonicalJson(summary.sourceManifest) !== canonicalJson(e.sourceManifest)
		) {
			throw new Error('EMAIL_SOURCE_MISMATCH')
		}

		const fields = Object.fromEntries(
			Object.entries(proof.extractedParameterValues).map(([name, value]) => [
				name,
				{ value, evidence: e.evidence[name] },
			]),
		)
		if(
			Object.keys(e.evidence).sort().join(',') !==
			Object.keys(fields).sort().join(',')
		) {
			throw new Error('EMAIL_EVIDENCE_MISMATCH')
		}

		const checked = validateAiContentCheck(
			approved,
			binding,
			{
				outcome: e.aiContentCheck.outcome,
				reviewedSourceIds: e.aiContentCheck.reviewedSourceIds,
				fields,
			},
			{
				model: e.aiContentCheck.model,
				promptVersion: e.aiContentCheck.promptVersion,
				inputSha256: e.aiContentCheck.inputSha256,
			},
		)
		if(
			canonicalJson(inspectCheckedEmail(checked, binding).fields) !==
			canonicalJson(fields)
		) {
			throw new Error('EMAIL_EVIDENCE_MISMATCH')
		}

		signal.throwIfAborted()
	} finally {
		raw.fill(0)
		if(approved) {
			releaseApprovedEmail(approved)
		}
	}
}
