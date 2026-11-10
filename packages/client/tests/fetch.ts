export type FetchCall = {
	url: string
	init: RequestInit
}

/** Creates a typed fetch test double and records each request. */
export function stubFetch(
	handler: (
		url: string,
		init: RequestInit,
	) => Response | Promise<Response>,
) {
	const calls: FetchCall[] = []
	const fetch: typeof globalThis.fetch = async(input, init = {}) => {
		const call = { url: requestUrl(input), init }
		calls.push(call)
		return await handler(call.url, call.init)
	}

	return { fetch, calls }
}

function requestUrl(input: string | URL | Request) {
	if(typeof input === 'string') {
		return input
	}

	return input instanceof URL ? input.href : input.url
}
