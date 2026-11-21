/* eslint-disable @stylistic/max-len -- ported from the email core's test suite; kept close to upstream so the two can be compared */
import { prepareDisplayAttachment } from '../../../src/email/core/preview.ts'
import { expect, test } from './vitest-compat.ts'

test('display attachments use isolated byte sniffing rather than the declared type or filename', async() => {
	const bytes = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7l8AAAAASUVORK5CYII=',
		'base64',
	)
	const result = await prepareDisplayAttachment(
		{ bytes, filename: 'misleading.html', mimeType: 'text/html' },
		new AbortController().signal,
	)
	expect(result.view).toBe('image')
	expect(result.contentType).toBe('image/png')
	expect(result.bytes).toEqual(bytes)
	expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
	result.bytes.fill(0)
})

test('text attachments use the existing isolated extractor', async() => {
	const result = await prepareDisplayAttachment(
		{
			bytes: Buffer.from('Independent readable text'),
			filename: 'note.txt',
			mimeType: 'text/plain',
		},
		new AbortController().signal,
	)
	expect(result.view).toBe('text')
	expect(result.contentType).toBe('text/plain; charset=utf-8')
	expect(result.bytes.toString()).toContain('Independent readable text')
	result.bytes.fill(0)
})

test('cancelled and oversized attachment jobs fail before launching a parser', async() => {
	const signal = AbortSignal.abort()
	await expect(
		prepareDisplayAttachment(
			{
				bytes: Buffer.from('small'),
				filename: 'note.txt',
				mimeType: 'text/plain',
			},
			signal,
		),
	).rejects.toThrow()
	await expect(
		prepareDisplayAttachment(
			{
				bytes: Buffer.alloc(6 * 1024 * 1024 + 1),
				filename: 'large.txt',
				mimeType: 'text/plain',
			},
			new AbortController().signal,
		),
	).rejects.toThrow('PREVIEW_ATTACHMENT_LIMIT')
})
