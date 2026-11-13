/* eslint-disable @stylistic/max-len -- ported from the email core's test suite; kept close to upstream so the two can be compared */
import { zipSync } from 'fflate'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractSourceText } from '../../../src/email/core/documents.ts'
import { runDocumentWorker } from '../../../src/email/core/isolation.ts'
import { expect, it } from './vitest-compat.ts'

it('a hostile parser cannot read host credentials, inherit secrets, retain capabilities or connect to host services', async() => {
	const temporary = await mkdtemp(join(tmpdir(), 'email-isolation-test-'))
	const secretPath = join(temporary, 'synthetic-secret')
	await writeFile(secretPath, 'SYNTHETIC_PRIVATE_MARKER')
	let requests = 0
	const server = createServer((_req, res) => {
		requests++
		res.end('synthetic')
	})
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', resolve)
	})
	const port = (server.address() as { port: number }).port
	const previous = process.env.SYNTHETIC_SECRET
	process.env.SYNTHETIC_SECRET = 'SYNTHETIC_PRIVATE_MARKER'
	try {
		const result = await runDocumentWorker(
			fileURLToPath(new URL('./fixtures/isolation-probe.mjs', import.meta.url)),
			JSON.stringify({ port, secretPath }),
			new AbortController().signal,
		)
		expect(result).toMatchObject({
			secretReadable: false,
			hostRootReadable: false,
			credentialEnv: null,
			connected: false,
			capabilities: '0000000000000000',
			environment: [],
			writable: false,
			memoryBounded: true,
		})
		expect((result as { limits: string }).limits).toMatch(
			/Max address space\s+2147483648\s+2147483648/,
		)
		expect((result as { limits: string }).limits).toMatch(
			/Max cpu time\s+20\s+20/,
		)
		const html = await extractSourceText(
			[
				{
					id: 'body:0',
					filename: 'part-0',
					mimeType: 'text/html',
					body: true,
					charset: 'utf-8',
					bytes:
						Buffer.from(`<script>fetch('http://127.0.0.1:${port}')</script><img src="http://127.0.0.1:${port}/">
        <style>@import "http://127.0.0.1:${port}/";</style><p>Synthetic income 1234</p><a href="file://${secretPath}">Document</a>`),
				},
			],
			new AbortController().signal,
		)
		expect(html[0].text).toContain('Synthetic income')
		expect(html[0].text).not.toContain('http')
		expect(html[0].text).not.toContain('PRIVATE_MARKER')
		expect(requests).toBe(0)
	} finally {
		if(previous === undefined) {
			delete process.env.SYNTHETIC_SECRET
		} else {
			process.env.SYNTHETIC_SECRET = previous
		}

		await new Promise<void>((resolve) => server.close(() => resolve()))
		await rm(temporary, { recursive: true, force: true })
	}
})

it('rejects actual ZIP expansion above 64 MiB, external entities and text over the source budget', async() => {
	const zip = Buffer.from(
		zipSync({ 'word/media/binary.dat': new Uint8Array(65 * 1024 * 1024) }),
	)
	// Lie about the uncompressed sizes in both ZIP headers. Actual inflation still exceeds the limit.
	for(let i = 0; i + 28 < zip.length; i++) {
		if(zip.readUInt32LE(i) === 0x04034b50) {
			zip.writeUInt32LE(0, i + 22)
		}

		if(zip.readUInt32LE(i) === 0x02014b50) {
			zip.writeUInt32LE(0, i + 24)
		}
	}

	const output = await extractSourceText(
		[
			{
				id: 'attachment:0',
				filename: 'bomb.docx',
				mimeType: 'application/octet-stream',
				bytes: zip,
			},
			{
				id: 'attachment:1',
				filename: 'entities.xml',
				mimeType: 'application/xml',
				bytes: Buffer.from(
					'<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><x>&x;</x>',
				),
			},
			{
				id: 'body:2',
				filename: 'part-2',
				mimeType: 'text/plain',
				body: true,
				bytes: Buffer.from('a'.repeat(100_001)),
			},
		],
		new AbortController().signal,
	)
	expect(output[0].formatError).toBe('ATTACHMENT_TEXT_TOO_LARGE')
	expect(output[1].formatError).toBe('ATTACHMENT_FORMAT_INVALID')
	expect(output[2].error).toBe('ATTACHMENT_TEXT_TOO_LARGE')
})

it('normalizes supported text formats and unambiguous BOMs without guessing an encoding', async() => {
	const output = await extractSourceText(
		[
			{
				id: 'attachment:0',
				filename: 'text.txt',
				mimeType: 'text/plain',
				bytes: Buffer.concat([
					Buffer.from([0xff, 0xfe]),
					Buffer.from('Synthetic\r\nincome', 'utf16le'),
				]),
			},
			{
				id: 'attachment:1',
				filename: 'data.json',
				mimeType: 'application/json',
				bytes: Buffer.from('{\r\n  "income": 1234\r\n}'),
			},
			{
				id: 'attachment:2',
				filename: 'data.xml',
				mimeType: 'application/xml',
				bytes: Buffer.from('<statement><income>1234</income></statement>'),
			},
			{
				id: 'attachment:3',
				filename: 'data.html',
				mimeType: 'text/html',
				bytes: Buffer.from('<p>Income 1234</p><script>SECRET</script>'),
			},
			{
				id: 'attachment:4',
				filename: 'bad.txt',
				mimeType: 'text/plain',
				bytes: Buffer.from([0x61, 0xc3, 0x28]),
				charset: 'utf-8',
			},
			{
				id: 'attachment:5',
				filename: 'bom.txt',
				mimeType: 'text/plain',
				bytes: Buffer.from('\uFEFF\uFEFFSynthetic\r\nincome'),
				charset: 'utf-8',
			},
		],
		new AbortController().signal,
	)
	expect(output.slice(0, 4).map((o) => o.text)).toEqual([
		'Synthetic\nincome',
		'{\n  "income": 1234\n}',
		'1234',
		'Income 1234',
	])
	expect(output[4].formatError).toBe('ATTACHMENT_TEXT_UNREADABLE')
	expect(output[5].text).toBe('\uFEFFSynthetic\nincome')
})

it('fails closed when the configured isolation runtime is unavailable', async() => {
	const previous = process.env.EMAIL_DOCUMENT_BWRAP
	process.env.EMAIL_DOCUMENT_BWRAP = '/nonexistent/email-bubblewrap'
	try {
		await expect(
			extractSourceText(
				[
					{
						id: 'body:0',
						filename: 'text',
						mimeType: 'text/plain',
						body: true,
						bytes: Buffer.from('Synthetic'),
					},
				],
				new AbortController().signal,
			),
		).rejects.toThrow('DOCUMENT_ISOLATION_UNAVAILABLE')
	} finally {
		if(previous === undefined) {
			delete process.env.EMAIL_DOCUMENT_BWRAP
		} else {
			process.env.EMAIL_DOCUMENT_BWRAP = previous
		}
	}
})

it('cancels the actual isolated child', async() => {
	const controller = new AbortController()
	const work = runDocumentWorker(
		fileURLToPath(new URL('./fixtures/isolation-probe.mjs', import.meta.url)),
		JSON.stringify({ hang: true }),
		controller.signal,
	)
	const timer = setTimeout(() => controller.abort(), 1000)
	try {
		await expect(work).rejects.toThrow('EMAIL_APPROVAL_CANCELLED')
	} finally {
		clearTimeout(timer)
	}
})

it('rejects an obsolete isolation runtime before launching a parser', async() => {
	const temporary = await mkdtemp(join(tmpdir(), 'email-runtime-version-'))
	const executable = join(temporary, 'bwrap')
	await writeFile(executable, '#!/bin/sh\nprintf "bubblewrap 0.6.1\\n"\n', {
		mode: 0o700,
	})
	const previous = process.env.EMAIL_DOCUMENT_BWRAP
	process.env.EMAIL_DOCUMENT_BWRAP = executable
	try {
		await expect(
			extractSourceText(
				[
					{
						id: 'body:0',
						filename: 'text',
						mimeType: 'text/plain',
						body: true,
						bytes: Buffer.from('Synthetic'),
					},
				],
				new AbortController().signal,
			),
		).rejects.toThrow('DOCUMENT_ISOLATION_UNAVAILABLE')
	} finally {
		if(previous === undefined) {
			delete process.env.EMAIL_DOCUMENT_BWRAP
		} else {
			process.env.EMAIL_DOCUMENT_BWRAP = previous
		}

		await rm(temporary, { recursive: true, force: true })
	}
})
