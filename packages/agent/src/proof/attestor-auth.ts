import { createAuthRequest, type proto } from '@reclaimprotocol/attestor-core'

/** Session-bound authorization in both forms used by Reclaim proof clients. */
export interface AttestorAuthentication {
	/** Native object consumed by the JavaScript attestor client. */
	request: proto.AuthenticationRequest
	/** Legacy base64 JSON token consumed by native TEE clients. */
	token: string
}

/**
 * Create legacy-compatible attestor authorization when the deployment has an
 * auth private key. An absent key intentionally means authentication is off.
 *
 * `expiresInSeconds` overrides the attestor library's default lifetime. A
 * zkFetch authorization uses a very short one: the attestor validates expiry
 * once, when it authenticates the connection, and never again for the life of
 * that connection — so the window only has to cover the caller receiving the
 * token and opening its socket, not the proof that follows.
 */
export async function createAttestorAuthentication(
	sessionId: string,
	privateKey: string | undefined,
	opts: { expiresInSeconds?: number } = {},
): Promise<AttestorAuthentication | undefined> {
	if(!privateKey?.trim()) {
		return undefined
	}

	const request = await createAuthRequest(
		{
			id: sessionId,
			...(opts.expiresInSeconds === undefined
				? {}
				: {
					expiresAt: Math.floor(Date.now() / 1000) + opts.expiresInSeconds,
				}),
		},
		privateKey,
	)
	const token = Buffer.from(
		JSON.stringify({
			...request,
			signature: Buffer.from(request.signature).toString('base64'),
		}),
		'utf8',
	).toString('base64')

	return { request, token }
}
