export type ToolEntry = {
	handler: <T, V>(
		args: T,
		ctx?: V,
	) => Promise<{
		content: { type: string, text: string }[]
		isError?: boolean
	}>
}

export type PrivateServer = {
	_registeredTools: Record<string, ToolEntry>
}
