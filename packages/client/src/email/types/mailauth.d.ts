declare module 'mailauth/lib/dkim/verify.js' {
	export function dkimVerify(
		raw: Buffer,
		options: {
			strict: boolean
			rejectRsaSha1: boolean
			resolver?: (name: string, type: string) => Promise<string[][]>
			minBitLength?: number
		},
	): Promise<{
		results: Array<{
			signingDomain?: string
			selector?: string
			signature?: string
			algo?: string
			signatureTimeValid?: boolean
			canonBodyLengthLimit?: number
			signingHeaders?: { keys?: string[], headers?: string[] }
			status?: { result?: string, testing?: boolean, comment?: string | false }
		}>
	}>
}
declare module 'mailauth/lib/dkim/sign' {
	export function dkimSign(
		raw: Buffer,
		options: Record<string, unknown>,
	): Promise<{
		signatures: string
		errors: Array<{ message?: string }>
	}>
}
