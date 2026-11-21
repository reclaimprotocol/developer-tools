/* eslint-disable @stylistic/max-len */
import { dkimVerify } from 'mailauth/lib/dkim/verify.js'
import { Resolver } from 'node:dns/promises'
import { inspectHeaders, type RawHeader } from './headers.ts'

export type DnsResolver = (name: string, type: string) => Promise<string[][]>
export interface DkimCandidate {
	result: string
	signingDomain: string
	signedHeaders: string[]
	authenticatedHeaders?: RawHeader[]
	hasBodyLengthTag: boolean
	testing: boolean
	algorithm: string
	timeValid: boolean
	failureCode?: string
	keyLookup?: string
	dnsFailure?:
		| 'timeout'
		| 'refused'
		| 'server-error'
		| 'network-error'
		| 'other'
}
export const boundedDnsResolver: DnsResolver = async(name, type) => {
	if(type !== 'TXT') {
		throw new Error('DNS_TYPE')
	}

	const resolver = new Resolver({ timeout: 3000, tries: 1 })
	const timer = setTimeout(() => resolver.cancel(), 3000)
	try {
		return await resolver.resolveTxt(name)
	} finally {
		clearTimeout(timer)
		resolver.cancel()
	}
}

const transientDnsErrors = new Set([
	'ETIMEOUT',
	'ECANCELLED',
	'EREFUSED',
	'ECONNREFUSED',
	'ESERVFAIL',
	'EFORMERR',
	'EBADRESP',
	'ECONNRESET',
	'ENETUNREACH',
	'EHOSTUNREACH',
	'EAI_AGAIN',
])

// A new wrapper is used for each verification: repeated signatures sharing a key
// share one lookup, without caching keys or failures across verification attempts.
export function retryingDnsResolver(resolve: DnsResolver): DnsResolver {
	const lookups = new Map<string, Promise<string[][]>>()
	return (name, type) => {
		const key = `${type}:${name.toLowerCase()}`
		let lookup = lookups.get(key)
		if(!lookup) {
			lookup = (async() => {
				for(let attempt = 0; ; attempt++) {
					try {
						return await resolve(name, type)
					} catch(error) {
						const code = (error as NodeJS.ErrnoException | null)?.code
						if(attempt >= 2 || !code || !transientDnsErrors.has(code)) {
							throw error
						}

						await new Promise((done) => setTimeout(done, 200 * 2 ** attempt))
					}
				}
			})()
			lookups.set(key, lookup)
		}

		return lookup
	}
}

function signatureTags(value: string): Map<string, string> | null {
	const tags = new Map<string, string>()
	for(const part of value.split(';')) {
		if(!part.trim()) {
			continue
		}

		const match = /^\s*([a-z][a-z0-9_]*)\s*=\s*([\s\S]*)$/.exec(part)
		if(!match || tags.has(match[1])) {
			return null
		}

		tags.set(match[1], match[2].trim())
	}

	return tags
}

export async function verifyDkim(
	raw: Buffer,
	headers: RawHeader[],
	resolver: DnsResolver = boundedDnsResolver,
): Promise<DkimCandidate[]> {
	const signatures = headers
		.filter((h) => h.name === 'dkim-signature')
		.map((h) => signatureTags(h.value))
		.filter((t) => t !== null)
	if(!signatures.length || signatures.length > 16) {
		return []
	}

	// INVARIANT: cryptography receives the untouched Gmail buffer. No ARC/SPF fallback.
	const verified = await dkimVerify(raw, {
		strict: true,
		rejectRsaSha1: true,
		resolver: retryingDnsResolver(resolver),
		minBitLength: 1024,
	})
	return verified.results.flatMap((result) => {
		// Match by the full signature bytes + domain + selector, never array position or d= alone.
		// This also excludes ARC-Message-Signature results emitted by mailauth.
		const matching = signatures.filter(
			(tags) => tags.get('b')?.replace(/\s/g, '') ===
					result.signature?.replace(/\s/g, '') &&
				tags.get('d')?.toLowerCase() === result.signingDomain?.toLowerCase() &&
				tags.get('s') === result.selector,
		)
		if(!matching.length) {
			return []
		}

		const actual =
			result.signingHeaders?.headers?.map((h) => h.slice(0, h.indexOf(':')).toLowerCase(),
			) ?? []
		// These are the exact header instances used by mailauth's cryptographic check.
		// Parse their values only after a pass; this block is never used as DKIM input.
		const authenticatedHeaders =
			result.status?.result === 'pass'
				? inspectHeaders(
					Buffer.from(
						(result.signingHeaders?.headers ?? []).join('\r\n') + '\r\n\r\n',
					),
				)
				: undefined
		// Never return the library's raw comments: they can contain DNS diagnostics.
		const comment = result.status?.comment || ''
		const query = `${result.selector}._domainkey.${result.signingDomain}`
		const keyLookup =
			query.length <= 253 &&
			query.split('.').every((label) => /^[A-Za-z0-9_-]{1,63}$/.test(label))
				? query
				: undefined
		const dnsCode = /^DNS failure: ([A-Z][A-Z0-9_]+)$/.exec(comment)?.[1]
		const dnsFailure: DkimCandidate['dnsFailure'] = [
			'ETIMEOUT',
			'ECANCELLED',
		].includes(dnsCode || '')
			? 'timeout'
			: ['EREFUSED', 'ECONNREFUSED'].includes(dnsCode || '')
				? 'refused'
				: ['ESERVFAIL', 'EFORMERR', 'EBADRESP'].includes(dnsCode || '')
					? 'server-error'
					: ['ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH'].includes(
						dnsCode || '',
					)
						? 'network-error'
						: 'other'
		const failureCode =
			comment === 'body hash did not verify'
				? 'DKIM_BODY_HASH_MISMATCH'
				: comment === 'no key'
					? 'DKIM_KEY_NOT_FOUND'
					: comment.startsWith('DNS failure:') ||
						  result.status?.result === 'temperror'
						? 'DKIM_DNS_FAILURE'
						: comment === 'bad signature'
							? 'DKIM_SIGNATURE_INVALID'
							: comment === 'expired' || comment === 'invalid expiration'
								? 'DKIM_TIME_INVALID'
								: 'DKIM_VERIFICATION_FAILED'
		return [
			{
				result: result.status?.result ?? 'neutral',
				signingDomain: result.signingDomain ?? '',
				// Use the actual per-result selected header instances, rather than a union of h= tags.
				signedHeaders: actual,
				...(authenticatedHeaders ? { authenticatedHeaders } : {}),
				// mailauth 7.1 emits this property for every numeric l=, including zero.
				// strict mode refuses malformed l= before a signature can pass. Reading the
				// result also distinguishes a valid signature from an altered copy with the same b=.
				hasBodyLengthTag: Object.hasOwn(result, 'canonBodyLengthLimit'),
				testing: result.status?.testing === true,
				algorithm: result.algo ?? '',
				timeValid: result.signatureTimeValid === true,
				...(result.status?.result !== 'pass' ? { failureCode } : {}),
				...(keyLookup ? { keyLookup } : {}),
				...(failureCode === 'DKIM_DNS_FAILURE' ? { dnsFailure } : {}),
			},
		]
	})
}
