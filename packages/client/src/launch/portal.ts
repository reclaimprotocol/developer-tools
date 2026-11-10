/**
 * The `new-tab`/`iframe` mechanisms shared by the `builder` and `portals`
 * targets. Ported from the reference JS SDK's `openPortalTab`/
 * `embedPortalIframe` (`Reclaim.ts` ~1159/~1191).
 */
import type {
	LaunchContainer,
	LaunchElement,
	LaunchEnvironment,
	LaunchWindowHandle
} from './environment.ts'

export interface PortalTabHandle {
	tab: LaunchWindowHandle | null
	close(): void
}

/**
 * Opens `url` in a new tab. Popup blockers kill a `window.open` that happens
 * after a network round trip, so a caller that already opened
 * `window.open('about:blank')` synchronously inside the click handler passes
 * it as `preOpenedTab` — this just navigates it, preserving the user
 * gesture. Falls back to opening fresh (and recovers if the pre-opened tab
 * never actually navigated, e.g. a blocker allowed the open but not the
 * navigation) exactly as the reference SDK does.
 */
export function openPortalTab(
	env: LaunchEnvironment,
	url: string,
	preOpenedTab?: LaunchWindowHandle | null,
): PortalTabHandle {
	// Matches the reference SDK exactly: the fresh path also opens
	// `about:blank` first rather than the real URL directly, so the recovery
	// check below (which looks for a tab stuck at `about:blank`) applies
	// uniformly to both paths.
	const tab = preOpenedTab ?? env.open('about:blank', '_blank')
	if(!tab) {
		return { tab: null, close() {} }
	}

	tab.navigate(url)

	// Verify navigation actually happened; recover by opening fresh if not.
	const recoveryHandle = env.setTimeout(() => {
		try {
			if(tab.location.href === 'about:blank') {
				tab.close()
				env.open(url, '_blank')
			}
		} catch{
			// Cross-origin after navigation means it worked.
		}
	}, 500)

	return {
		tab,
		close() {
			env.clearTimeout(recoveryHandle)
			try {
				tab.close()
			} catch{
				// Cross-origin — tab may have navigated away.
			}
		},
	}
}

export interface PortalIframeHandle {
	iframe: LaunchElement | undefined
	close(): void
}

/** Embeds `url` inside `container` (`options.target`). Appends
 *  `embedded=true` so the portal skips extension detection, matching the
 *  reference SDK. */
export function embedPortalIframe(
	env: LaunchEnvironment,
	url: string,
	container: LaunchContainer,
): PortalIframeHandle {
	if(!env.document) {
		return { iframe: undefined, close() {} }
	}

	const embedUrl = new URL(url)
	embedUrl.searchParams.set('embedded', 'true')

	const iframe = env.document.createElement('iframe')
	iframe.src = embedUrl.toString()
	iframe.style.width = '100%'
	iframe.style.height = '100%'
	iframe.style.border = 'none'
	iframe.setAttribute('allow', 'clipboard-write')
	iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')

	container.appendChild(iframe)

	return {
		iframe,
		close() {
			iframe.remove()
		},
	}
}
