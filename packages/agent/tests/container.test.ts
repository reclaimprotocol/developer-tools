/**
 * The browser-runtime container (`src/cdp/container.ts`).
 *
 * These assert on the `docker run` argv rather than on a running container, so
 * they need no Docker and no 1.3 GB image. That is the right trade: the flags
 * are what carry the security and correctness decisions, and every one of them
 * is invisible from outside the process.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	BROWSER_RUNTIME_IMAGE,
	buildRunArgs,
	type ContainerOptions,
	containerProfileDir,
	dockerMissingMessage,
} from '../src/cdp/container.ts'

const OPTS = { viewerPort: 16080, cdpPort: 19226 }

/** The value following `flag`, for a `--flag value` pair. */
function valueAfter(args: string[], flag: string): string | undefined {
	const at = args.indexOf(flag)
	return at === -1 ? undefined : args[at + 1]
}

/** Every `-p` mapping, in order. */
function publishes(args: string[]): string[] {
	return args.filter((_, i) => args[i - 1] === '-p')
}

describe('browser runtime: docker arguments', () => {
	const args = buildRunArgs(
		OPTS, BROWSER_RUNTIME_IMAGE, 'reclaim-browser-0',
		'/home/dev/.reclaim/browser-runtime-profile',
	)

	it('pins the platform, because the image is amd64-only', () => {
		// Tilion Fortress publishes no arm64 manifest, so an arm64 variant cannot
		// exist. Without this, Docker on Apple Silicon looks for one.
		assert.equal(valueAfter(args, '--platform'), 'linux/amd64')
	})

	it('pins the image by digest, not by a moving tag', () => {
		// Upstream publishes git SHAs plus `latest`/`main` and no semver, so a tag
		// is the only mutable option. A digest cannot change underneath a release.
		assert.match(BROWSER_RUNTIME_IMAGE, /@sha256:[0-9a-f]{64}$/)
		assert.equal(args.at(-1), BROWSER_RUNTIME_IMAGE,
			'the image is the last argument, after every flag')
	})

	it('publishes BOTH ports on loopback only', () => {
		// The CDP port is unauthenticated, total control of the browser. Inside
		// the container both proxies listen on 0.0.0.0, so this mapping is the
		// only thing deciding who can reach them.
		assert.deepEqual(publishes(args), [
			'127.0.0.1:16080:6080',
			'127.0.0.1:19226:9226',
		])
		for(const mapping of publishes(args)) {
			assert.ok(mapping.startsWith('127.0.0.1:'), mapping)
		}
	})

	it('never publishes the restricted CDP port', () => {
		// :9222 allows 19 methods with no Runtime.* and no Network.*, so it cannot
		// drive the authoring loop. Publishing it would only invite confusion.
		assert.ok(!publishes(args).some((m) => m.endsWith(':9222')))
	})

	it('gives Chromium room in /dev/shm', () => {
		// Docker's default is 64 MB. The image README and the upstream Helm chart
		// both provision 1-2 GiB; only the reference dev script leaves the default.
		assert.ok(args.includes('--shm-size=1g'))
	})

	it('turns off the boot-time geoip lookup', () => {
		// Two HTTP lookups with an 8s timeout each, on by default: up to 16s added
		// to every cold start, for a locale we are not impersonating.
		assert.ok(args.includes('CLOAK_GEOIP=false'))
	})

	it('mounts a host profile, so a sign-in survives the container', () => {
		// Authoring means signing in once and capturing an authenticated request.
		// The profile also holds the persisted fingerprint identity, which
		// upstream warns must stay stable against the same cookie jar.
		const mount = valueAfter(args, '-v')
		assert.ok(mount?.endsWith(':/home/kernel/user-data'), mount)
	})

	it('labels the container with the process that owns it', () => {
		// This is what makes orphan cleanup safe. A container can outlive its
		// session (SIGKILL, a crash, a closed laptop) and something has to remove
		// it — but never one another session is still driving. The owning PID
		// answers that, and errs harmlessly: a dead PID reaps, a live one is left.
		const label = valueAfter(args, '--label')
		assert.match(String(label), /^org\.reclaim\.agent\.owner-pid=\d+$/)
		assert.equal(label, `org.reclaim.agent.owner-pid=${process.pid}`)
	})

	it('names the container after its slot, so a slot can be found again', () => {
		// The name is how a session finds the container to adopt, and how a slot
		// maps to exactly one profile. The reference script uses one fixed name
		// and `docker rm -f`s it before every run, which would destroy a
		// container another session is using.
		assert.equal(valueAfter(args, '--name'), 'reclaim-browser-0')
	})

	it('gives every slot its own profile: one profile, one writer', () => {
		// Two Chromiums on one `user-data-dir` corrupt it: the runtime deletes
		// SingletonLock on boot, so the second becomes a second writer on the
		// same cookie jar. Slot 0 keeps the original path so an existing login
		// survives.
		assert.match(containerProfileDir(0), /browser-runtime-profile$/)
		assert.match(containerProfileDir(1), /browser-runtime-profile-1$/)
		assert.notEqual(containerProfileDir(0), containerProfileDir(1))
	})

	it('removes the container when it exits', () => {
		assert.ok(args.includes('--rm'))
		assert.ok(args.includes('-d'), 'detached: we wait on readiness ourselves')
	})

	it('does not force a port, so ports can be allocated per container', () => {
		// Ports are discovered when adopting and allocated when starting, so
		// neither is something a caller has to know. Both optional in the type
		// for exactly that reason.
		const opts: ContainerOptions = {}
		assert.equal(opts.viewerPort, undefined)
		assert.equal(opts.cdpPort, undefined)
	})

	it('passes display size and start URL only when asked', () => {
		const bare = buildRunArgs(OPTS, 'img', 'n', '/p')
		assert.ok(!bare.some((a) => a.startsWith('WIDTH=')))
		assert.ok(!bare.some((a) => a.startsWith('APP_URL=')))

		const shaped = buildRunArgs(
			{ ...OPTS, width: 412, height: 915, url: 'https://example.com' },
			'img', 'n', '/p',
		)
		assert.ok(shaped.includes('WIDTH=412'))
		assert.ok(shaped.includes('HEIGHT=915'))
		assert.ok(shaped.includes('APP_URL=https://example.com'))
	})
})

describe('browser runtime: when Docker is missing', () => {
	it('names the fix and the alternatives', () => {
		// Docker cannot be installed for them, so the only useful failure is one
		// that says what to do — including "use a different browser".
		const message = dockerMissingMessage()
		assert.match(message, /Docker/)
		assert.match(message, /Rosetta/,
			'the amd64 image needs it on Apple Silicon')
		assert.match(message, /dedicated/, 'local Chrome is still an option')
		assert.match(message, /builder/,
			'so is a remote browser with a hosted view')
	})
})
