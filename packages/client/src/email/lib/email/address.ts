/* eslint-disable @stylistic/max-len */
import { domainToASCII } from 'node:url'
import { addressParser } from 'postal-mime'

export function normalizeAddress(address: string): string {
	// Deliberately preserve dots, +tags, and aliases. Case folding only.
	return address.trim().toLowerCase()
}

export function exactlyOneMailbox(value: string): string {
	const parsed = addressParser(value)
	if(
		parsed.length !== 1 ||
		'group' in parsed[0] ||
		!('address' in parsed[0]) ||
		!parsed[0].address
	) {
		throw new Error('INVALID_MAILBOX')
	}

	const address = parsed[0].address
	// Conservative PoC: one ordinary addr-spec, including RFC display names/comments.
	if(
		!/^[A-Za-z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+\/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(
			address,
		)
	) {
		throw new Error('INVALID_MAILBOX')
	}

	const domain = address.split('@')[1]
	if(
		domain.length > 253 ||
		domain
			.split('.')
			.some(
				(label) => !label ||
					label.length > 63 ||
					label.startsWith('-') ||
					label.endsWith('-'),
			)
	) {
		throw new Error('INVALID_MAILBOX')
	}

	return normalizeAddress(address)
}

export function addressDomain(address: string): string {
	return domainToASCII(
		address.slice(address.lastIndexOf('@') + 1),
	).toLowerCase()
}
