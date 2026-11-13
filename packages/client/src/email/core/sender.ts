/* eslint-disable @stylistic/max-len */
import { RE2JS } from 're2js'
// One regex grammar for sender and signing-domain policies, shared by every consumer.
const regexCache = new Map<string, RE2JS>()
function compileEmailRegex(pattern: string, maxLength: number): RE2JS {
	if(
		typeof pattern !== 'string' ||
		!pattern.startsWith('regex:') ||
		pattern.length > maxLength
	) {
		throw new Error('INVALID_EMAIL_REGEX')
	}

	const source = pattern.slice('regex:'.length)
	if(!source.length || !/^[\x20-\x7e]+$/.test(source)) {
		throw new Error('INVALID_EMAIL_REGEX')
	}

	const cached = regexCache.get(source)
	if(cached) {
		return cached
	}

	let compiled: RE2JS
	try {
		compiled = RE2JS.compile(source, RE2JS.CASE_INSENSITIVE)
	} catch{
		throw new Error('INVALID_EMAIL_REGEX')
	}

	if(compiled.programSize() > 4096) {
		throw new Error('EMAIL_REGEX_TOO_COMPLEX')
	}

	if(regexCache.size >= 128) {
		regexCache.delete(regexCache.keys().next().value!)
	}

	regexCache.set(source, compiled)
	return compiled
}

// Browser-safe: shared by SDK input, preview advisories and authenticated From checks.
export function normalizeEmailDomain(value: string): string {
	if(
		typeof value !== 'string' ||
		value.length > 253 ||
		!/^[\x21-\x7e]+$/.test(value) ||
		value
			.split('.')
			.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
	) {
		throw new Error('INVALID_EMAIL_DOMAIN')
	}

	// Validate A-labels without accepting URL syntax or silently converting Unicode.
	const domain = value.toLowerCase()
	try {
		if(new URL(`https://${domain}.invalid`).hostname !== `${domain}.invalid`) {
			throw new Error()
		}
	} catch{
		throw new Error('INVALID_EMAIL_DOMAIN')
	}

	return domain
}

export function normalizeEmailMailbox(value: string): string {
	if(
		typeof value !== 'string' ||
		value.length > 254 ||
		!/^[\x21-\x7e]+$/.test(value)
	) {
		throw new Error('INVALID_MAILBOX')
	}

	const parts = value.split('@')
	if(
		parts.length !== 2 ||
		parts[0].length > 64 ||
		!/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(
			parts[0],
		)
	) {
		throw new Error('INVALID_MAILBOX')
	}

	return `${parts[0].toLowerCase()}@${normalizeEmailDomain(parts[1])}`
}

export function normalizeEmailDomainPattern(value: string): string {
	compileEmailRegex(value, 255)
	return value
}

export function matchesEmailDomain(pattern: string, value: string): boolean {
	const compiled = compileEmailRegex(pattern, 255)
	try {
		return compiled.matches(normalizeEmailDomain(value))
	} catch{
		return false
	}
}

export function parseEmailSender(value: string): Readonly<{ sender: string }> {
	compileEmailRegex(value, 320)
	return Object.freeze({ sender: value })
}

export function matchesEmailSender(sender: string, mailbox: string): boolean {
	const compiled = compileEmailRegex(sender, 320)
	try {
		return compiled.matches(normalizeEmailMailbox(mailbox))
	} catch{
		return false
	}
}
