import type { ReclaimProvider } from './schema.ts'

/**
 * Advisory pre-publish lint for a drafted provider — never a gate. Surfaces
 * only what the AUTHOR must decide; everything testable is tested by the
 * verification client itself (CDP capture sees all traffic — navigations,
 * XHRs, fetches — and Builder's `checkCandidate`
 * selects the captured request that satisfies the recipe, skipping the
 * rest). Interpolation and matching are plain text and work for any
 * captured content; extract selectors apply client-side in spec order
 * xPath → jsonPath → regex, each to the prior selection.
 */
export function verificationWarnings(provider: ReclaimProvider): string[] {
	const out: string[] = []

	// Untemplated user-specific URL parts: any captured param value baked
	// literally into the URL makes the provider user-specific. Only the dev
	// can decide: consumer-supplied → {{context.<name>}} (declared in
	// requiredContext; consumers then send the exact value and the VC matches
	// only that value), bare {{<name>}} (resolved from the end-user's own
	// traffic), or re-capture a non-user-specific endpoint.
	for(const [name, value] of Object.entries(provider.paramValues ?? {})) {
		if(value.length >= 3 && provider.url.includes(value)) {
			out.push(
				`The URL contains the captured value "${value}" (param ` +
				`"${name}") as a literal. Decide with the dev: if consumers ` +
				'supply it, replace with {{context.' + name + '}} (published ' +
				'requiredContext will require it; verification matches only ' +
				'the supplied value). Leaving it literal pins the provider ' +
				'to this user.',
			)
		}
	}

	return out
}
