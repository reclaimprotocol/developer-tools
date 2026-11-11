import * as oauth from 'openid-client'
import type { CachedSession } from './session-cache.ts'

/**
 * `offline_access` makes Better Auth's `oauth-provider` issue a refresh token
 * (it issues one only when the grant carries that scope), so the session can
 * outlive the 1-hour access token.
 */
export const SCOPE = 'openid profile email offline_access'

/** Where Better Auth mounts its OAuth endpoints under the Builder origin. */
export function authBaseFor(baseUrl: string) {
	return `${baseUrl}/auth`
}

/**
 * Request options every openid-client call against Builder's auth server
 * needs. Pass them to `dynamicClientRegistration` or `discovery`; the
 * returned `Configuration` keeps them for its later calls.
 */
export function oauthRequestOptions(authBase: string) {
	// openid-client/oauth4webapi refuse any non-HTTPS issuer by default
	// ("only requests to HTTPS are allowed"). Better Auth's own dev default
	// (Builder's canonical origin) is plain
	// `http://localhost:4001` — the server side has no HTTPS requirement at
	// all — so a local `RECLAIM_API_URL=http://localhost:...` would otherwise
	// always fail here. Loosen it ONLY for loopback hosts, matching what the
	// server already trusts (`authTrustedOrigins()` defaults to
	// localhost:4000/4001 outside production); a non-loopback http:// origin
	// still gets the strict check.
	const isLoopbackAuthBase =
		['localhost', '127.0.0.1', '[::1]'].includes(new URL(authBase).hostname)
	return {
		// Better Auth exposes its metadata at the RFC 8414 well-known path
		// (`.well-known/oauth-authorization-server`), not the OIDC one.
		algorithm: 'oauth2' as const,
		// RFC 7591 §3.2.1 requires 201 Created on a successful registration;
		// openid-client enforces that strictly. Better Auth's `oauth-provider`
		// plugin returns 200 with an otherwise well-formed body. `customFetch`
		// persists onto the returned `Configuration` for ALL its future calls
		// (token exchange included, which correctly returns 200), so the URL,
		// not just method+status, gates the rewrite.
		[oauth.customFetch]: customFetchForOauth,
		...(isLoopbackAuthBase ? { execute: [oauth.allowInsecureRequests] } : {}),
	}
}

/**
 * The session to cache for a token response. A refresh response may omit
 * `refresh_token` (no rotation), so the caller passes the one it already has.
 */
export function sessionFromTokens(
	tokens: oauth.TokenEndpointResponse,
	client: { clientId: string, authBase: string, refreshToken?: string },
): CachedSession {
	return {
		token: tokens.access_token,
		expiresAt: new Date(
			Date.now() + (tokens.expires_in ?? 3600) * 1000,
		).toISOString(),
		refreshToken: tokens.refresh_token ?? client.refreshToken,
		clientId: client.clientId,
		authBase: client.authBase,
	}
}

async function customFetchForOauth(
	url: string,
	options: oauth.CustomFetchOptions,
) {
	// openid-client hands over a fetch-compatible options bag whose `body`
	// type is narrower than, but assignable in practice to, `RequestInit`'s.
	const res = await fetch(url, options as RequestInit)
	if(
		options.method === 'POST' && res.status === 200
		&& new URL(url).pathname.endsWith('/oauth2/register')
	) {
		return new Response(await res.text(), {
			status: 201,
			headers: res.headers,
		})
	}

	return res
}
