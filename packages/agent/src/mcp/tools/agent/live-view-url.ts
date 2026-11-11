const LIVE_VIEW_PATH = 'liveview.html'

/** Add the browser runtime's viewer route and magnification when absent. */
export function ensureLiveViewUrl(value: string): string {
	const url = new URL(value)
	const pathname = url.pathname.replace(/\/+$/, '')
	if(!pathname.toLowerCase().endsWith(`/${LIVE_VIEW_PATH}`)) {
		url.pathname = `${pathname}/${LIVE_VIEW_PATH}`
	}

	url.searchParams.set('magnify', '1')
	return url.toString()
}
