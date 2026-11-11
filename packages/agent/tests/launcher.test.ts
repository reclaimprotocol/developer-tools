import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
	browserCandidates,
	launchLocalBrowser,
	type LocalBrowserDependencies,
} from '../src/cdp/launcher.ts'

// Fake browsers are small node scripts, so these run the real spawn, stderr
// capture, and CDP polling without a Chrome install or a download.
const POSIX = process.platform !== 'win32'

const launched: ChildProcess[] = []

afterEach(() => {
	for(const child of launched.splice(0)) {
		child.kill('SIGKILL')
	}
})

describe('launchLocalBrowser', { skip: !POSIX }, () => {
	it('launches the first installed browser visibly, with the profile',
		async() => {
			const dir = scratch()
			const chrome = fakeBrowser(dir, 'chrome', 'serve')
			const edge = fakeBrowser(dir, 'edge', 'serve')
			const profileDir = join(dir, 'profile')
			const port = await freePort()
			const browser = track(await launchLocalBrowser(
				{ port, profileDir },
				deps({ findInstalled: () => [chrome, edge] }),
			))

			assert.equal(browser.binary, chrome)
			assert.equal(browser.source, 'installed')
			const args = argsOf(chrome)
			assert.ok(args.includes(`--user-data-dir=${profileDir}`))
			assert.ok(args.includes(`--remote-debugging-port=${port}`))
			assert.equal(args.some((a) => a.startsWith('--headless')), false,
				'the developer signs in, so the window must be visible')
			assert.equal(existsSync(argsFile(edge)), false)
		})

	it('downloads Chrome for Testing when no browser is installed', async() => {
		const dir = scratch()
		const cft = fakeBrowser(dir, 'cft', 'serve')
		let installs = 0
		const browser = track(await launchLocalBrowser(
			{ port: await freePort(), profileDir: join(dir, 'profile') },
			deps({
				findInstalled: () => [],
				installChromeForTesting: async() => {
					installs++
					return { executablePath: cft, downloaded: true }
				},
			}),
		))

		assert.equal(installs, 1)
		assert.equal(browser.source, 'chrome-for-testing')
		assert.equal(browser.downloaded, true)
		assert.match(browser.fallbackReason ?? '', /No Chrome, Chromium, or Edge/)
	})

	it('falls back to Chrome for Testing when the installed browser dies',
		async() => {
			const dir = scratch()
			const chrome = fakeBrowser(dir, 'chrome', 'crash')
			const cft = fakeBrowser(dir, 'cft', 'serve')
			const browser = track(await launchLocalBrowser(
				{ port: await freePort(), profileDir: join(dir, 'profile') },
				deps({
					findInstalled: () => [chrome],
					installChromeForTesting: async() => ({
						executablePath: cft, downloaded: false,
					}),
				}),
			))

			assert.equal(browser.binary, cft)
			assert.match(browser.fallbackReason ?? '', /exited with code 3/)
			assert.match(browser.fallbackReason ?? '', /Missing X server/)
		})

	it('reports the exit code and stderr tail when every browser fails',
		async() => {
			const dir = scratch()
			const chrome = fakeBrowser(dir, 'chrome', 'crash')
			const cft = fakeBrowser(dir, 'cft', 'crash')
			await assert.rejects(
				launchLocalBrowser(
					{ port: await freePort(), profileDir: join(dir, 'profile') },
					deps({
						findInstalled: () => [chrome],
						installChromeForTesting: async() => ({
							executablePath: cft, downloaded: false,
						}),
					}),
				),
				(err: Error) => {
					assert.match(err.message, new RegExp(`${chrome}.*code 3`))
					assert.match(err.message, /Chrome for Testing .* also failed/)
					assert.match(err.message, /Browser stderr .*\n.*Missing X server/)
					return true
				},
			)
		})

	it('says when a browser never answers CDP', async() => {
		const dir = scratch()
		const chrome = fakeBrowser(dir, 'chrome', 'hang')
		await assert.rejects(
			launchLocalBrowser(
				{
					port: await freePort(),
					profileDir: join(dir, 'profile'),
					timeoutMs: 800,
				},
				deps({
					findInstalled: () => [chrome],
					installChromeForTesting: async() => {
						throw new Error('offline')
					},
				}),
			),
			(err: Error) => {
				assert.match(err.message, /did not answer CDP .* within 800ms/)
				assert.match(err.message, /still starting up/)
				assert.match(err.message, /could not be installed.*offline/)
				return true
			},
		)
	})

	it('fails fast without a display, before any launch or download',
		async() => {
			const dir = scratch()
			const chrome = fakeBrowser(dir, 'chrome', 'serve')
			let installs = 0
			await assert.rejects(
				launchLocalBrowser(
					{ port: await freePort(), profileDir: join(dir, 'profile') },
					deps({
						platform: () => 'linux',
						env: () => ({}),
						findInstalled: () => [chrome],
						installChromeForTesting: async() => {
							installs++
							return { executablePath: chrome, downloaded: true }
						},
					}),
				),
				/neither WAYLAND_DISPLAY nor DISPLAY/,
			)
			assert.equal(installs, 0)
			assert.equal(existsSync(argsFile(chrome)), false)
		})

	it('launches on Linux when a Wayland display is set', async() => {
		const dir = scratch()
		const chrome = fakeBrowser(dir, 'chrome', 'serve')
		const browser = track(await launchLocalBrowser(
			{ port: await freePort(), profileDir: join(dir, 'profile') },
			deps({
				platform: () => 'linux',
				env: () => ({ WAYLAND_DISPLAY: 'wayland-0' }),
				findInstalled: () => [chrome],
			}),
		))
		assert.equal(browser.binary, chrome)
	})

	it('clears a dead browser\'s profile lock before launching', async() => {
		const dir = scratch()
		const chrome = fakeBrowser(dir, 'chrome', 'serve')
		const profileDir = join(dir, 'profile')
		mkdirSync(profileDir)
		// What a crashed Chrome leaves: links to a PID that no longer runs.
		symlinkSync(`${hostname()}-${deadPid()}`, join(profileDir, 'SingletonLock'))
		symlinkSync('/nonexistent/SingletonSocket',
			join(profileDir, 'SingletonSocket'))
		symlinkSync('1234567890', join(profileDir, 'SingletonCookie'))

		track(await launchLocalBrowser({ port: await freePort(), profileDir },
			deps({ findInstalled: () => [chrome] })))

		for(const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
			assert.equal(isLink(join(profileDir, name)), false, `${name} removed`)
		}
	})

	it('refuses a profile a running browser still holds', async() => {
		const dir = scratch()
		const chrome = fakeBrowser(dir, 'chrome', 'serve')
		const profileDir = join(dir, 'profile')
		mkdirSync(profileDir)
		symlinkSync(`${hostname()}-${process.pid}`,
			join(profileDir, 'SingletonLock'))

		await assert.rejects(
			launchLocalBrowser({ port: await freePort(), profileDir },
				deps({ findInstalled: () => [chrome] })),
			new RegExp(`in use by a running browser \\(PID ${process.pid}\\)`),
		)
		assert.equal(isLink(join(profileDir, 'SingletonLock')), true)
		assert.equal(existsSync(argsFile(chrome)), false)
	})
})

describe('browserCandidates', () => {
	it('prefers Chrome, then Chromium, then Edge on every platform', () => {
		for(const os of ['darwin', 'linux', 'win32'] as const) {
			const candidates = browserCandidates(os).map((c) => c.toLowerCase())
			const firstIndex = (needle: string) => candidates
				.findIndex((c) => c.includes(needle))
			const chrome = firstIndex('chrome')
			const chromium = firstIndex('chromium')
			const edge = firstIndex('edge')
			assert.equal(chrome, 0, `${os}: Chrome first`)
			assert.ok(edge > chrome, `${os}: Edge after Chrome`)
			if(chromium >= 0) {
				assert.ok(chromium > chrome && chromium < edge,
					`${os}: Chromium between Chrome and Edge`)
			}
		}
	})
})

/** Deterministic defaults: a desktop with a display, no override, no
 *  installed browser, and an installer that must not be reached. */
function deps(
	overrides: Partial<LocalBrowserDependencies>,
): Partial<LocalBrowserDependencies> {
	return {
		platform: () => 'darwin',
		env: () => ({}),
		chromePath: () => undefined,
		findInstalled: () => [],
		installChromeForTesting: async() => {
			throw new Error('installer must not run in this test')
		},
		...overrides,
	}
}

function track<T extends { process: ChildProcess }>(browser: T) {
	launched.push(browser.process)
	return browser
}

function scratch() {
	return mkdtempSync(join(tmpdir(), 'reclaim-launcher-'))
}

/**
 * A stand-in browser. `serve` answers `/json/version` on the debugging port
 * like Chrome; `crash` writes to stderr and exits 3; `hang` writes to stderr
 * and never answers. Each records its argv so tests can assert how it was
 * launched.
 */
function fakeBrowser(
	dir: string,
	name: string,
	behavior: 'serve' | 'crash' | 'hang',
) {
	const path = join(dir, name)
	writeFileSync(path, `#!/usr/bin/env node
const { writeFileSync } = require('node:fs')
const { createServer } = require('node:http')
const args = process.argv.slice(2)
writeFileSync(process.argv[1] + '.args.json', JSON.stringify(args))
const behavior = ${JSON.stringify(behavior)}
if (behavior === 'crash') {
	process.stderr.write('[0101/000000.000:ERROR:ozone_platform_x11.cc] '
		+ 'Missing X server or $DISPLAY\\n')
	process.exit(3)
}
if (behavior === 'hang') {
	process.stderr.write('still starting up\\n')
	setInterval(() => {}, 1000)
} else {
	const flag = args.find((a) => a.startsWith('--remote-debugging-port='))
	createServer((req, res) => res.end('{}'))
		.listen(Number(flag.split('=')[1]), '127.0.0.1')
}
`)
	chmodSync(path, 0o755)
	return path
}

function argsFile(binary: string) {
	return `${binary}.args.json`
}

function argsOf(binary: string): string[] {
	return JSON.parse(readFileSync(argsFile(binary), 'utf8'))
}

function isLink(path: string) {
	try {
		return lstatSync(path).isSymbolicLink()
	} catch{
		return false
	}
}

/** A PID with no process behind it. */
function deadPid() {
	for(let pid = 4_000_000; ; pid++) {
		try {
			process.kill(pid, 0)
		} catch(err) {
			if(err instanceof Error && 'code' in err && err.code === 'ESRCH') {
				return pid
			}
		}
	}
}

async function freePort() {
	const server = createServer()
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
	const address = server.address()
	assert(address && typeof address === 'object')
	await new Promise<void>((r) => server.close(() => r()))
	return address.port
}
