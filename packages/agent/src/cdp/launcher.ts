import {
	conflict,
	failedDependency,
	gatewayTimeout,
	preconditionFailed,
} from '@hapi/boom'
import assert from 'node:assert'
import { type ChildProcess, spawn } from 'node:child_process'
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readlinkSync,
	unlinkSync
} from 'node:fs'
import { homedir, hostname, platform } from 'node:os'
import { join } from 'node:path'
import { chromePath, localAppData } from '../consts.ts'
import { LOGGER } from '../logger.ts'
import { reclaimHomeDirPath } from '../paths.ts'
import { installChromeForTesting } from './chrome-for-testing.ts'

/** How long a launched browser gets to answer CDP. A cold first start on a
 *  slow disk, or Chrome for Testing's first run, can take well over 10s. */
export const CDP_READY_TIMEOUT_MS = 30_000

/** How much of the browser's stderr to keep for error messages. */
const STDERR_TAIL_CHARS = 4096

/** The files Chrome uses on POSIX to claim a profile. `SingletonLock` is a
 *  symlink to `<hostname>-<pid>`; the other two point at the IPC socket and a
 *  random cookie, and are only meaningful while that process lives. */
const SINGLETON_FILES = ['SingletonLock', 'SingletonSocket', 'SingletonCookie']

export interface LaunchOptions {
	/** Port for --remote-debugging-port. */
	port: number
	/** Path to user-data-dir. Created if missing. */
	profileDir: string
	/** If true, launch without a visible window (--headless=new). Useful
	 *  for tests and CI; user-driven flows want it false. */
	headless?: boolean
	/** How long to wait for CDP to answer. */
	timeoutMs?: number
}

export type LocalBrowserSource = 'installed' | 'override' | 'chrome-for-testing'

export interface LocalBrowser {
	binary: string
	source: LocalBrowserSource
	process: ChildProcess
	/** Chrome for Testing was downloaded by this launch. */
	downloaded: boolean
	/** Why the installed browser was passed over for Chrome for Testing. */
	fallbackReason?: string
}

export interface LocalBrowserDependencies {
	platform: () => NodeJS.Platform
	env: () => NodeJS.ProcessEnv
	/** Explicit binary override (`RECLAIM_AGENT_CHROME_PATH`). */
	chromePath: () => string | undefined
	/** Installed Chromium-family browsers, most preferred first. */
	findInstalled: () => string[]
	installChromeForTesting: typeof installChromeForTesting
}

const DEFAULT_DEPENDENCIES: LocalBrowserDependencies = {
	platform,
	env: () => process.env,
	chromePath,
	findInstalled: () => findInstalledBrowsers(),
	installChromeForTesting,
}

/**
 * Build the platform-specific list of Chromium-family binaries to probe.
 * Order matters: Chrome first, then Chromium, then Edge (Edge is
 * Chromium-based, supports CDP, and is preinstalled on Win 10/11 — a
 * useful fallback when Chrome itself isn't installed).
 *
 * On Windows we also probe the per-user Chrome install under
 * %LOCALAPPDATA%, which is what you get when Chrome was installed
 * without admin rights ("Install for me only"). Skipping this was the
 * #1 first-run failure observed in the field.
 */
export function browserCandidates(os = platform()): string[] {
	switch (os) {
		case 'darwin':
			return [
				'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
				join(
					homedir(),
					'Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
				),
				'/Applications/Chromium.app/Contents/MacOS/Chromium',
				'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
			]
		case 'win32': {
			const appData =
				localAppData() ?? join(homedir(), 'AppData', 'Local')
			return [
			// System-wide Chrome
				'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
				'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
				// Per-user Chrome ("Install for me only")
				join(appData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
				// Edge — Chromium-based, preinstalled on Win 10/11
				'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
				'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
			]
		}

		case 'linux':
			return [
				'/usr/bin/google-chrome',
				'/usr/bin/google-chrome-stable',
				'/usr/bin/chromium',
				'/usr/bin/chromium-browser',
				'/snap/bin/chromium',
				'/usr/bin/microsoft-edge',
			]
		default:
			return []
	}
}

/** The candidates that exist on this machine, in preference order. */
export function findInstalledBrowsers(candidates = browserCandidates()) {
	return candidates.filter((c) => existsSync(c))
}

export function defaultProfileDir(): string {
	return join(reclaimHomeDirPath(), 'chrome-profile')
}

export function findChromeBinary(): string {
	const candidates = browserCandidates()
	const found = chromePath() ?? findInstalledBrowsers(candidates)[0]
	if(found) {
		return found
	}

	throw new Error(
		`No Chromium-family browser found on ${platform()}. Tried:\n  ` +
			candidates.join('\n  ') +
		'\nSet RECLAIM_AGENT_CHROME_PATH to point at ' +
		'your chrome.exe / msedge.exe / chromium binary.',
	)
}

/**
 * Why a visible browser cannot open here, or undefined when it can. Only
 * Linux needs a display server named in the environment; an MCP server
 * started outside the desktop session (a sandboxed agent, a service) often
 * has neither variable, and Chrome then exits before CDP ever answers.
 */
export function missingDisplayReason(
	os: NodeJS.Platform = platform(),
	env: NodeJS.ProcessEnv = process.env,
) {
	if(os !== 'linux' || env.WAYLAND_DISPLAY || env.DISPLAY) {
		return undefined
	}

	return 'No display: neither WAYLAND_DISPLAY nor DISPLAY is set in the '
		+ 'Reclaim MCP server\'s environment, so a visible browser cannot open. '
		+ 'Start the agent from the desktop session, or pass the variables to '
		+ 'the MCP server (for example DISPLAY=:0, or WAYLAND_DISPLAY=wayland-0 '
		+ 'with XDG_RUNTIME_DIR), then restart the agent.'
}

/**
 * Launch a visible browser on this machine with the given profile, and wait
 * until it answers CDP.
 *
 * Uses `RECLAIM_AGENT_CHROME_PATH` when set, else the first installed browser
 * (Chrome, then Chromium, then Edge). When none is installed, or that one
 * fails to start, it falls back to Chrome for Testing, downloaded once into
 * `~/.reclaim/browsers`. A missing display fails fast instead: no browser can
 * open without one, so a download would only waste time.
 */
export async function launchLocalBrowser(
	opts: LaunchOptions,
	dependencies: Partial<LocalBrowserDependencies> = {},
): Promise<LocalBrowser> {
	const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies }
	const noDisplay = missingDisplayReason(deps.platform(), deps.env())
	assert(!noDisplay, preconditionFailed(noDisplay))

	// A live owner would make every launch below fail the same way, so refuse
	// once with the reason instead of trying Chrome for Testing too.
	releaseStaleProfileLock(opts.profileDir, deps.platform())

	const override = deps.chromePath()
	const preferred = override ?? deps.findInstalled()[0]
	let fallbackReason = 'No Chrome, Chromium, or Edge is installed.'
	if(preferred) {
		try {
			return {
				binary: preferred,
				source: override ? 'override' : 'installed',
				process: await startChrome(preferred, opts),
				downloaded: false,
			}
		} catch(err) {
			fallbackReason = errorMessage(err)
			LOGGER.warn({ binary: preferred, reason: fallbackReason },
				'local browser failed to start; trying Chrome for Testing')
		}
	}

	let cft: Awaited<ReturnType<typeof installChromeForTesting>>
	try {
		cft = await deps.installChromeForTesting()
	} catch(err) {
		throw failedDependency(
			`${fallbackReason}\nChrome for Testing could not be installed into `
			+ `~/.reclaim/browsers: ${errorMessage(err)}`,
		)
	}

	try {
		return {
			binary: cft.executablePath,
			source: 'chrome-for-testing',
			process: await startChrome(cft.executablePath, opts),
			downloaded: cft.downloaded,
			fallbackReason,
		}
	} catch(err) {
		throw failedDependency(
			`${fallbackReason}\nChrome for Testing (${cft.executablePath}) also `
			+ `failed: ${errorMessage(err)}`,
		)
	}
}

/**
 * Spawn `binary` on `opts.profileDir` and wait for CDP. On failure the
 * process is stopped and the error says why: it could not be spawned, it
 * exited (with its code and the tail of its stderr), or it never answered.
 */
export async function startChrome(
	binary: string,
	opts: LaunchOptions,
): Promise<ChildProcess> {
	const timeoutMs = opts.timeoutMs ?? CDP_READY_TIMEOUT_MS
	mkdirSync(opts.profileDir, { recursive: true })
	releaseStaleProfileLock(opts.profileDir)

	const args = [
		`--remote-debugging-port=${opts.port}`,
		`--user-data-dir=${opts.profileDir}`,
		'--no-first-run',
		'--no-default-browser-check',
	]
	if(opts.headless) {
		args.push('--headless=new', '--disable-gpu')
	}

	const child = spawn(binary, args, {
		stdio: ['ignore', 'ignore', 'pipe'],
		detached: false,
	})
	// Drained for the browser's whole life, not just until it is ready: a
	// full pipe would block its writes.
	let stderr = ''
	child.stderr?.setEncoding('utf8')
	child.stderr?.on('data', (chunk: string) => {
		stderr = (stderr + chunk).slice(-STDERR_TAIL_CHARS)
	})
	let spawnError: Error | undefined
	child.once('error', (err) => {
		spawnError = err
	})

	const deadline = Date.now() + timeoutMs
	while(Date.now() < deadline) {
		if(await cdpAnswers(opts.port)) {
			return child
		}

		if(spawnError) {
			throw failedDependency(
				`Could not start ${binary}: ${spawnError.message}`,
			)
		}

		if(child.exitCode !== null || child.signalCode !== null) {
			throw failedDependency(
				`${binary} exited with ${child.exitCode !== null
					? `code ${child.exitCode}`
					: `signal ${child.signalCode}`} before CDP answered on port `
				+ `${opts.port}.${stderrTail()}`,
			)
		}

		await sleep(150)
	}

	await stopProcess(child)
	throw gatewayTimeout(
		`${binary} did not answer CDP on port ${opts.port} within `
		+ `${timeoutMs}ms.${stderrTail()}`,
	)

	function stderrTail() {
		const tail = stderr.trim()
		return tail ? `\nBrowser stderr (last ${tail.length} chars):\n${tail}` : ''
	}
}

/**
 * Remove a dead browser's claim on `profileDir` so a new launch can take it.
 *
 * Chrome on POSIX claims a profile with `SingletonLock -> <hostname>-<pid>`.
 * If that process is gone (a crash, a killed session) the links stay behind
 * and the next launch hands off to the missing owner and exits. A lock whose
 * PID is alive on this host belongs to a running browser, and is left alone:
 * that browser must be closed first. A lock from another hostname is treated
 * as stale: `~/.reclaim` is local, and a sandbox or container that changes the
 * hostname between runs is the usual way to get one. Callers reach this only
 * after nothing answered CDP on the port.
 */
export function releaseStaleProfileLock(
	profileDir: string,
	os: NodeJS.Platform = platform(),
) {
	// Windows locks the profile with a plain file the OS releases on exit.
	if(os === 'win32') {
		return
	}

	const target = readLink(join(profileDir, 'SingletonLock'))
	const owner = target?.match(/^(.+)-(\d+)$/)
	if(owner?.[1] === hostname() && processAlive(Number(owner[2]))) {
		throw conflict(
			`The browser profile ${profileDir} is in use by a running browser `
			+ `(PID ${owner[2]}) that is not answering CDP on the requested port. `
			+ 'Close that browser window, then retry.',
		)
	}

	const removed = SINGLETON_FILES.filter((name) => {
		const path = join(profileDir, name)
		if(readLink(path) === undefined) {
			return false
		}

		try {
			unlinkSync(path)
			return true
		} catch(err) {
			LOGGER.warn({ err, path }, 'could not remove a stale profile lock')
			return false
		}
	})
	if(removed.length) {
		LOGGER.info({ profileDir, removed, owner: target },
			'removed a stale browser profile lock')
	}
}

/**
 * Wait until something answers CDP on `port`, polling every 150ms.
 */
export async function waitForCdpReady(
	port: number,
	timeoutMs = CDP_READY_TIMEOUT_MS,
) {
	const deadline = Date.now() + timeoutMs
	while(Date.now() < deadline) {
		if(await cdpAnswers(port)) {
			return
		}

		await sleep(150)
	}

	throw gatewayTimeout(
		`Chrome CDP did not become ready on port ${port} within ${timeoutMs}ms`,
	)
}

/** A listener that accepts but never answers (a stale non-CDP service on the
 *  port) fails the poll after 2s instead of outliving the launch deadline. */
async function cdpAnswers(port: number) {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
			signal: AbortSignal.timeout(2_000),
		})
		return res.ok
	} catch{
		return false
	}
}

/** SIGTERM, then SIGKILL if it lingers, and wait for the exit either way, so
 *  the profile lock is released before anything launches on it again. */
async function stopProcess(child: ChildProcess) {
	if(child.exitCode !== null || child.signalCode !== null) {
		return
	}

	const exited = new Promise<void>((r) => child.once('exit', () => r()))
	child.kill('SIGTERM')
	const timer = setTimeout(() => child.kill('SIGKILL'), 3_000)
	await exited
	clearTimeout(timer)
}

function readLink(path: string) {
	try {
		return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : undefined
	} catch{
		return undefined
	}
}

function processAlive(pid: number) {
	try {
		process.kill(pid, 0)
		return true
	} catch(err) {
		// EPERM: it exists, it just belongs to someone else.
		return err instanceof Error && 'code' in err && err.code === 'EPERM'
	}
}

function errorMessage(err: unknown) {
	return err instanceof Error ? err.message : String(err)
}

function sleep(ms: number) {
	return new Promise<void>((r) => setTimeout(r, ms))
}
