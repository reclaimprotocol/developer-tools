/* eslint-disable @stylistic/max-len */
/** Browser-safe sender trust: opt-in scoring request, issuer-added trust claim, and the domain gates shared by the issuer and the verifier. */
import { z } from 'zod'
import { canonicalJson as jcs } from './policy-data.ts'
import { normalizeEmailDomain } from './sender.ts'

/** Request context key a requester sets to allow scored senders. Signed with the request. */
export const EMAIL_SENDER_SCORING_KEY = 'reclaimEmailSenderScoring'
/** Context key only the issuer adds to the signed claim. Rejected in a request. */
export const EMAIL_SENDER_TRUST_KEY = 'emailSenderTrust'

const hostname = z.string().max(253).refine((value) => {
	try {
		return normalizeEmailDomain(value) === value
	} catch{
		return false
	}
}, 'invalid hostname')

export const emailSenderScoringSchema = z.strictObject({
	version: z.literal(1),
	minScore: z.number().min(0.5).max(1),
	brandDomains: z.array(hostname).max(16),
	excludedDomains: z.array(hostname).max(16),
})
export interface EmailSenderScoring {
	version: 1
	/** Lowest score (0.5 to 1) the issuer may accept for an unlisted sender. */
	minScore: number
	/** Hostnames of the brand the email should come from. */
	brandDomains: string[]
	/** Hostnames of multi-tenant services whose mail must never be scored. */
	excludedDomains: string[]
}

export const EMAIL_SENDER_SCORE_REASONS = [
	'brand-label',
	'brand-related',
	'unrelated',
	'brand-evidence',
	'organizer-evidence',
	'name-evidence',
	'no-evidence',
] as const
export type EmailSenderScoreReason = typeof EMAIL_SENDER_SCORE_REASONS[number]

export const emailSenderTrustSchema = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('listed') }),
	z.strictObject({
		kind: z.literal('scored'),
		score: z.number().min(0).max(1).refine(
			(value) => Math.round(value * 100) / 100 === value,
			'score has at most 2 decimals',
		),
		signingDomain: hostname,
		fromDomain: hostname,
		reason: z.enum(EMAIL_SENDER_SCORE_REASONS),
	}),
])
export type EmailSenderTrust = z.infer<typeof emailSenderTrustSchema>

/** What the approval learned about how the sender was accepted. */
export type EmailSenderAcceptance =
	| { kind: 'listed' }
	| {
		kind: 'unlisted'
		signingDomain: string
		fromDomain: string
		/** The signed From mailbox, normalized. For the scorer only, never added to the proof. */
		fromAddress: string
		/** The signed, decoded From display name, at most 200 characters (may be empty). For the scorer only. */
		fromName: string
		/** The signed, decoded Subject, at most 300 characters. */
		subject: string
	}

/** The scoring options of a request, or undefined when it did not opt in. Throws when malformed. */
export function emailSenderScoring(
	request: { context?: Record<string, unknown> },
): EmailSenderScoring | undefined {
	const value = request.context?.[EMAIL_SENDER_SCORING_KEY]
	if(value === undefined) {
		return undefined
	}

	return emailSenderScoringSchema.parse(value)
}

/**
 * The canonical JSON the issuer signs as the claim context, and a verifier
 * recomputes. A request that opted in to scoring needs `trust`; one that did
 * not must not pass it.
 */
export function buildEmailClaimContext(
	request: { sessionId: string, context?: Record<string, unknown> },
	extractedParameters: Record<string, string>,
	trust?: EmailSenderTrust,
): string {
	if(request.context && EMAIL_SENDER_TRUST_KEY in request.context) {
		throw new Error('INVALID_EMAIL_CONTEXT')
	}

	const scoring = emailSenderScoring(request)
	if(scoring) {
		if(!trust) {
			throw new Error('EMAIL_SENDER_TRUST_REQUIRED')
		}
	} else if(trust) {
		throw new Error('EMAIL_SENDER_TRUST_UNEXPECTED')
	}

	return jcs({
		...request.context,
		reclaimSessionId: request.sessionId,
		extractedParameters,
		...(trust ? { [EMAIL_SENDER_TRUST_KEY]: emailSenderTrustSchema.parse(trust) } : {}),
	}, -4)
}

/** True when the domains are equal, or one is a label-boundary suffix of the other. */
export function emailDomainsAligned(a: string, b: string): boolean {
	return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
}

/** True when `domain` is `parent` or a subdomain of it. */
export function emailDomainUnder(domain: string, parent: string): boolean {
	return domain === parent || domain.endsWith(`.${parent}`)
}

const PUBLIC_MAILBOX_EXACT = [
	'gmail.com',
	'googlemail.com',
	'msn.com',
	'ymail.com',
	'rocketmail.com',
	'aol.com',
	'icloud.com',
	'me.com',
	'mac.com',
	'proton.me',
	'pm.me',
	'mail.com',
	'mail.ru',
	'zoho.com',
	'tuta.io',
	'hey.com',
	'qq.com',
	'163.com',
	'126.com',
	'rediffmail.com',
]
// A label that stands for a family of providers across country suffixes (`outlook.com`, `outlook.co.uk`).
const PUBLIC_MAILBOX_LABELS = [
	'outlook',
	'hotmail',
	'live',
	'yahoo',
	'protonmail',
	'gmx',
	'yandex',
	'zohomail',
	'tutanota',
	'fastmail',
]

/** True for a free public mailbox provider, by label so `outlook.co.uk` counts. */
export function isPublicMailboxDomain(domain: string): boolean {
	if(PUBLIC_MAILBOX_EXACT.some((entry) => emailDomainUnder(domain, entry))) {
		return true
	}

	const labels = domain.split('.')
	// The provider label sits before a one or two label suffix (`com`, `co.uk`).
	return PUBLIC_MAILBOX_LABELS.some(
		(label) => labels.length >= 2
			&& (labels[labels.length - 2] === label
				|| (labels.length >= 3 && labels[labels.length - 3] === label && labels[labels.length - 2].length <= 3)),
	)
}
