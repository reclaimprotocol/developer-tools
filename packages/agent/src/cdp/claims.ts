/**
 * Which sessions are using which browser container.
 *
 * A container is worth sharing: about 2 GB of RAM and 7 to 17 seconds to start,
 * so a developer running one session after another should get the same one back
 * rather than pay for a new one each time.
 *
 * It can only be shared SEQUENTIALLY, and the profile is why. Every container
 * mounts a host directory as Chromium's `user-data-dir`, and the runtime
 * deletes `SingletonLock` on boot — so a second container on the same profile
 * is a second writer on one cookie jar. Chromium does not support that, and the
 * failure is silent corruption of the thing most worth keeping: the login.
 *
 * So each container gets a SLOT. A slot has one profile and at most one live
 * claimant. A session adopts the first slot nobody holds; when the last claim
 * on a slot goes, the container stops.
 *
 * State lives in a file because each MCP session is its own OS process, with
 * no shared memory to count in. Claims are process ids, and liveness is a
 * signal-0 check — the same test the orphan reaper uses. It fails the harmless
 * way: a recycled pid keeps a container alive rather than pulling one out from
 * under a running session.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { LOGGER } from '../logger.ts'
import { reclaimHomeDirPath } from '../paths.ts'

/**
 * Slot → the claim tokens currently held on it.
 *
 * A token is `<pid>.<n>`, not a bare pid, because one session can legitimately
 * hold a slot twice: re-attaching adopts the container it is already running,
 * and for a moment both the new handle and the old one are outstanding. With
 * bare pids those two collapse into one entry, so releasing the OLD handle
 * stops the container the new one just adopted. The `<n>` keeps them distinct;
 * the `<pid>` is what liveness is checked against.
 */
type ClaimFile = Record<string, string[]>

/** Distinguishes claims made by this same process. */
let claimSeq = 0

/** The pid a token belongs to, or 0 when it is malformed. */
function tokenPid(token: string): number {
	const pid = Number(token.split('.')[0])
	return Number.isInteger(pid) ? pid : 0
}

function claimsPath(): string {
	return join(reclaimHomeDirPath(), 'browser-runtime-claims.json')
}

function read(): ClaimFile {
	try {
		const parsed = JSON.parse(readFileSync(claimsPath(), 'utf8')) as ClaimFile
		// Drop claims whose process is gone: that is what makes a slot free again
		// after a session was killed without cleaning up.
		const live: ClaimFile = {}
		for(const [slot, tokens] of Object.entries(parsed)) {
			const alive = (Array.isArray(tokens) ? tokens : [])
				.filter((token) => processAlive(tokenPid(token)))
			if(alive.length) {
				live[slot] = alive
			}
		}

		return live
	} catch{
		// Missing or unreadable: nobody has claimed anything.
		return {}
	}
}

function write(claims: ClaimFile): void {
	const path = claimsPath()
	mkdirSync(dirname(path), { recursive: true })
	// Write then rename, so a reader never sees a half-written file. Two sessions
	// racing here means last-writer-wins on a file that is pruned on every read,
	// which costs at most one redundant container.
	const temp = `${path}.${process.pid}.tmp`
	writeFileSync(temp, `${JSON.stringify(claims, null, '\t')}\n`)
	renameSync(temp, path)
}

/** Whether a process is still running. Signal 0 checks without delivering. */
export function processAlive(pid: number): boolean {
	if(!Number.isInteger(pid) || pid <= 0) {
		return false
	}

	try {
		process.kill(pid, 0)
		return true
	} catch(err) {
		// EPERM means it exists but belongs to another user — alive either way.
		return (err as NodeJS.ErrnoException).code === 'EPERM'
	}
}

/** Slots with at least one live claimant, so a caller can avoid them. */
export function busySlots(): Set<string> {
	return new Set(Object.keys(read()))
}

/**
 * Slots THIS process already holds.
 *
 * Its own claim must not push it onto a new slot: re-attaching in one session
 * should come back to the browser it is already running, not start a second.
 */
export function ownSlots(): Set<string> {
	const mine = new Set<string>()
	for(const [slot, tokens] of Object.entries(read())) {
		if(tokens.some((token) => tokenPid(token) === process.pid)) {
			mine.add(slot)
		}
	}

	return mine
}

/** Take a claim on `slot`. Returns the token to release it with. */
export function claim(slot: string): string {
	const token = `${process.pid}.${++claimSeq}`
	const claims = read()
	claims[slot] = [...claims[slot] ?? [], token]
	write(claims)
	LOGGER.debug({ slot, held: claims[slot] }, 'claimed a browser slot')
	return token
}

/**
 * Give up this process's claim.
 *
 * Returns true when nobody is left, which is the caller's signal to stop the
 * container. Returns false while another live session still holds it — stopping
 * then would pull the browser out from under them.
 */
export function release(slot: string, token: string): boolean {
	const claims = read()
	const remaining = (claims[slot] ?? []).filter((held) => held !== token)
	if(remaining.length) {
		claims[slot] = remaining
		write(claims)
		LOGGER.debug({ slot, remaining }, 'released a claim; others still hold it')
		return false
	}

	delete claims[slot]
	write(claims)
	return true
}
