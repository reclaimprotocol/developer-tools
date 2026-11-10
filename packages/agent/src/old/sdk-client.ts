import { Boom } from '@hapi/boom'
import { NAME, VERSION } from '../pkg.ts'

/**
 * Default origin of the PUBLIC production read API that the Reclaim
 * verification SDK/attestor itself calls at runtime to fetch a provider's
 * recipe — a DIFFERENT service from the old-devtools dashboard backend
 * (`ReclaimOldClient`, `devapi.reclaimprotocol.org`). Both endpoints below are
 * unauthenticated reads (no `authenticateToken` middleware on this backend's
 * routes), so this client needs no identity. Override with
 * `RECLAIM_SDK_API_URL`.
 */
export const DEFAULT_SDK_API_URL = 'https://api.reclaimprotocol.org'

/**
 * Minimal read-only client for the public provider-info endpoints on the SDK
 * backend (`reclaim-sdk-backend`). Two distinct reads, on purpose:
 *
 *   - `getProvider` (`GET /providers/:id`) — the full provider row merged
 *     with its version's WHOLE providerConfig, `customInjection` included.
 *   - `getProviderConfigs` (`GET /providers/:id/configs`) — the trimmed
 *     recipe the attestor actually consumes at verification time: a fixed
 *     field projection that explicitly OMITS `customInjection` and adds a
 *     computed `isScriptRequestingClaim` flag instead.
 *
 * Errors are thrown as `@hapi/boom` so `remapErrorAsResponse` renders them
 * the same way as every other tool in this package.
 */
export class ReclaimSdkClient {
	readonly baseUrl: string
	#fetch: typeof fetch

	constructor(opts: { baseUrl?: string, fetch?: typeof fetch } = {}) {
		this.baseUrl = (opts.baseUrl || DEFAULT_SDK_API_URL).replace(/\/+$/, '')
		this.#fetch = opts.fetch ?? fetch
	}

	/** Full provider + providerConfig (includes `customInjection`). Latest
	 *  version when `versionNumber` is omitted. */
	getProvider(providerId: string, versionNumber?: string): Promise<unknown> {
		return this.#get(
			`/providers/${encodeURIComponent(providerId)}`,
			versionNumber,
		)
	}

	/** Trimmed runtime recipe (no `customInjection`; adds
	 *  `isScriptRequestingClaim`). Latest version when `versionNumber` is
	 *  omitted. */
	getProviderConfigs(
		providerId: string,
		versionNumber?: string,
	): Promise<unknown> {
		return this.#get(
			`/providers/${encodeURIComponent(providerId)}/configs`,
			versionNumber,
		)
	}

	async #get(path: string, versionNumber?: string): Promise<unknown> {
		let url = `${this.baseUrl}/api${path}`
		if(versionNumber) {
			url += `?versionNumber=${encodeURIComponent(versionNumber)}`
		}

		const res = await this.#fetch(url, {
			method: 'GET',
			headers: {
				Accept: 'application/json',
				'User-Agent': `${NAME}/${VERSION}`,
			},
		})

		let json: unknown
		try {
			json = await res.json()
		} catch{
			json = undefined
		}

		const failed =
			!res.ok ||
			(json !== undefined &&
				typeof json === 'object' &&
				(json as { isSuccess?: unknown }).isSuccess === false)
		if(failed) {
			const message =
				(json && typeof json === 'object' &&
					typeof (json as { message?: unknown }).message === 'string'
					? (json as { message: string }).message
					: undefined) || res.statusText || 'SDK backend request failed'
			throw new Boom(message, {
				statusCode: res.ok ? 502 : res.status,
				data: {
					status: res.status,
					title: message,
					detail: message,
					body: json,
				},
			})
		}

		return json
	}
}
