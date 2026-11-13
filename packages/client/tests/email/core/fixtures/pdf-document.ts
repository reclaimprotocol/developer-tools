/* eslint-disable @stylistic/max-len -- ported from the email core's test suite; kept close to upstream so the two can be compared */
import { deflateSync } from 'node:zlib'

export function pdfDocument(text = 'Your earnings: $4,231.77 Alice'): Buffer {
	const escaped = text.replace(/[\\()]/g, '\\$&')
	const stream = deflateSync(
		Buffer.from(
			text ? `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET` : '0 0 10 10 re f',
		),
	)
	const objects = [
		Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
		Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
		Buffer.from(
			'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
		),
		Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
		Buffer.concat([
			Buffer.from(
				`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`,
			),
			stream,
			Buffer.from('\nendstream'),
		]),
	]
	const chunks = [Buffer.from('%PDF-1.4\n')]
	const offsets = [0]
	for(const [index, object] of objects.entries()) {
		offsets.push(Buffer.concat(chunks).length)
		chunks.push(
			Buffer.from(`${index + 1} 0 obj\n`),
			object,
			Buffer.from('\nendobj\n'),
		)
	}

	const xref = Buffer.concat(chunks).length
	chunks.push(
		Buffer.from(
			`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
				.slice(1)
				.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
				.join(
					'',
				)}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
		),
	)
	return Buffer.concat(chunks)
}
