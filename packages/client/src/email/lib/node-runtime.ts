/* eslint-disable @stylistic/max-len */
export const MIN_NODE_VERSION = '22.19.0'

export function isSupportedNodeVersion(
	version = process.versions.node,
): boolean {
	const parts = version.split('.').map(Number)
	if(
		parts.length !== 3 ||
		parts.some((part) => !Number.isInteger(part) || part < 0)
	) {
		return false
	}

	const [major, minor] = parts
	return major > 22 || (major === 22 && minor >= 19)
}

export function assertSupportedNodeVersion(version = process.versions.node) {
	if(!isSupportedNodeVersion(version)) {
		throw new Error(
			`Node.js ${version} is unsupported. This application requires Node.js ${MIN_NODE_VERSION} or newer. Run nvm install and nvm use in the project, then restart the server.`,
		)
	}
}
