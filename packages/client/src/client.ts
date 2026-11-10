import type {
	IOperationArgs,
	IOperationId,
	IOperationResponse,
} from './types/openapi.ts'
import { DEFAULT_BASE_URL } from './consts.ts'
import { throwProblemError } from './errors.ts'
import { ROUTES } from './routes.gen.ts'

export type ReclaimClientOptions = {
	/** Backend base URL. Defaults to {@link DEFAULT_BASE_URL}. */
	baseUrl?: string
	/** Bearer token for authenticated operations. */
	token?: string
	/** Custom fetch implementation. Defaults to global `fetch`. */
	fetch?: typeof fetch
	/** Extra headers merged into every request. */
	headers?: Record<string, string>
}

/**
 * Browser-safe typed HTTP client generated from the Builder OpenAPI contract.
 */
export class ReclaimClient {
	readonly baseUrl: string
	#token: string | undefined
	#fetch: typeof fetch
	#headers: Record<string, string>

	constructor(opts: ReclaimClientOptions = {}) {
		this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '')
		this.#token = opts.token
		this.#fetch = opts.fetch || fetch
		this.#headers = {
			Accept: 'application/json',
			...opts.headers,
		}
	}

	setToken(token: string | undefined) {
		this.#token = token
	}

	getToken() {
		return this.#token
	}

	async call<T extends IOperationId>(
		operationId: T,
		...argsRest: {} extends IOperationArgs<T>
			? [args?: IOperationArgs<T>]
			: [args: IOperationArgs<T>]
	): Promise<{ data: IOperationResponse<T>, response: Response }> {
		const args = argsRest[0]
		const op = ROUTES[operationId]

		let url = `${this.baseUrl}${op.path}`
		if(args?.params) {
			for(const [key, value] of Object.entries(args.params)) {
				url = url.replace(`{${key}}`, String(value))
			}
		}

		if(args?.query && Object.keys(args.query).length > 0) {
			const search = new URLSearchParams()
			for(const [key, value] of Object.entries(args.query)) {
				if(value === undefined || value === null) {
					continue
				}

				if(Array.isArray(value)) {
					for(const item of value) {
						search.append(key, String(item))
					}
				} else {
					search.append(key, String(value))
				}
			}

			url += `?${search.toString()}`
		}

		const headers: Record<string, string> = {
			...this.#headers,
			Accept: 'application/json',
		}
		if(this.#token) {
			headers['Authorization'] = `Bearer ${this.#token}`
		}

		if(args?.headers) {
			for(const [key, value] of Object.entries(args.headers)) {
				if(value === undefined || value === null) {
					continue
				}

				headers[key] = String(value)
			}
		}

		const init: RequestInit = {
			method: op.method.toUpperCase(),
			headers,
		}
		const method = op.method.toLowerCase()
		if(method !== 'get' && method !== 'head') {
			init.body = JSON.stringify(args?.body ?? {})
			headers['Content-Type'] = 'application/json'
		}

		const res = await this.#fetch(url, init)
		if(!res.ok) {
			await throwProblemError(res)
		}

		const empty = res.status === 204
			|| res.headers.get('content-length') === '0'
		// Fetch exposes parsed JSON as `any`; OpenAPI owns the operation-specific
		// response type, and callers can inspect the original Response if needed.
		const data = (
			empty ? undefined : await res.json()
		) as IOperationResponse<T>
		return { data, response: res }
	}
}
