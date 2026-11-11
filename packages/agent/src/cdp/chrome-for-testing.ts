import { failedDependency } from '@hapi/boom'
import assert from 'node:assert'
import { existsSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { join } from 'node:path'
import { LOGGER } from '../logger.ts'
import { reclaimHomeDirPath } from '../paths.ts'

export interface ChromeForTestingInstall {
	executablePath: string
	/** True when this call downloaded it; false when an earlier one had. */
	downloaded: boolean
}

/** Where downloaded browsers live: `~/.reclaim/browsers`. */
export function browsersDirPath() {
	return join(reclaimHomeDirPath(), 'browsers')
}

/**
 * Chrome for Testing, the fallback when no local Chromium-family browser is
 * installed or the installed one will not start. Downloaded once into
 * `~/.reclaim/browsers` and reused after that, so only the first fallback pays
 * the ~150 MB download.
 */
export async function installChromeForTesting(
	cacheDir = browsersDirPath(),
): Promise<ChromeForTestingInstall> {
	// Loaded on demand: only the fallback path needs it.
	const {
		Browser,
		detectBrowserPlatform,
		getInstalledBrowsers,
		getVersionComparator,
		install,
		resolveBuildId,
	} = await import('@puppeteer/browsers')
	const browserPlatform = detectBrowserPlatform()
	assert(browserPlatform, failedDependency(
		`Chrome for Testing has no build for ${platform()}/${arch()}.`,
	))

	const compare = getVersionComparator(Browser.CHROME)
	const all = await getInstalledBrowsers({ cacheDir })
	const installed = all
		.filter((b) => b.browser === Browser.CHROME
			&& b.platform === browserPlatform
			&& existsSync(b.executablePath))
		.sort((a, b) => compare(a.buildId, b.buildId))
	const newest = installed.at(-1)
	if(newest) {
		return { executablePath: newest.executablePath, downloaded: false }
	}

	const buildId = await resolveBuildId(
		Browser.CHROME, browserPlatform, 'stable',
	)
	LOGGER.info({ buildId, cacheDir }, 'downloading Chrome for Testing')
	const result = await install({
		browser: Browser.CHROME,
		platform: browserPlatform,
		buildId,
		cacheDir,
	})
	return { executablePath: result.executablePath, downloaded: true }
}
