export function looksLikeGraphqlEndpoint(url: string): boolean {
	try {
		const u = new URL(url)
		return u.pathname.includes('/graphql')
	} catch{
		return false
	}
}

export function extractGraphqlOp(body: string | undefined): string | undefined {
	if(!body) {
		return undefined
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(body)
	} catch{
		return undefined
	}

	if(typeof parsed !== 'object' || parsed === null) {
		return undefined
	}

	const obj = parsed as Record<string, unknown>

	if(typeof obj.operationName === 'string' && obj.operationName.length > 0) {
		return obj.operationName
	}

	if(typeof obj.query === 'string') {
		const m = obj.query.match(
			/^\s*(?:query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/,
		)
		if(m) {
			return m[1]
		}
	}

	return undefined
}
