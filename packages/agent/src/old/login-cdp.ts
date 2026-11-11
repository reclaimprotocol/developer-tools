import { connectCdp } from '../cdp/client.ts'
import {
	defaultProfileDir,
	launchLocalBrowser,
	waitForCdpReady,
} from '../cdp/launcher.ts'
import { ConfigStore } from '../config/store.ts'
import { DEFAULT_LOGIN_URL, oldLoginUrl } from '../consts.ts'

/**
 * Read the Firebase ID token the dashboard persisted after login.
 *
 * The frontend uses `browserLocalPersistence`, which the Firebase JS SDK
 * implements on `localStorage` under a `firebase:authUser:<apiKey>:[DEFAULT]`
 * key whose JSON value carries `stsTokenManager.accessToken`. We scan for any
 * such key (so we never hard-code the project apiKey) and fall back to the
 * IndexedDB persistence layout (`firebaseLocalStorageDb` /
 * `firebaseLocalStorage`) in case a build switches persistence. Returns the
 * token string, or null when the user has not finished logging in yet.
 *
 * The CDP-launched Chrome reuses a PERSISTENT profile dir across runs, so a
 * stale `firebase:authUser:*` entry from an earlier (now-expired, ~1h TTL)
 * session is often still sitting in storage the instant the page loads —
 * before the developer has clicked anything. Returning that immediately
 * makes the poll "succeed" on tick one, closing the tab before the developer
 * can sign in, and the captured token then fails backend verification. So
 * every candidate's JWT `exp` claim is checked here (in-page, where `atob` is
 * available) and stale ones are skipped — the loop keeps polling until a
 * genuinely fresh token shows up from an interactive sign-in.
 *
 * Evaluated in-page with `awaitPromise` so the async IndexedDB branch resolves.
 */
export const EXTRACT_TOKEN_JS = `(async () => {
	const isFresh = (token) => {
		try {
			const payload = JSON.parse(
				atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
			)
			// No exp claim to check — don't block a token we can't evaluate.
			if (typeof payload.exp !== 'number') return true
			// 60s buffer so a token that's about to expire isn't treated as fresh.
			return payload.exp * 1000 > Date.now() + 60000
		} catch (e) {
			return true
		}
	}
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i)
			if (k && k.indexOf('firebase:authUser:') === 0) {
				const v = JSON.parse(localStorage.getItem(k) || 'null')
				const t = v && v.stsTokenManager && v.stsTokenManager.accessToken
				if (t && isFresh(t)) return t
			}
		}
	} catch (e) {}
	try {
		return await new Promise((resolve) => {
			const req = indexedDB.open('firebaseLocalStorageDb')
			req.onerror = () => resolve(null)
			req.onsuccess = () => {
				try {
					const db = req.result
					if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
						resolve(null); return
					}
					const store = db
						.transaction('firebaseLocalStorage', 'readonly')
						.objectStore('firebaseLocalStorage')
					const all = store.getAll()
					all.onerror = () => resolve(null)
					all.onsuccess = () => {
						for (const row of (all.result || [])) {
							const m = row && row.value && row.value.stsTokenManager
							if (m && m.accessToken && isFresh(m.accessToken)) {
								resolve(m.accessToken); return
							}
						}
						resolve(null)
					}
				} catch (e) { resolve(null) }
			}
		})
	} catch (e) { return null }
})()`

export interface CdpLoginResult {
	token: string
	/** True when we launched (and then closed) a dedicated Chrome just for
	 *  login; false when we attached to an already-running browser and only
	 *  closed the tab we opened. */
	closedBrowser: boolean
}

export interface LocalDashboardBrowser {
	mode: 'dedicated' | 'attach'
	port: number
}

/**
 * Accept only the two loopback Chrome modes used for legacy dashboard login.
 * Config files are user-editable, so validate at runtime rather than trusting
 * the TypeScript shape. Remote Builder, container, custom-CDP, and URL inputs
 * are deliberately unsupported here.
 */
export function localDashboardBrowser(value: unknown): LocalDashboardBrowser {
	if(!value || typeof value !== 'object') {
		return { mode: 'dedicated', port: 9222 }
	}

	const mode = Reflect.get(value, 'attachMode')
	const port = Reflect.get(value, 'port')
	if((mode === 'dedicated' || mode === 'attach')
		&& Number.isInteger(port) && Number(port) > 0 && Number(port) <= 65_535) {
		return { mode, port: Number(port) }
	}

	return { mode: 'dedicated', port: 9222 }
}

/**
 * Open the dashboard login page in a local Chrome via loopback CDP, wait for
 * the developer to finish signing in, read the resulting Firebase ID token
 * from page storage, then clean up. This never uses a Builder, container,
 * custom-CDP, or shared browser. If we launch a dedicated Chrome, we close the
 * whole browser afterward; if we attach to an existing local Chrome, we close
 * only the tab we opened.
 */
export async function captureFirebaseTokenViaCdp(opts: {
	loginUrl?: string
	timeoutMs?: number
	pollMs?: number
}): Promise<CdpLoginResult> {
	const loginUrl =
		opts.loginUrl || oldLoginUrl() || DEFAULT_LOGIN_URL
	// 6 minutes, not 3. On a FRESH Chrome profile the dashboard is a cold load
	// of an ~8.6 MB uncompressed bundle before the login form is even
	// interactive — tens of seconds on a slow link — and only then does the
	// developer start typing credentials and a 2FA code. The old 3-minute
	// budget was routinely spent before they could finish, and the retry that
	// followed looked like a 6-minute hang with no output.
	const timeoutMs = opts.timeoutMs ?? 360_000
	const pollMs = opts.pollMs ?? 1000

	const { mode, port } = localDashboardBrowser(
		new ConfigStore().read()?.browser_agent,
	)

	// Ensure something is answering CDP. In dedicated mode we may launch it.
	let launchedByUs = false
	try {
		await waitForCdpReady(port, 500)
	} catch{
		if(mode !== 'dedicated') {
			throw new Error(
				`local attach mode: nothing answering CDP on port ${port}. ` +
				'Launch Chrome ' +
				`with --remote-debugging-port=${port} AND a non-default ` +
				'--user-data-dir, or use the dedicated local login mode.',
			)
		}

		await launchLocalBrowser({ port, profileDir: defaultProfileDir() })
		launchedByUs = true
	}

	const handles = await connectCdp(port)
	const { Target } = handles.browser
	const { targetId } = await Target.createTarget({ url: loginUrl })

	try {
		const session = await handles.attachToTab(targetId)
		const deadline = Date.now() + timeoutMs
		// Tracks how far the page got, so a timeout can say WHICH thing stalled:
		// a bundle that never finished downloading is a different problem from a
		// developer who walked away mid-sign-in.
		let sawInteractivePage = false
		while(Date.now() < deadline) {
			const result = await session.send('Runtime.evaluate', {
				expression: EXTRACT_TOKEN_JS,
				awaitPromise: true,
				returnByValue: true,
			})
			const value = runtimeResultValue(result)
			if(typeof value === 'string' && value.length > 0) {
				return { token: value, closedBrowser: launchedByUs }
			}

			if(!sawInteractivePage) {
				sawInteractivePage = await pageIsInteractive(session)
			}

			await new Promise((resolve) => setTimeout(resolve, pollMs))
		}

		const waited = Math.round(timeoutMs / 1000)
		throw new Error(
			`Timed out after ${waited}s waiting for login. `
			+ (sawInteractivePage
				? 'The page finished loading, so sign-in was never completed — '
					+ 'ask the developer to finish signing in at the opened window, '
					+ 'then re-run reclaim_authenticate.'
				: 'The page never became interactive, so the dashboard was still '
					+ 'loading the whole time. On a fresh Chrome profile its bundle '
					+ 'is a large cold download. Retry (the profile is now warm), or '
					+ 'pass a bigger timeoutMs.'),
		)
	} finally {
		// Best-effort cleanup — never mask the real result/error.
		try {
			if(launchedByUs) {
				await handles.browser.Browser.close()
			} else {
				await handles.browser.Target.closeTarget({ targetId })
			}
		} catch{
			// ignore
		}

		await handles.close().catch(() => {})
	}
}

/**
 * Whether the login page has reached a usable state. `readyState` alone is not
 * enough for a single-bundle SPA: the document is 'complete' while the app is
 * still parsing, and nothing is clickable yet. Requiring a rendered root as
 * well is what distinguishes "still loading" from "waiting for the human".
 */
async function pageIsInteractive(
	session: { send: (m: string, p?: object) => Promise<unknown> },
): Promise<boolean> {
	try {
		const result = await session.send('Runtime.evaluate', {
			expression:
				'document.readyState === "complete" '
				+ '&& !!document.body && document.body.innerText.trim().length > 0',
			returnByValue: true,
		})
		return runtimeResultValue(result) === true
	} catch{
		return false
	}
}

function runtimeResultValue(value: unknown): unknown {
	if(typeof value !== 'object' || !value || !('result' in value)) {
		return undefined
	}

	const result = value.result
	return typeof result === 'object' && result && 'value' in result
		? result.value
		: undefined
}
