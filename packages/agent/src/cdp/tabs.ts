export interface TabInfo {
	tabId: string
	url: string
	title: string
}

export async function listTabs(port: number): Promise<TabInfo[]> {
	const res = await fetch(`http://127.0.0.1:${port}/json/list`)
	if(!res.ok) {
		throw new Error(`CDP /json/list returned ${res.status}`)
	}

	const targets = (await res.json()) as Array<{
		type: string
		id: string
		url: string
		title: string
	}>
	return targets
		.filter((t) => t.type === 'page')
		.map((t) => ({ tabId: t.id, url: t.url, title: t.title }))
}
