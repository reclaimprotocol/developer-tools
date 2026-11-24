/* eslint-disable @stylistic/max-len */
import assert from 'node:assert/strict'
import { Resolver } from 'node:dns/promises'
import { after, before, mock } from 'node:test'
import { validateAiContentCheck } from '../../src/email/core/ai-check.ts'
import {
	approveWithResolver,
	inspectApprovedEmail,
	projectApprovedEmail,
	releaseApprovedEmail,
} from '../../src/email/core/approval.ts'
import type { TrustedEmailBinding } from '../../src/email/core/contracts.ts'
import { hashEmailPolicy, sha256 } from '../../src/email/core/policy.ts'
import {
	buildCheckedEmailExtension
} from '../../src/email/core/proof-source.ts'
import {
	canonicalJson,
	type EmailRequest,
	type EmailSenderTrust,
	emailSenderTrustSchema,
	validateEmailRequest,
} from '../../src/email/core/protocol.ts'
import { verifyEmailProof } from '../../src/email/index.ts'
import {
	fixtureBinding,
	fixturePolicy,
	signCoreEmail,
} from './core/fixtures/email-core.ts'
import { publicRecord, unsignedEmail } from './core/fixtures/signed-email.ts'
// The compat `it` also skips when the sandbox fails at runtime, as on CI
// runners whose probe passes but whose worker can't start.
import { describe, it, sandboxSkip } from './core/vitest-compat.ts'
import { emailProof, emailRequest, ISSUER } from './fixtures.ts'

// Every selector resolves to the fixture key, whatever the signing domain.
const resolver = async(_name: string, type: string) => {
	if(type !== 'TXT') {
		throw new Error('SYNTHETIC_DNS_NOT_FOUND')
	}

	return [[publicRecord]]
}

const headerList = [
	'from',
	'to',
	'date',
	'subject',
	'content-type',
	'content-transfer-encoding',
	'mime-version',
]

async function approve(
	raw: Buffer,
	unlistedSender?: { excludedDomains: string[] },
) {
	const policy = fixturePolicy()
	const binding = fixtureBinding(policy)
	const handle = await approveWithResolver(
		raw,
		policy,
		binding,
		new AbortController().signal,
		resolver,
		undefined,
		undefined,
		unlistedSender ? { unlistedSender } : undefined,
	)
	return inspectApprovedEmail(handle, binding)
}

async function rejectsWith(promise: Promise<unknown>, code: string) {
	await assert.rejects(promise, (error: Error) => {
		assert.equal(error.message, code)
		return true
	})
}

// Approving a full email extracts its text in the Linux document sandbox.
const skipIfNoSandbox = { skip: sandboxSkip }
const unlisted = { excludedDomains: ['platform.example'] }
const brandMail = (options: Parameters<typeof signCoreEmail>[0] = {}) => signCoreEmail({
	from: 'Brand <news@mail.brand.example>',
	domain: 'brand.example',
	headerList,
	...options,
})

describe('unlisted sender approval', () => {
	it('keeps a listed sender listed, even when unlisted senders are allowed', skipIfNoSandbox, async() => {
		const raw = await signCoreEmail({ headerList })
		for(const options of [undefined, unlisted]) {
			const summary = await approve(raw, options)
			assert.deepEqual(summary.senderAcceptance, { kind: 'listed' })
		}
	})

	it('accepts an aligned, signed, unlisted sender with its signed subject', skipIfNoSandbox, async() => {
		const summary = await approve(await brandMail(), unlisted)
		assert.deepEqual(summary.senderAcceptance, {
			kind: 'unlisted',
			signingDomain: 'brand.example',
			fromDomain: 'mail.brand.example',
			fromAddress: 'news@mail.brand.example',
			fromName: 'Brand',
			subject: 'Your September earnings',
		})
	})

	it('rejects an unlisted sender when not opted in', async() => {
		await rejectsWith(approve(await brandMail()), 'SIGNER_NOT_ACCEPTED')
	})

	it('rejects a signing domain that is not aligned with From', async() => {
		const raw = await brandMail({ domain: 'other.example' })
		await rejectsWith(approve(raw, unlisted), 'SENDER_NOT_ALIGNED')
		// A shared suffix is not alignment.
		const lookalike = await brandMail({
			from: 'Brand <news@xbrand.example>',
			domain: 'brand.example',
		})
		await rejectsWith(approve(lookalike, unlisted), 'SENDER_NOT_ALIGNED')
	})

	it('rejects a Subject the signature does not cover', async() => {
		const raw = await brandMail({
			headerList: headerList.filter((h) => h !== 'subject'),
		})
		await rejectsWith(approve(raw, unlisted), 'SUBJECT_NOT_AUTHENTICATED')
	})

	it('rejects a public mailbox provider, including country domains', async() => {
		for(const domain of ['gmail.com', 'outlook.co.uk', 'yahoo.com']) {
			const raw = await brandMail({
				from: `Someone <someone@${domain}>`,
				domain,
			})
			await rejectsWith(approve(raw, unlisted), 'SIGNER_PUBLIC_MAILBOX')
		}
	})

	it('rejects an excluded domain and its subdomains', async() => {
		const raw = await brandMail({
			from: 'Host <events@calendar.platform.example>',
			domain: 'platform.example',
		})
		await rejectsWith(approve(raw, unlisted), 'SIGNER_EXCLUDED')
	})

	it('retries a sender the policy rejects when the signer is listed', async() => {
		// example.com is a listed signer; only the From mailbox fails policy.sender.
		const raw = await signCoreEmail({
			from: 'Other <other@example.com>',
			headerList,
		})
		await rejectsWith(approve(raw), 'SENDER_NOT_ACCEPTED')
	})

	it('accepts a listed signer with an unlisted From once opted in', skipIfNoSandbox, async() => {
		const raw = await signCoreEmail({
			from: 'Other <other@example.com>',
			headerList,
		})
		const summary = await approve(raw, unlisted)
		assert.deepEqual(summary.senderAcceptance, {
			kind: 'unlisted',
			signingDomain: 'example.com',
			fromDomain: 'example.com',
			fromAddress: 'other@example.com',
			fromName: 'Other',
			subject: 'Your September earnings',
		})
	})

	it('decodes and bounds the signed From display name', skipIfNoSandbox, async() => {
		const encoded = await brandMail({ from: '=?UTF-8?B?Q2Fmw6k=?= <News@Mail.Brand.example>' })
		const summary = await approve(encoded, unlisted)
		assert.equal(summary.senderAcceptance.kind, 'unlisted')
		if(summary.senderAcceptance.kind === 'unlisted') {
			assert.equal(summary.senderAcceptance.fromName, 'Café')
			assert.equal(summary.senderAcceptance.fromAddress, 'news@mail.brand.example')
		}

		const long = await brandMail({ from: `"${'x'.repeat(400)}" <news@mail.brand.example>` })
		const longSummary = await approve(long, unlisted)
		if(longSummary.senderAcceptance.kind === 'unlisted') {
			assert.equal(longSummary.senderAcceptance.fromName.length, 200)
		}
	})

	it('rejects a Subject that appears more than once', async() => {
		const raw = await brandMail({ extraHeaders: ['Subject: Another subject'] })
		await rejectsWith(approve(raw, unlisted), 'SUBJECT_NOT_AUTHENTICATED')
	})

	it('still requires a passing DKIM signature', async() => {
		const unsigned = unsignedEmail({
			from: 'Brand <news@mail.brand.example>',
			to: 'Synthetic Alice <alice@example.net>',
		})
		await rejectsWith(approve(unsigned, unlisted), 'DKIM_VERIFICATION_FAILED')

		const signed = await brandMail()
		const tampered = Buffer.from(
			signed.toString().replace('USD 1234', 'USD 9999'),
		)
		await rejectsWith(approve(tampered, unlisted), 'DKIM_VERIFICATION_FAILED')
	})

	it('still requires the whole body to be signed', async() => {
		const raw = await brandMail({ maxBodyLength: 5 })
		await rejectsWith(approve(raw, unlisted), 'PROOF_CONTENT_NOT_AUTHENTICATED')
	})
})

describe('sender scoring in a request', () => {
	const scoring = {
		version: 1,
		minScore: 0.8,
		brandDomains: ['brand.example'],
		excludedDomains: ['platform.example'],
	}

	it('accepts a well-formed scoring request', () => {
		const request = { ...emailRequest(), context: { reclaimEmailSenderScoring: scoring } }
		assert.equal(
			canonicalJson(validateEmailRequest(request).context),
			canonicalJson(request.context),
		)
	})

	it('rejects a malformed scoring request', () => {
		for(const bad of [
			{ ...scoring, minScore: 0.4 },
			{ ...scoring, minScore: 1.1 },
			{ ...scoring, version: 2 },
			{ ...scoring, brandDomains: ['https://brand.example/'] },
			{ ...scoring, extra: true },
			'yes',
		]) {
			assert.throws(
				() => validateEmailRequest({
					...emailRequest(),
					context: { reclaimEmailSenderScoring: bad },
				}),
				/INVALID_EMAIL_SENDER_SCORING/,
			)
		}
	})

	it('rejects a requester-supplied emailSenderTrust', () => {
		assert.throws(
			() => validateEmailRequest({
				...emailRequest(),
				context: { emailSenderTrust: { kind: 'listed' } },
			}),
			/INVALID_EMAIL_CONTEXT/,
		)
	})
})

describe('verifyEmailProof with sender scoring', () => {
	const trustedIssuers = [ISSUER.address]
	const request: EmailRequest = {
		...emailRequest(),
		context: {
			orderId: 'order-1',
			reclaimEmailSenderScoring: {
				version: 1,
				minScore: 0.8,
				brandDomains: ['brand.example'],
				excludedDomains: ['platform.example'],
			},
		},
	}
	const scored: EmailSenderTrust = {
		kind: 'scored',
		score: 0.85,
		signingDomain: 'brand.example',
		fromDomain: 'mail.brand.example',
		reason: 'brand-label',
	}
	const signedBy = (domain: string) => (email: { acceptedDkimSignature: { signingDomain: string } }) => {
		email.acceptedDkimSignature.signingDomain = domain
	}

	const verify = (
		trust: EmailSenderTrust | undefined,
		options: Parameters<typeof emailProof>[0] = {},
		verifyRequest = request,
	) => verifyEmailProof(
		emailProof({
			request: verifyRequest,
			editEmailProof: signedBy(
				trust?.kind === 'scored' ? trust.signingDomain : 'shop.example',
			),
			...(trust ? { trust } : {}),
			...options,
		}),
		{ trustedIssuers, request: verifyRequest },
	)
	const rejects = (promise: Promise<unknown>, message: RegExp) => assert.rejects(
		promise,
		(error: Error & { reason?: string }) => {
			assert.equal(error.reason, 'email-proof-invalid')
			assert.match(error.message, message)
			return true
		},
	)

	it('accepts a listed sender and reports it', async() => {
		const outcome = await verify({ kind: 'listed' })
		assert.deepEqual(outcome.senderTrust, { kind: 'listed' })
		assert.equal(outcome.dkimSigner, 'shop.example')
	})

	it('accepts a scored sender at or above the minimum', async() => {
		for(const score of [0.8, 0.85, 1]) {
			const trust: EmailSenderTrust = { ...scored, score }
			const outcome = await verify(trust)
			assert.deepEqual(outcome.senderTrust, trust)
		}
	})

	it('rejects a score below the minimum', async() => {
		await rejects(verify({ ...scored, score: 0.79 }), /below the request minimum/)
	})

	it('rejects a trust claim for a different signer than the signature', async() => {
		await rejects(
			verify(scored, { editEmailProof: signedBy('other.example') }),
			/does not match its signature/,
		)
	})

	it('rejects a scored sender whose domains are not aligned, public or excluded', async() => {
		await rejects(
			verify({ ...scored, fromDomain: 'other.example' }),
			/does not match its signature/,
		)
		await rejects(
			verify({ ...scored, signingDomain: 'gmail.com', fromDomain: 'gmail.com' }),
			/not eligible/,
		)
		await rejects(
			verify({
				...scored,
				signingDomain: 'platform.example',
				fromDomain: 'events.platform.example',
			}),
			/not eligible/,
		)
	})

	it('rejects a listed claim whose signer the request does not allow', async() => {
		await rejects(
			verify({ kind: 'listed' }, { editEmailProof: signedBy('brand.example') }),
			/signer is not allowed/,
		)
	})

	it('rejects a proof without trust when the request opted in', async() => {
		const claimContext = canonicalJson({
			...request.context,
			reclaimSessionId: request.sessionId,
			extractedParameters: { total: '12' },
		})
		await rejects(verify(undefined, { claimContext }), /trust is missing/)
	})

	it('rejects trust the request did not opt in to', async() => {
		const plain = emailRequest()
		const claimContext = canonicalJson({
			...plain.context,
			reclaimSessionId: plain.sessionId,
			extractedParameters: { total: '12' },
			emailSenderTrust: { kind: 'listed' },
		})
		await rejects(
			verify(undefined, { claimContext }, plain),
			/does not match the request/,
		)
	})

	it('accepts the evidence reasons in a trust claim', async() => {
		for(const reason of ['brand-evidence', 'organizer-evidence', 'name-evidence', 'no-evidence']) {
			assert.deepEqual(
				emailSenderTrustSchema.parse({ ...scored, reason }),
				{ ...scored, reason },
			)
		}
	})

	it('rejects a malformed trust claim', async() => {
		for(const bad of [
			{ kind: 'scored', score: 0.855, signingDomain: 'brand.example', fromDomain: 'brand.example', reason: 'brand-label' },
			{ kind: 'scored', score: 0.9, signingDomain: 'brand.example', fromDomain: 'brand.example', reason: 'trust me' },
			{ kind: 'listed', score: 1 },
		]) {
			const claimContext = canonicalJson({
				...request.context,
				reclaimSessionId: request.sessionId,
				extractedParameters: { total: '12' },
				emailSenderTrust: bad,
			})
			await rejects(verify(undefined, { claimContext }), /trust is missing or malformed/)
		}
	})
})

describe('verifyEmailProof in full mode with sender scoring', () => {
	// Full mode rejects an expired proof, so the email must be recent.
	const mailDate = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000)
	const request: EmailRequest = {
		...emailRequest(mailDate.getTime() - 1000),
		context: {
			reclaimEmailSenderScoring: {
				version: 1,
				minScore: 0.8,
				brandDomains: ['brand.example'],
				excludedDomains: ['platform.example'],
			},
		},
	}
	const scored: EmailSenderTrust = {
		kind: 'scored',
		score: 0.85,
		signingDomain: 'brand.example',
		fromDomain: 'mail.brand.example',
		reason: 'brand-label',
	}
	// The listed signer and sender in the request's policy.
	const shopMail = () => signCoreEmail({
		from: 'Shop <news@shop.example>',
		domain: 'shop.example',
		date: mailDate.toUTCString(),
		body: 'Total: 12\r\n',
		headerList,
	})
	const unlistedMail = () => brandMail({
		date: mailDate.toUTCString(),
		body: 'Total: 12\r\n',
	})

	// verifyEmailProof resolves DKIM keys over the network; serve the fixture key.
	before(() => {
		mock.method(Resolver.prototype, 'resolveTxt', async() => [[publicRecord]])
	})
	after(() => {
		mock.restoreAll()
	})

	// Builds the proof the way Portal does: approve, check, then sign.
	async function proofFor(raw: Buffer, trust: EmailSenderTrust) {
		const binding: TrustedEmailBinding = {
			appId: request.appId,
			sessionId: request.sessionId,
			requestHash: sha256(canonicalJson(request)),
			policyHash: hashEmailPolicy(request.policy),
			accountId: 'proof-verification',
			accountAddress: 'alice@example.net',
			messageId: sha256(raw),
			attemptId: 'proof-verification',
			expiresAt: Date.now() + 60_000,
		}
		const handle = await approveWithResolver(
			raw,
			request.policy,
			binding,
			new AbortController().signal,
			resolver,
			undefined,
			undefined,
			{ unlistedSender: { excludedDomains: ['platform.example'] } },
		)
		try {
			const input = projectApprovedEmail(handle, binding)
			const source = input.sources[0]
			const start = source.text.indexOf('12')
			const checked = validateAiContentCheck(
				handle,
				binding,
				{
					outcome: 'pass',
					reviewedSourceIds: input.sources.map((s) => s.id),
					fields: {
						total: {
							value: '12',
							evidence: {
								sourceId: source.id,
								sourceSha256: source.textSha256,
								quoteStart: 0,
								quoteEnd: source.text.length,
								quote: source.text,
								valueStart: start,
								valueEnd: start + 2,
								transform: 'verbatim',
							},
						},
					},
				},
				{
					model: 'fixture-model',
					promptVersion: 'email-content-v10',
					inputSha256: sha256(canonicalJson(input)),
				},
			)
			const extension = buildCheckedEmailExtension(checked, binding, request)
			return emailProof({
				request,
				trust,
				issuedAtS: extension.timestampS,
				editEmailProof: (e) => {
					Object.assign(e, extension.emailProof)
				},
			})
		} finally {
			releaseApprovedEmail(handle)
		}
	}

	const verifyFull = (proof: Awaited<ReturnType<typeof proofFor>>) => verifyEmailProof(
		proof,
		{ trustedIssuers: [ISSUER.address], request, mode: 'full' },
	)
	const rejectsTrust = (promise: Promise<unknown>, code: string) => assert.rejects(
		promise,
		(error: Error & { reason?: string }) => {
			assert.equal(error.reason, 'email-proof-invalid')
			assert.equal((error.cause as Error | undefined)?.message, code)
			return true
		},
	)

	it('accepts a scored sender whose email is really unlisted', skipIfNoSandbox, async() => {
		const outcome = await verifyFull(await proofFor(await unlistedMail(), scored))
		assert.deepEqual(outcome.senderTrust, scored)
	})

	it('rejects a scored claim with a From domain the email does not have', skipIfNoSandbox, async() => {
		// brand.example is aligned with the signer, so only the re-approval can tell.
		const proof = await proofFor(
			await unlistedMail(),
			{ ...scored, fromDomain: 'brand.example' },
		)
		await rejectsTrust(verifyFull(proof), 'EMAIL_SENDER_TRUST_MISMATCH')
	})

	it('rejects a scored claim on an email the policy lists', skipIfNoSandbox, async() => {
		const proof = await proofFor(
			await shopMail(),
			{ ...scored, signingDomain: 'shop.example', fromDomain: 'shop.example' },
		)
		await rejectsTrust(verifyFull(proof), 'EMAIL_SENDER_TRUST_MISMATCH')
	})

	it('rejects a listed claim on an email the policy does not list', skipIfNoSandbox, async() => {
		const proof = await proofFor(await unlistedMail(), { kind: 'listed' })
		await assert.rejects(verifyFull(proof), (error: Error & { reason?: string }) => {
			assert.equal(error.reason, 'email-proof-invalid')
			return true
		})
	})

	it('accepts a listed claim on an email the policy lists', skipIfNoSandbox, async() => {
		const outcome = await verifyFull(await proofFor(await shopMail(), { kind: 'listed' }))
		assert.deepEqual(outcome.senderTrust, { kind: 'listed' })
	})
})
