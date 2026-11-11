/**
 * Country-code suggestion for a country-routed Popcorn browser session, when
 * the caller doesn't name one explicitly. `attach_browser` returns this as the
 * suggestion to confirm with the developer — the calling machine's own
 * public-IP country, resolved the same way reclaim-portal's `ip-geolocation`
 * util does.
 */
import assert from 'node:assert'
import { LOGGER } from '../logger.ts'

export interface IpGeolocation {
	countryCode: string
	country?: string
	region?: string
	city?: string
}

const IPINFO_URL = 'https://ipinfo.io/json'
const FALLBACK_COUNTRY_CODE = 'US'

/** Resolve the calling machine's own public-IP country. Never throws — a
 *  lookup failure just loses the "best guess" convenience, falling back to
 *  {@link FALLBACK_COUNTRY_CODE} rather than blocking applying a proxy. */
export async function suggestCountryFromIp(
	fetchImpl: typeof fetch = fetch,
): Promise<IpGeolocation> {
	try {
		return await fetchIpGeolocation(fetchImpl)
	} catch(err) {
		LOGGER.warn({ err }, 'suggestCountryFromIp failed; using fallback')
		return { countryCode: FALLBACK_COUNTRY_CODE }
	}
}

/** The calling machine's public-IP country, or undefined when the lookup
 *  fails: unlike {@link suggestCountryFromIp}, no guessed fallback. */
export async function lookupIpCountry(
	fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
	try {
		const { countryCode } = await fetchIpGeolocation(fetchImpl)
		return countryCode
	} catch(err) {
		LOGGER.warn({ err }, 'IP country lookup failed')
		return undefined
	}
}

async function fetchIpGeolocation(
	fetchImpl: typeof fetch,
): Promise<IpGeolocation> {
	const res = await fetchImpl(IPINFO_URL)
	assert(res.ok, new Error(`ipinfo.io ${res.status}`))
	const data = await res.json() as {
		country?: string
		region?: string
		city?: string
	}
	const countryCode = data.country?.toUpperCase()
	assert(countryCode, new Error('ipinfo.io response had no country'))
	return {
		countryCode,
		country: data.country,
		region: data.region,
		city: data.city,
	}
}
