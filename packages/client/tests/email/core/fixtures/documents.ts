/* eslint-disable @stylistic/max-len -- ported from the email core's test suite; kept close to upstream so the two can be compared */
import { strToU8, zipSync } from 'fflate'
import { type FixtureOptions, signedEmail } from './signed-email.ts'

const xml = (value: string) => value
	.replace(/&/g, '&amp;')
	.replace(/</g, '&lt;')
	.replace(/>/g, '&gt;')
	.replace(/"/g, '&quot;')

export { pdfDocument } from './pdf-document.ts'

export function docxDocument(text = 'Your earnings: $4,231.77 Alice'): Buffer {
	return Buffer.from(
		zipSync(
			{
				'[Content_Types].xml': strToU8(
					'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
				),
				'_rels/.rels': strToU8(
					'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
				),
				'word/document.xml': strToU8(
					`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${xml(text)}</w:t></w:r></w:p></w:body></w:document>`,
				),
			},
			{ mtime: new Date('2026-01-01T00:00:00Z') },
		),
	)
}

export function xlsxDocument(): Buffer {
	return Buffer.from(
		zipSync(
			{
				'[Content_Types].xml': strToU8(
					'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
				),
				'_rels/.rels': strToU8(
					'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
				),
				'xl/workbook.xml': strToU8(
					'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Earnings" sheetId="1" r:id="rId1"/></sheets></workbook>',
				),
				'xl/_rels/workbook.xml.rels': strToU8(
					'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
				),
				'xl/worksheets/sheet1.xml': strToU8(
					'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Earnings</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Alice</t></is></c><c r="B2"><v>4231.77</v></c></row></sheetData></worksheet>',
				),
			},
			{ mtime: new Date('2026-01-01T00:00:00Z') },
		),
	)
}

export function documentEmail(
	bytes: Buffer,
	filename: string,
	mimeType = 'application/octet-stream',
	options: FixtureOptions = {},
) {
	return signedEmail({
		contentType: 'multipart/mixed; boundary="documents"',
		body: [
			'--documents',
			'Content-Type: text/plain; charset=utf-8',
			'',
			'Your earnings statement is attached.',
			'--documents',
			`Content-Type: ${mimeType}`,
			`Content-Disposition: attachment; filename="${filename}"`,
			'Content-Transfer-Encoding: base64',
			'',
			bytes.toString('base64'),
			'--documents--',
			'',
		].join('\r\n'),
		...options,
	})
}
