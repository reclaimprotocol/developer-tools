
import { pdfDocument } from './documents.ts'
import { type FixtureOptions, signedEmail } from './signed-email.ts'

export const pdfBytes = pdfDocument('Verified statement')
export const csvBytes = Buffer.from('name,earnings\r\nAlice,4231.77\r\n')
export const attachmentBody = [
	'--files',
	'Content-Type: text/plain; charset=utf-8',
	'',
	'Your earnings statement is attached.',
	'--files',
	'Content-Type: application/pdf; name="earnings.pdf"',
	'Content-Disposition: attachment; filename="earnings.pdf"',
	'Content-Transfer-Encoding: base64',
	'',
	pdfBytes.toString('base64'),
	'--files',
	'Content-Type: text/csv; charset=utf-8',
	'Content-Disposition: attachment; filename="summary.csv"',
	'Content-Transfer-Encoding: quoted-printable',
	'',
	'name,earnings=0D=0AAlice,4231.77=0D=0A',
	'--files--',
	'',
].join('\r\n')

export const attachmentEmail = (options: FixtureOptions = {}) => signedEmail({
	contentType: 'multipart/mixed; boundary="files"',
	body: attachmentBody,
	...options,
})
