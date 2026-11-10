import { PROBLEM_CONTENT_TYPE } from '@reclaimprotocol/client/api'
import * as oauth from 'openid-client'
import { ConfigStore } from '../../../config/store.ts'
import { LOGGER } from '../../../logger.ts'
import { oauthRequestOptions, sessionFromTokens } from './oauth-config.ts'

export type CachedSession = {
	token: string
	/** ISO timestamp when the access token expires. */
	expiresAt: string
	/** Email of the user who authorized (if available). */
	email?: string
	/** OAuth refresh token; trades for a new access token near expiry. */
	refreshToken?: string
	/** Public OAuth client the tokens were issued to (refresh needs it). */
	clientId?: string
	/** Auth server base URL that issued the tokens. */
	authBase?: string
}

/** Refresh this long before the access token actually expires. */
const EXPIRY_MARGIN_MS = 60 * 1000

/** Persist the auth token to the `session` section of the unified config. */
export function writeSession(session: CachedSession) {
	new ConfigStore().write({ session })
}

/**
 * Read the cached session, returning it only if the token is still
 * valid (not yet expired). Returns undefined on any error.
 */
export function readSession(): CachedSession | undefined {
	const s = readStoredSession()
	if(!s || new Date(s.expiresAt) <= new Date()) {
		return undefined
	}

	return s
}

/** The cached session even when its access token has expired. */
export function readStoredSession(): CachedSession | undefined {
	const s = new ConfigStore().read()?.session
	return s?.token && s.expiresAt ? s : undefined
}

/**
 * Wraps `fetch` for the Builder client so a cached sign-in keeps working past
 * the access token's lifetime. Each request uses the cached session's token,
 * refreshed via the OAuth refresh grant when it's about to expire or when
 * Builder answers 401. If no refresh is possible, the 401 tells the agent to
 * sign in again with `signInTool`. Without a cached session, requests pass
 * through untouched. Don't install it when `RECLAIM_API_TOKEN` is set: that
 * token takes precedence and is never refreshed.
 */
export function sessionRefreshingFetch(
	signInTool: string,
	baseFetch: typeof fetch = fetch,
): typeof fetch {
	// One refresh at a time: Better Auth rotates refresh tokens and revokes
	// the whole family when a used one is replayed.
	let refreshing: Promise<CachedSession | undefined> | undefined
	return async(input, init) => {
		let session = readStoredSession()
		if(!session) {
			return baseFetch(input, init)
		}

		const expiring =
			new Date(session.expiresAt).getTime() - Date.now() < EXPIRY_MARGIN_MS
		const triedRefresh = expiring && !!session.refreshToken
		if(triedRefresh) {
			session = await refreshOnce(session) ?? session
		}

		const res = await baseFetch(input, withBearer(init, session.token))
		if(res.status !== 401) {
			return res
		}

		const next = triedRefresh ? undefined : await refreshOnce(session)
		if(next) {
			return baseFetch(input, withBearer(init, next.token))
		}

		return sessionExpiredResponse(signInTool)
	}

	function refreshOnce(session: CachedSession) {
		refreshing ??= refreshSession(session)
			.finally(() => {
				refreshing = undefined
			})
		return refreshing
	}
}

/**
 * Trade the session's refresh token for a new access token and cache the
 * result. Returns undefined when the session can't be refreshed; a refresh
 * token the server rejects is dropped so later calls stop retrying it.
 */
export async function refreshSession(
	session: CachedSession,
): Promise<CachedSession | undefined> {
	const { refreshToken, clientId, authBase } = session
	if(!refreshToken || !clientId || !authBase) {
		return undefined
	}

	try {
		const config = await oauth.discovery(
			new URL(authBase),
			clientId,
			undefined,
			oauth.None(),
			oauthRequestOptions(authBase),
		)
		const tokens = await oauth.refreshTokenGrant(config, refreshToken)
		const next: CachedSession = {
			...sessionFromTokens(tokens, { clientId, authBase, refreshToken }),
			email: session.email,
		}
		writeSession(next)
		return next
	} catch(err) {
		LOGGER.warn({ err }, 'builder session refresh failed')
		if(err instanceof oauth.ResponseBodyError) {
			writeSession({ ...session, refreshToken: undefined })
		}

		return undefined
	}
}

function withBearer(init: RequestInit | undefined, token: string) {
	const headers = new Headers(init?.headers)
	headers.set('Authorization', `Bearer ${token}`)
	return { ...init, headers }
}

function sessionExpiredResponse(signInTool: string) {
	return new Response(JSON.stringify({
		type: 'about:blank',
		title: 'Unauthorized',
		status: 401,
		detail: 'Your Builder sign-in expired and could not be refreshed. '
			+ `Call ${signInTool} to sign in again, then retry.`,
	}), { status: 401, headers: { 'content-type': PROBLEM_CONTENT_TYPE } })
}
