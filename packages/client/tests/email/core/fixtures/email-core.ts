/* eslint-disable @stylistic/max-len, unicorn/no-await-expression-member -- ported from the email core's test suite; kept close to upstream so the two can be compared */
import { generateKeyPairSync, sign } from 'node:crypto'
import { createRequire } from 'node:module'
import type {
	EmailPolicyInput,
	TrustedEmailBinding,
} from '../../../../src/email/core/contracts.ts'
import {
	hashEmailPolicy,
	normalizeEmailPolicy,
} from '../../../../src/email/core/policy.ts'
import type {
	DnsResolver
} from '../../../../src/email/lib/email/dkim-verifier.ts'
import { docxDocument, pdfDocument, xlsxDocument } from './documents.ts'
import {
	dkimSign,
	type FixtureOptions,
	privateKey,
	publicRecord,
	unsignedEmail,
} from './signed-email.ts'

export const fixturePolicy = (options: Partial<EmailPolicyInput> = {}) => normalizeEmailPolicy({
	sender: 'regex:publisher@example[.]com',
	allowedDkimSigningDomains: ['regex:example[.]com'],
	params: [
		{
			name: 'income',
			instructions: 'Extract the gross weekly income amount.',
		},
	],
	...options,
})
export const fixtureBinding = (
	policy = fixturePolicy(),
): TrustedEmailBinding => ({
	appId: 'synthetic-app',
	sessionId: 'synthetic-session',
	requestHash: 'a'.repeat(64),
	policyHash: hashEmailPolicy(policy),
	accountId: 'synthetic-account',
	accountAddress: 'alice@example.net',
	messageId: 'synthetic-message',
	attemptId: 'synthetic-attempt',
	expiresAt: Date.now() + 120_000,
})
export const fixtureResolver: DnsResolver = async(name, type) => {
	if(type !== 'TXT' || name !== 'fixture._domainkey.example.com') {
		throw new Error('SYNTHETIC_DNS_NOT_FOUND')
	}

	return [[publicRecord]]
}

export async function signCoreEmail(
	options: FixtureOptions & {
		canonicalization?: string
		key?: string
		algorithm?: string
	} = {},
) {
	const raw = unsignedEmail({
		from: 'Synthetic Publisher <publisher@example.com>',
		to: 'Synthetic Alice <alice@example.net>',
		date: 'Mon, 19 Oct 2026 10:00:00 +0000',
		body: 'Synthetic weekly income: USD 1234.\r\n',
		...options,
	})
	const signed = await dkimSign(raw, {
		headerList: (
			options.headerList ?? [
				'from',
				'to',
				'date',
				'content-type',
				'content-transfer-encoding',
				'mime-version',
				'content-disposition',
				'content-id',
			]
		).join(':'),
		canonicalization: options.canonicalization ?? 'relaxed/relaxed',
		signTime: new Date('2026-01-01T00:00:00Z'),
		signatureData: [
			{
				signingDomain: options.domain ?? 'example.com',
				selector: 'fixture',
				privateKey: options.key ?? privateKey,
				algorithm: options.algorithm,
				...(options.maxBodyLength !== undefined
					? { maxBodyLength: options.maxBodyLength }
					: {}),
			},
		],
		...(options.algorithm ? { algorithm: options.algorithm } : {}),
	})
	if(signed.errors.length) {
		throw new Error('SYNTHETIC_SIGNING_FAILED')
	}

	return Buffer.concat([Buffer.from(signed.signatures), raw])
}

export function multipart(
	parts: {
		type: string
		text?: string
		bytes?: Buffer
		name?: string
		encoding?: string
		inline?: boolean
	}[],
) {
	return parts
		.flatMap((p) => [
			'--synthetic',
			`Content-Type: ${p.type}`,
			...(p.name
				? [
					`Content-Disposition: ${p.inline ? 'inline' : 'attachment'}; filename="${p.name}"`,
				]
				: []),
			...(p.encoding ? [`Content-Transfer-Encoding: ${p.encoding}`] : []),
			'',
			p.bytes ? p.bytes.toString('base64') : (p.text ?? ''),
		])
		.concat(['--synthetic--', ''])
		.join('\r\n')
}

export const completeBody = () => multipart([
	{
		type: 'text/plain; charset=utf-8',
		text: 'Synthetic weekly income: USD 1234.',
	},
	{
		type: 'text/html; charset=utf-8',
		text: '<p>Synthetic correction: weekly income is USD 1200.</p>',
	},
	{
		type: 'application/pdf',
		name: 'synthetic.pdf',
		bytes: pdfDocument('Synthetic weekly income USD 1200'),
		encoding: 'base64',
	},
	{
		type: 'text/csv; charset=utf-8',
		name: 'synthetic.csv',
		text: 'period,income=0D=0Aweekly,1200',
		encoding: 'quoted-printable',
	},
	{
		type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		name: 'synthetic.docx',
		bytes: docxDocument('Synthetic income USD 1200'),
		encoding: 'base64',
	},
	{
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		name: 'synthetic.xlsx',
		bytes: xlsxDocument(),
		encoding: 'base64',
	},
])

/** Change signed tags then re-sign with mailauth's own header canonicalizer; test fixture only. */
export function resignTags(
	raw: Buffer,
	change: (header: string) => string,
): Buffer {
	const require = createRequire(import.meta.url)
	const { parseHeaders, getSigningHeaderLines } = require('mailauth/lib/tools')
	const { generateCanonicalizedHeader } = require('mailauth/lib/dkim/header')
	const parsed = parseHeaders(raw.subarray(0, raw.indexOf('\r\n\r\n')))
	const original = parsed.parsed[0].line.toString()
	const line = change(original).replace(/\bb=[^;]*/, 'b=')
	const tags = Object.fromEntries(
		line
			.slice(line.indexOf(':') + 1)
			.split(';')
			.map((part: string) => {
				const index = part.indexOf('=')
				return [part.slice(0, index).trim(), part.slice(index + 1).trim()]
			}),
	)
	const { canonicalizedHeader } = generateCanonicalizedHeader(
		'DKIM',
		getSigningHeaderLines(parsed.parsed.slice(1), tags.h, true),
		{
			signatureHeaderLine: Buffer.from(line),
			canonicalization: tags.c || 'simple/simple',
			strict: true,
		},
	)
	const signature = sign(
		'rsa-sha256',
		canonicalizedHeader,
		privateKey,
	).toString('base64')
	return Buffer.concat([
		Buffer.from(line.replace(/\bb=/, `b=${signature}`)),
		raw.subarray(Buffer.byteLength(original)),
	])
}

export interface InspectionFixture {
	name: string
	raw: Buffer
	resolver: DnsResolver
	error?: string
	dkimPass: boolean
	policy?: ReturnType<typeof fixturePolicy>
}
export async function inspectionCases(
	name: string,
): Promise<InspectionFixture[]> {
	const fixture = (
		label: string,
		raw: Buffer,
		error?: string,
		resolver = fixtureResolver,
	): InspectionFixture => ({
		name: label,
		raw,
		resolver,
		error,
		dkimPass: error !== 'DKIM_VERIFICATION_FAILED',
	})
	if(name === 'valid-body-and-attachments') {
		return [
			fixture(
				name,
				await signCoreEmail({
					contentType: 'multipart/mixed; boundary="synthetic"',
					body: completeBody(),
				}),
			),
		]
	}

	if(name === 'partial-body-signature') {
		return [
			fixture(
				name,
				await signCoreEmail({ maxBodyLength: 10 }),
				'PROOF_CONTENT_NOT_AUTHENTICATED',
			),
		]
	}

	if(name === 'tampered-message') {
		return [
			fixture(
				name,
				Buffer.from(
					(await signCoreEmail()).toString().replace('USD 1234', 'USD 9999'),
				),
				'DKIM_VERIFICATION_FAILED',
			),
		]
	}

	if(name === 'unreadable-attachment') {
		return [
			fixture(
				name,
				await signCoreEmail({
					contentType: 'multipart/mixed; boundary="synthetic"',
					body: multipart([
						{
							type: 'text/plain; charset=utf-8',
							text: 'Synthetic income USD 1234',
						},
						{
							type: 'image/png',
							name: 'unreadable.png',
							bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
							encoding: 'base64',
							inline: true,
						},
					]),
				}),
			),
		]
	}

	if(name !== 'valid-rfc-variants') {
		throw new Error('UNKNOWN_SYNTHETIC_CASE')
	}

	const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 })
	const rsa4096 = generateKeyPairSync('rsa', { modulusLength: 4096 })
	const ed = generateKeyPairSync('ed25519')
	const cases: InspectionFixture[] = []
	for(const canonicalization of [
		'simple/simple',
		'relaxed/relaxed',
		'simple/relaxed',
		'relaxed/simple',
	]) {
		cases.push(
			fixture(canonicalization, await signCoreEmail({ canonicalization })),
		)
	}

	cases.push(
		fixture(
			'default-canonicalization-no-timestamp',
			resignTags(
				await signCoreEmail({ canonicalization: 'simple/simple' }),
				(line) => line.replace(/\bc=[^;]+;\s*/, '').replace(/\bt=[^;]+;\s*/, ''),
			),
		),
	)
	cases.push(
		fixture(
			'folded-and-oversigned-headers',
			await signCoreEmail({
				from: 'Synthetic\r\n Publisher <publisher@example.com>',
				headerList: [
					'from',
					'from',
					'to',
					'to',
					'date',
					'date',
					'content-type',
					'content-transfer-encoding',
					'mime-version',
				],
			}),
		),
	)
	cases.push(
		fixture('absent-subject', await signCoreEmail({ omit: ['subject'] })),
	)
	cases.push(fixture('unsigned-subject', await signCoreEmail()))
	cases.push(
		fixture(
			'unsigned-unused-mime-version',
			await signCoreEmail({
				headerList: [
					'from',
					'to',
					'date',
					'content-type',
					'content-transfer-encoding',
				],
			}),
		),
	)
	cases.push(
		fixture(
			'fully-covering-body-length',
			await signCoreEmail({ maxBodyLength: 1_000_000 }),
		),
	)
	cases.push(
		fixture(
			'multiple-to-recipients',
			await signCoreEmail({
				to: 'Bob <bob@example.net>, Alice <alice@example.net>',
			}),
		),
	)
	cases.push(
		fixture(
			'default-mime-type',
			await signCoreEmail({
				omit: ['content-type', 'content-transfer-encoding', 'mime-version'],
			}),
		),
	)
	for(const encoding of ['quoted-printable', '7bit', '8bit', 'binary']) {
		cases.push(
			fixture(
				`${encoding}-attachment`,
				await signCoreEmail({
					contentType: 'multipart/mixed; boundary="synthetic"',
					body: multipart([
						{ type: 'text/plain; charset=utf-8', text: 'Synthetic body' },
						{
							type: 'text/plain; charset=utf-8',
							name: 'synthetic.txt',
							encoding,
							text:
								encoding === 'quoted-printable'
									? 'Synthetic=20income=201234'
									: 'Synthetic income 1234',
						},
					]),
				}),
			),
		)
	}

	cases.push(
		fixture(
			'rsa-1024',
			await signCoreEmail({
				key: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
			}),
			undefined,
			async() => [
				[
					`v=DKIM1; k=rsa; p=${rsa.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}`,
				],
			],
		),
	)
	cases.push(
		fixture(
			'rsa-4096',
			await signCoreEmail({
				key: rsa4096.privateKey
					.export({ type: 'pkcs8', format: 'pem' })
					.toString(),
			}),
			undefined,
			async() => [
				[
					`v=DKIM1; k=rsa; p=${rsa4096.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}`,
				],
			],
		),
	)
	cases.push(
		fixture(
			'ed25519',
			await signCoreEmail({
				key: ed.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
				algorithm: 'ed25519-sha256',
			}),
			undefined,
			async() => [
				[
					`v=DKIM1; k=ed25519; p=${ed.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64')}`,
				],
			],
		),
	)
	cases.push(
		fixture(
			'from-only-signed',
			await signCoreEmail({ headerList: ['from'] }),
			'PROOF_METADATA_NOT_AUTHENTICATED',
		),
	)
	return cases
}
