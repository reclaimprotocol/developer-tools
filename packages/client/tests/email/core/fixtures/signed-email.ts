/* eslint-disable @stylistic/max-len -- ported from the email core's test suite; kept close to upstream so the two can be compared */
import type { DKIMSignOptions } from 'mailauth'
import { dkimSign as mailauthSign } from 'mailauth/lib/dkim/sign.js'
import { generateKeyPairSync } from 'node:crypto'
import type {
	DnsResolver
} from '../../../../src/email/lib/email/dkim-verifier.ts'

/**
 * mailauth's `dkimSign`. Its typings require top-level signing keys even
 * when every signature carries its own in `signatureData`.
 */
export function dkimSign(
	raw: Buffer,
	options: Omit<DKIMSignOptions, 'signingDomain' | 'selector' | 'privateKey'>,
) {
	// mailauth reads the keys from `signatureData`; see the comment above.
	return mailauthSign(raw, options as DKIMSignOptions)
}

// Headers the core requires to be signed (the core's lib/email/dkim-policy).
const REQUIRED_SIGNED_HEADERS = ['from', 'to', 'date', 'content-type']
const MIME_HEADERS = ['mime-version', 'content-transfer-encoding']
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
export const privateKey = pair.privateKey
	.export({ type: 'pkcs8', format: 'pem' })
	.toString()
export const publicRecord = `v=DKIM1; k=rsa; p=${pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}`
export const resolver: DnsResolver = async(_name, type) => {
	if(type !== 'TXT') {
		throw new Error('DNS_FAILURE')
	}

	return [[publicRecord]]
}

export interface FixtureOptions {
	from?: string
	to?: string
	date?: string
	contentType?: string
	transferEncoding?: string
	body?: string
	headerList?: string[]
	domain?: string
	algorithm?: string
	maxBodyLength?: number
	expires?: Date
	extraHeaders?: string[]
	omit?: string[]
	signatureData?: DKIMSignOptions[]
}
export function unsignedEmail(options: FixtureOptions = {}): Buffer {
	const headers = [
		`From: ${options.from ?? 'Instacart <noreply@instacart.com>'}`,
		`To: ${options.to ?? 'Alice <alice@gmail.com>'}`,
		`Date: ${options.date ?? 'Sat, 26 Sep 2026 14:32:00 -0700'}`,
		'Subject: Your September earnings',
		'MIME-Version: 1.0',
		`Content-Type: ${options.contentType ?? 'text/plain; charset=utf-8'}`,
		`Content-Transfer-Encoding: ${options.transferEncoding ?? '8bit'}`,
		...(options.extraHeaders ?? []),
	].filter(
		(h) => !options.omit?.includes(h.slice(0, h.indexOf(':')).toLowerCase()),
	)
	return Buffer.from(
		[
			...headers,
			'',
			options.body ?? 'Your earnings: $4,231.77\r\nThank you, Alice.\r\n',
		].join('\r\n'),
	)
}

export async function signedEmail(
	options: FixtureOptions = {},
): Promise<Buffer> {
	const raw = unsignedEmail(options)
	const signed = await dkimSign(raw, {
		headerList: (
			options.headerList ?? [...REQUIRED_SIGNED_HEADERS, ...MIME_HEADERS]
		).join(':'),
		...(options.algorithm ? { algorithm: options.algorithm } : {}),
		signTime: new Date('2026-01-01T00:00:00Z'),
		...(options.expires ? { expires: options.expires } : {}),
		signatureData: options.signatureData ?? [
			{
				signingDomain: options.domain ?? 'instacart.com',
				selector: 'test',
				privateKey,
				...(options.maxBodyLength !== undefined
					? { maxBodyLength: options.maxBodyLength }
					: {}),
			},
		],
	})
	if(!signed.signatures || signed.errors.length) {
		throw new Error(
			'Fixture could not be signed: ' + JSON.stringify(signed.errors),
		)
	}

	return Buffer.concat([Buffer.from(signed.signatures), raw])
}
