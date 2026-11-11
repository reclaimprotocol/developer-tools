/**
 * Run the Reclaim browser runtime in a container.
 *
 * This is the same image Popcorn serves for `builder` mode, run on the
 * developer's own Docker instead of on quota. It brings its own Chromium and
 * its own live view — a real VNC viewer with an IME, gesture handling and an
 * OS-level pointer path — so nothing here renders anything. It starts the
 * container, waits for it to mean it, and hands back the two URLs.
 *
 * Three ports exist inside; we publish two, and the distinction matters:
 *
 *  - **6080, the viewer.** Safe to put behind a tunnel, which is what
 *    `share_browser_view` does.
 *  - **9226, full CDP.** Unfiltered, unauthenticated browser control. Bound to
 *    loopback and NEVER tunnelled: upstream's own warning is that exposing it
 *    "would hand anyone control of the browser".
 *  - **9222, restricted CDP.** Not published at all. Its allowlist is 19
 *    methods with no `Runtime.*` and no `Network.*`, so it cannot drive the
 *    authoring loop — verified against a running container.
 */
import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { LOGGER } from '../logger.ts'
import { reclaimHomeDirPath } from '../paths.ts'
import {
	busySlots,
	claim,
	ownSlots,
	processAlive,
	release,
} from './claims.ts'

const execFileAsync = promisify(execFile)

/**
 * The pinned runtime image.
 *
 * A digest, not a tag. Upstream publishes 40-char git SHAs plus moving
 * `main`/`latest` aliases and no semver at all, and its own docs say to
 * "prefer immutable digests". Pinning one means an agent release cannot have
 * the browser changed underneath it.
 *
 * Digest of `latest` as of 2026-08-22, built from popcorn-oss
 * `4df751c25c7b329699033957b93f6486837e4acb`.
 */
export const BROWSER_RUNTIME_IMAGE =
	'ghcr.io/reclaimprotocol/popcorn-oss/browser-runtime'
	+ '@sha256:6858c30a37886bc30d8f658e31aeb0bb253ad22eece16e4e41c8883345b399e1'

/**
 * The image is amd64-only and cannot be otherwise: the browser is Tilion
 * Fortress, pinned by digest upstream, and Fortress publishes no arm64
 * manifest. On Apple Silicon it therefore runs translated — which works under
 * Docker Desktop's Rosetta and OrbStack, and crashes under QEMU. Pinning the
 * platform is what stops Docker quietly trying to find an arm64 variant that
 * does not exist.
 */
const PLATFORM = 'linux/amd64'

/** Ports inside the container. */
const VIEWER_PORT = 6080
const CDP_PORT = 9226

/**
 * How many browsers may run at once.
 *
 * Each is about 2 GB of RAM, so this is a guard against a runaway rather than a
 * capability. Sessions normally SHARE one: a slot is only added when another
 * session is actively holding the previous one.
 */
const MAX_SLOTS = 4

/**
 * Marks a container as ours and records which process owns it.
 *
 * The PID makes orphan cleanup safe. A container outlives its owner whenever a
 * session is killed, so something has to remove it — but never one another
 * session is still using. Whether the owning PID is alive answers that, and
 * errs harmlessly: a recycled PID leaves a container behind rather than killing
 * a live one.
 */
const OWNER_LABEL = 'org.reclaim.agent.owner-pid'

/**
 * Two ports nobody is using, guaranteed different from each other.
 *
 * A fixed port would give concurrent sessions the same container — the name
 * derives from the viewer port — so session two would silently drive session
 * one's browser.
 *
 * Both listeners are held open together and released together. Asking twice in
 * sequence can return the same port, since the first is already closed by the
 * time the second asks, and one port cannot carry both the viewer and CDP.
 *
 * Between releasing a port and Docker publishing it, another process can take
 * it. That race is unavoidable, and losing it fails the `docker run` loudly
 * rather than doing anything silent.
 */
async function freePortPair(): Promise<{ viewer: number, cdp: number }> {
	const servers = [createServer(), createServer()]
	try {
		const ports = await Promise.all(servers.map(async(server) => {
			await new Promise<void>((resolve) => {
				server.listen(0, '127.0.0.1', resolve)
			})
			return (server.address() as AddressInfo).port
		}))
		return { viewer: ports[0], cdp: ports[1] }
	} finally {
		await Promise.all(servers.map((server) => {
			return new Promise<void>((resolve) => server.close(() => resolve()))
		}))
	}
}

/**
 * Readiness deadline. The entrypoint gives Chromium 30s to put a window on the
 * X display before failing, and a cold start measured 6.6s here with the geoip
 * lookup disabled. 90s leaves room for a slow machine without hanging forever.
 */
const READY_TIMEOUT_MS = 90_000
const READY_POLL_MS = 250

export interface ContainerBrowser {
	/** Local viewer origin — what `share_browser_view` tunnels. */
	viewerUrl: string
	/** Browser-level CDP websocket, for `connectCdpUrl`. */
	cdpUrl: string
	/** Loopback port the viewer is published on. */
	viewerPort: number
	/** Docker's name for this container. */
	name: string
	/** Whether the image had to be pulled first — worth telling the developer. */
	pulled: boolean
	/** Which slot this browser occupies, for diagnostics. */
	slot: number
	stop: () => Promise<void>
}

export interface ContainerOptions {
	/** Loopback port for the viewer. Allocated when omitted. */
	viewerPort?: number
	/** Loopback port for full CDP. Allocated when omitted. */
	cdpPort?: number
	/** Override the pinned image, e.g. a local `build.sh` output. */
	image?: string
	/** Framebuffer size, which is also the browser window's size. */
	width?: number
	height?: number
	/** Page to open on start. */
	url?: string
}

/**
 * Where the container's Chromium profile lives on the host.
 *
 * Mounted, unlike the reference dev script, for two reasons. Provider authoring
 * means signing in once and capturing an authenticated request, which a profile
 * that dies with the container makes impossible. And the profile holds the
 * persisted fingerprint identity — canvas/audio seed, timezone, locale — which
 * upstream warns must stay stable, since "flipping any of them against the same
 * cookie jar is itself a bot signal".
 */
export function containerProfileDir(slot = 0): string {
	// Slot 0 keeps the original path, so an existing profile — and the login in
	// it — survives this change. Later slots get their own, because two
	// Chromiums on one `user-data-dir` corrupt it silently.
	const suffix = slot === 0 ? '' : `-${slot}`
	return join(reclaimHomeDirPath(), `browser-runtime-profile${suffix}`)
}

/** Docker CLI present AND its daemon reachable. */
export async function dockerAvailable(): Promise<boolean> {
	try {
		// `--format {{.Server.Version}}` talks to the daemon, so unlike
		// `docker --version` it fails when Docker is installed but not running.
		const { stdout } = await execFileAsync(
			'docker', ['version', '--format', '{{.Server.Version}}'],
			{ timeout: 15_000 },
		)
		return stdout.trim().length > 0
	} catch(err) {
		LOGGER.debug({ err }, 'docker is unavailable')
		return false
	}
}

/** Message for the case we cannot fix for them. */
export function dockerMissingMessage(): string {
	return 'Container mode needs Docker, and its daemon is not reachable. '
		+ 'Install Docker Desktop (https://docs.docker.com/get-started/get-docker/)'
		+ ' or OrbStack and start it, then retry. On Apple Silicon, enable Rosetta '
		+ 'for x86/amd64 emulation — the runtime image is amd64-only. '
		+ 'Or pick another browser: `dedicated` uses local Chrome, and `builder` '
		+ 'is a remote browser that comes with its own hosted live view.'
}

async function imagePresent(image: string): Promise<boolean> {
	try {
		await execFileAsync('docker', ['image', 'inspect', image],
			{ timeout: 20_000 })
		return true
	} catch{
		return false
	}
}

/** Fetch the image. About 432 MB, so `startContainer` reports it happened. */
async function pullImage(image: string): Promise<void> {
	await execFileAsync(
		'docker', ['pull', '--platform', PLATFORM, image],
		{ timeout: 900_000, maxBuffer: 1024 * 1024 * 8 },
	)
}

/**
 * The `docker run` argv.
 *
 * A pure function because every flag here is load bearing and none of it is
 * obvious from the outside: which ports are loopback-only, that the image is
 * digest-pinned, that the profile is mounted. Tests assert on this directly
 * rather than trying to observe a running container.
 */
export function buildRunArgs(
	opts: ContainerOptions & { viewerPort: number, cdpPort: number },
	image: string,
	name: string,
	profileDir: string,
): string[] {
	const args = [
		'run', '--rm', '-d',
		'--name', name,
		'--platform', PLATFORM,
		// Whose container this is, so an orphan can be told from a container
		// another session is still driving.
		'--label', `${OWNER_LABEL}=${process.pid}`,
		// Loopback only. Both CDP proxies listen on 0.0.0.0 INSIDE the container,
		// so what is reachable is entirely down to this mapping.
		'-p', `127.0.0.1:${opts.viewerPort}:${VIEWER_PORT}`,
		'-p', `127.0.0.1:${opts.cdpPort}:${CDP_PORT}`,
		// Chromium on Docker's default 64 MB /dev/shm is a crash waiting for a
		// heavy page. The image README and the upstream Helm chart both give it
		// 1-2 GiB; only the dev script leaves the default.
		'--shm-size=1g',
		// The runtime looks up its own geolocation at boot, twice, with an 8s
		// timeout each — up to 16s added to every cold start. We are not
		// impersonating a locale (that is what `builder` mode's country routing is
		// for), so skip it. Measured: 6.6s to ready with this off.
		'-e', 'CLOAK_GEOIP=false',
		// Cookies, localStorage and the persisted fingerprint identity. Without
		// it, signing in once — the entire point of authoring — cannot survive a
		// restart.
		'-v', `${profileDir}:/home/kernel/user-data`,
	]
	if(opts.width) {
		args.push('-e', `WIDTH=${opts.width}`)
	}

	if(opts.height) {
		args.push('-e', `HEIGHT=${opts.height}`)
	}

	if(opts.url) {
		args.push('-e', `APP_URL=${opts.url}`)
	}

	args.push(image)
	return args
}

/**
 * Start a browser container and wait until it is actually serving.
 *
 * Ports are allocated per call, so concurrent sessions never land on the same
 * container. Pass `viewerPort` to pin one — re-attaching with the same port
 * reuses the container that is already there.
 */
export async function startContainer(
	options: ContainerOptions = {},
): Promise<ContainerBrowser> {
	// Containers whose session died without cleaning up, cleared before we look
	// for one to adopt. Deliberately here rather than at server startup: a
	// short-lived server exits before a fire-and-forget reap finishes, and nobody
	// who never uses container mode should pay for a `docker ps` at launch.
	await reapOrphanedContainers()

	const image = options.image ?? BROWSER_RUNTIME_IMAGE
	const slot = await pickSlot()
	const name = containerName(slot)
	const token = claim(name)

	// Adopt a container that is already serving on this slot. This is the common
	// case for one developer working across sessions: the browser, and whatever
	// they signed into, is still there.
	const adopted = await adopt(name)
	if(adopted) {
		LOGGER.info({ name }, 'adopted the browser container already running')
		return describe(adopted, name, false, slot, token)
	}

	// Anything left under this name is wreckage — the slot has no live claimant.
	if(await inspectContainer(name)) {
		LOGGER.info({ name }, 'removing a container that is no longer serving')
		await execFileAsync('docker', ['rm', '-f', name], { timeout: 60_000 })
			.catch(() => {})
	}

	const ports = await freePortPair()
	const opts = {
		...options,
		viewerPort: options.viewerPort ?? ports.viewer,
		cdpPort: options.cdpPort ?? ports.cdp,
	}
	const profileDir = containerProfileDir(slot)
	mkdirSync(profileDir, { recursive: true })

	const pulled = !await imagePresent(image)
	if(pulled) {
		LOGGER.info({ image }, 'pulling the browser runtime image')
		await pullImage(image)
	}

	await execFileAsync('docker', buildRunArgs(opts, image, name, profileDir),
		{ timeout: 120_000 })
	try {
		await waitUntilServing(opts.cdpPort)
	} catch(err) {
		await captureLogs(name)
		release(name, token)
		await stopContainer(name)
		throw err
	}

	return describe(opts, name, pulled, slot, token)
}

/** `reclaim-browser-0`, `-1`, … — one name per slot, so a slot is findable. */
function containerName(slot: number): string {
	return `reclaim-browser-${slot}`
}

/**
 * A slot this session may use.
 *
 * Prefers one we ALREADY hold, so re-attaching within a session adopts the
 * browser it is already running instead of paying 2 GB and twenty seconds for a
 * second one. Then the lowest slot nobody holds. A new slot only appears when
 * ANOTHER session is actively using the earlier ones, because two containers on
 * one profile would corrupt it.
 */
async function pickSlot(): Promise<number> {
	const held = ownSlots()
	for(let slot = 0; slot < MAX_SLOTS; slot++) {
		if(held.has(containerName(slot))) {
			return slot
		}
	}

	const busy = busySlots()
	for(let slot = 0; slot < MAX_SLOTS; slot++) {
		if(!busy.has(containerName(slot))) {
			return slot
		}
	}

	throw new Error(
		`All ${MAX_SLOTS} browser containers are in use by other sessions, which `
		+ 'is as many as this runs at once — each costs about 2 GB of RAM. Close '
		+ 'one of those sessions, or attach with mode "dedicated" to use local '
		+ 'Chrome instead.',
	)
}

/**
 * The ports a running container publishes, or undefined when there is nothing
 * healthy to adopt.
 *
 * Adoption has to DISCOVER the ports rather than allocate them: the container
 * was started by a previous session that chose its own.
 */
async function adopt(
	name: string,
): Promise<{ viewerPort: number, cdpPort: number } | undefined> {
	if(await inspectContainer(name) !== 'running') {
		return undefined
	}

	let mapped = ''
	try {
		const { stdout } = await execFileAsync('docker', ['port', name],
			{ timeout: 20_000 })
		mapped = stdout
	} catch{
		return undefined
	}

	// Lines look like `6080/tcp -> 127.0.0.1:49987`.
	const portFor = (containerPort: number) => {
		const line = mapped.split('\n')
			.find((l) => l.startsWith(`${containerPort}/tcp`))
		const host = line?.split(':').pop()?.trim()
		return host ? Number(host) : undefined
	}

	const viewerPort = portFor(VIEWER_PORT)
	const cdpPort = portFor(CDP_PORT)
	if(!viewerPort || !cdpPort || !await isServing(cdpPort)) {
		return undefined
	}

	return { viewerPort, cdpPort }
}

/** Read the container's CDP websocket and assemble the handle. */
async function describe(
	opts: { viewerPort: number, cdpPort: number },
	name: string,
	pulled: boolean,
	slot: number,
	token: string,
): Promise<ContainerBrowser> {
	const version = await fetch(`http://127.0.0.1:${opts.cdpPort}/json/version`)
		.then((res) => res.json()) as { webSocketDebuggerUrl?: string }
	if(!version.webSocketDebuggerUrl) {
		await stopContainer(name)
		throw new Error(
			'The browser container is serving but reported no CDP websocket.',
		)
	}

	return {
		viewerUrl: `http://127.0.0.1:${opts.viewerPort}/liveview.html?magnify=1`,
		cdpUrl: version.webSocketDebuggerUrl,
		viewerPort: opts.viewerPort,
		name,
		pulled,
		slot,
		// Stopping is really "I am done with it". The container only goes when
		// this was the last session holding the slot; otherwise it keeps serving
		// whoever else is using it.
		stop: async() => {
			if(release(name, token)) {
				await stopContainer(name)
				return
			}

			LOGGER.info({ name }, 'left the container running for another session')
		},
	}
}

/** Stop a container. `--rm` means stopping it also removes it. Best effort:
 *  teardown must not throw on the way out. */
async function stopContainer(name: string): Promise<void> {
	try {
		await execFileAsync('docker', ['stop', '-t', '2', name],
			{ timeout: 60_000 })
	} catch(err) {
		// Already gone is the outcome we wanted, not a problem to report.
		const message = err instanceof Error ? err.message : String(err)
		if(/No such container/i.test(message)) {
			LOGGER.debug({ name }, 'container was already stopped')
			return
		}

		LOGGER.warn({ err, name }, 'could not stop the browser container')
	}
}

/** Docker's state for a container, or undefined when there is no such name. */
async function inspectContainer(name: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync('docker',
			['inspect', '--format', '{{.State.Status}}', name], { timeout: 20_000 })
		return stdout.trim() || undefined
	} catch{
		return undefined
	}
}

/** One shot of the readiness check, for deciding whether to reuse. */
async function isServing(cdpPort: number): Promise<boolean> {
	try {
		const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
			signal: AbortSignal.timeout(2_000),
		})
		return res.ok
	} catch{
		return false
	}
}

/**
 * Wait until the runtime is serving, not merely listening.
 *
 * The proxy binds its ports early and answers `503 app is not ready` on EVERY
 * route until the entrypoint has seen a Chromium window and touched
 * `/tmp/minimal-vnc-ready`. So a plain "did the socket accept" check passes
 * while there is no browser — which is exactly the trap the reference script
 * falls into, polling with `curl -sS` and no `-f`. Requiring a 2xx is the whole
 * point.
 */
async function waitUntilServing(cdpPort: number): Promise<void> {
	const deadline = Date.now() + READY_TIMEOUT_MS
	let lastStatus = 'no response'
	while(Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
				signal: AbortSignal.timeout(2_000),
			})
			if(res.ok) {
				return
			}

			lastStatus = `HTTP ${res.status}`
		} catch(err) {
			lastStatus = err instanceof Error ? err.message : String(err)
		}

		await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS))
	}

	throw new Error(
		'The browser container never became ready within '
		+ `${READY_TIMEOUT_MS / 1000}s (last: ${lastStatus}). On Apple Silicon `
		+ 'this usually means x86 emulation is unavailable — enable Rosetta in '
		+ 'Docker Desktop, or use OrbStack.',
	)
}

/** Log the container's own account of a failed start, which is where the
 *  reason lives (a SIGTRAP under QEMU, say). */
async function captureLogs(name: string): Promise<void> {
	try {
		const { stdout, stderr } = await execFileAsync(
			'docker', ['logs', '--tail', '40', name], { timeout: 20_000 },
		)
		LOGGER.warn({ name, logs: `${stdout}\n${stderr}`.trim().slice(-4000) },
			'browser container failed to start')
	} catch(err) {
		LOGGER.debug({ err }, 'could not read the container logs')
	}
}

/**
 * Remove containers whose owning process is gone.
 *
 * Shutdown cleanup covers an orderly exit, but a SIGKILL or a crash runs
 * nothing — and a 1.3 GB container with a live browser in it should not outlive
 * the session that made it. Reaping at startup catches those, and the owner-PID
 * label keeps it safe: a container whose owner still runs belongs to another
 * session and is left alone.
 */
export async function reapOrphanedContainers(): Promise<string[]> {
	let listed = ''
	try {
		const { stdout } = await execFileAsync('docker', [
			'ps', '--filter', `label=${OWNER_LABEL}`,
			'--format', `{{.Names}} {{.Label "${OWNER_LABEL}"}}`,
		], { timeout: 20_000 })
		listed = stdout
	} catch{
		// No Docker, or no daemon. Nothing to reap and nothing to report.
		return []
	}

	const reaped: string[] = []
	for(const line of listed.split('\n')) {
		const [name, pid] = line.trim().split(/\s+/)
		if(!name || !pid) {
			continue
		}

		if(processAlive(Number(pid))) {
			continue
		}

		try {
			await execFileAsync('docker', ['rm', '-f', name], { timeout: 60_000 })
			reaped.push(name)
			LOGGER.info({ name, pid }, 'removed an orphaned browser container')
		} catch(err) {
			// Someone else may have removed it first. Not worth failing a start.
			LOGGER.debug({ err, name }, 'could not remove an orphan')
		}
	}

	return reaped
}
