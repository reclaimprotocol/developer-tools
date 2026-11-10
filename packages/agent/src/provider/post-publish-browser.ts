interface AttachedBrowser {
	mode: string
	browserSessionId?: string
}

interface BrowserRetestOptions {
	initialUrl: string
	hasUserScript: boolean
	hasInterceptor: boolean
}

/** Advisory follow-up when a browser remains after provider creation. */
export function postPublishBrowserNotes(
	attached: AttachedBrowser | undefined,
	options: BrowserRetestOptions,
): string[] {
	if(!attached) {
		return []
	}

	const identity = `A "${attached.mode}" browser session is still attached`
		+ (attached.browserSessionId
			? ` (browserSessionId: ${attached.browserSessionId})`
			: '')
	const retest = 'Before disposing it, best-effort test the '
		+ 'already-authenticated path only when this profile is still signed in: '
		+ `navigate to initialUrl (${options.initialUrl}) without clearing cookies `
		+ 'or forcing another login. '
		+ (options.hasUserScript
			? 'Use test_user_script with this version\'s script and initialUrl; '
			: 'Navigate to initialUrl normally; ')
		+ 'confirm every required target request still fires, then replay and '
		+ 'prove each one when the existing capture has enough data. Check that '
		+ 'the flow handles '
		+ 'both a fresh sign-in and an already-signed-in landing from current page '
		+ 'state, not only a login transition. This is advisory: skip it when no '
		+ 'authenticated state is available. An inconclusive result must not block '
		+ 'disposal or trigger a republish.'
	const interceptor = options.hasInterceptor
		? 'The attached authoring browser validates page behavior and the user '
			+ 'script, but it does not prove compatibility with an in-page '
			+ 'production interceptor. '
			+ 'For the InApp SDK, verifier app, or browser extension, keep any '
			+ 'client-specific interceptor verification as a separate follow-up.'
		: undefined
	const dispose = 'Ask the developer whether they want to keep the browser '
		+ 'open '
		+ 'for this retest or further edits. Only call dispose_browser after they '
		+ 'confirm they are done.'

	return [
		identity + '. ' + retest,
		...(interceptor ? [interceptor] : []),
		dispose,
	]
}
