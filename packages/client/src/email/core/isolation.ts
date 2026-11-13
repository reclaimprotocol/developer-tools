/* eslint-disable @stylistic/max-len */
import { execFile, spawn } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
/** Internal launcher, also used by hostile-worker tests. Never exported by the package. */
export async function runDocumentWorker(
	worker: string,
	input: string,
	signal: AbortSignal,
	operation: 'document' | 'preview' = 'document',
): Promise<unknown> {
	signal.throwIfAborted()
	if(Buffer.byteLength(input) > 24 * 1024 * 1024) {
		throw new Error('MESSAGE_SIZE')
	}

	if(process.platform !== 'linux') {
		throw new Error('DOCUMENT_ISOLATION_UNAVAILABLE')
	}

	const runtime = process.env.EMAIL_DOCUMENT_BWRAP ?? '/usr/bin/bwrap'
	if(!isAbsolute(runtime)) {
		throw new Error('DOCUMENT_ISOLATION_UNAVAILABLE')
	}

	let args: string[]
	try {
		const runtimeInfo = await stat(runtime)
		if(!runtimeInfo.isFile() || runtimeInfo.mode & 0o6000) {
			throw new Error('Unsupported privileged runtime')
		}

		const version = await execute(runtime, ['--version'], {
			env: {},
			timeout: 2000,
			maxBuffer: 1024,
			signal,
		})
		const match = /^bubblewrap (\d+)\.(\d+)\.(\d+)\s*$/.exec(version.stdout)
		// Upstream 0.12.0 fixes CVE-2026-87766 and removes setuid operation.
		if(!match || (Number(match[1]) === 0 && Number(match[2]) < 12)) {
			throw new Error('Unsupported isolation runtime')
		}

		const node = await realpath(process.execPath)
		// ldd inspects only our trusted Node executable, never an uploaded document.
		const { stdout } = await execute('/usr/bin/ldd', [node, '/usr/bin/env'], {
			env: { PATH: '/usr/bin:/bin' },
			timeout: 2000,
			maxBuffer: 64 * 1024,
			signal,
		})
		const libraries = [
			...new Set(
				stdout.split('\n').flatMap((line) => {
					const path = line.match(/(?:=>\s*)?(\/\S+)\s+\(/)?.[1]
					return path ? [path] : []
				}),
			),
		]
		if(!libraries.length) {
			throw new Error('Missing runtime libraries')
		}

		// Preserve Node's installed package resolution, including npm workspace hoisting.
		// Mount only dependency directories, never their parent workspace/home/config files.
		const dependencyDirectories: string[] = []
		let parent = dirname(worker)
		for(;;) {
			const modules = join(parent, 'node_modules')
			try {
				const info = await stat(modules)
				if(info.isDirectory()) {
					dependencyDirectories.unshift(modules)
				}
			} catch(error) {
				if((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error
				}
			}

			const next = dirname(parent)
			if(next === parent) {
				break
			}

			parent = next
		}

		if(!dependencyDirectories.length) {
			throw new Error('Missing installed dependencies')
		}

		args = [
			'--as=2147483648:2147483648',
			'--cpu=20:20',
			'--fsize=0:0',
			'--nofile=64:64',
			'--core=0:0',
			'--',
			runtime,
			'--unshare-all',
			'--unshare-user',
			'--die-with-parent',
			'--new-session',
			'--cap-drop',
			'ALL',
			'--clearenv',
			'--ro-bind',
			node,
			'/runtime/node',
			'--ro-bind',
			'/usr/bin/env',
			'/runtime/env',
			...dependencyDirectories.flatMap((path) => ['--ro-bind', path, path]),
			'--ro-bind',
			worker,
			worker,
			'--ro-bind',
			fileURLToPath(
				new URL('../lib/email/attachment-limits.mjs', import.meta.url),
			),
			join(dirname(worker), 'attachment-limits.mjs'),
			'--ro-bind',
			fileURLToPath(new URL('../lib/email/xml-guard.mjs', import.meta.url)),
			join(dirname(worker), 'xml-guard.mjs'),
		]
		for(const library of libraries) {
			args.push('--ro-bind', library, library)
		}

		args.push(
			'--proc',
			'/proc',
			'--remount-ro',
			'/proc',
			'--dev',
			'/dev',
			'--chdir',
			dirname(worker),
			'--remount-ro',
			'/',
			'--',
			'/runtime/env',
			'-i',
			'/runtime/node',
			'--max-old-space-size=256',
			'--disable-wasm-trap-handler',
			worker,
		)
	} catch{
		if(signal.aborted) {
			throw new Error('EMAIL_APPROVAL_CANCELLED')
		}

		throw new Error('DOCUMENT_ISOLATION_UNAVAILABLE')
	}

	signal.throwIfAborted()
	// prlimit enforces address-space/CPU limits for Bubblewrap and all descendants.
	// stdio is the only inherited IPC; no shell or host credential environment.
	const child = spawn('/usr/bin/prlimit', args, {
		env: {},
		stdio: ['pipe', 'pipe', 'pipe'],
	})
	return new Promise((resolve, reject) => {
		let settled = false,
			size = 0
		const chunks: Buffer[] = []
		const finish = (error?: Error, output?: unknown) => {
			if(settled) {
				return
			}

			settled = true
			clearTimeout(timer)
			signal.removeEventListener('abort', cancel)
			if(error) {
				child.kill('SIGKILL')
			}

			for(const chunk of chunks) {
				chunk.fill(0)
			}

			if(error) {
				reject(error)
			} else {
				resolve(output)
			}
		}

		const cancel = () => finish(new Error('EMAIL_APPROVAL_CANCELLED'))
		const timer = setTimeout(
			() => finish(new Error('ATTACHMENT_EXTRACTION_TIMEOUT')),
			20_000,
		)
		signal.addEventListener('abort', cancel, { once: true })
		child.stdout.on('data', (chunk: Buffer) => {
			if(settled) {
				return
			}

			size += chunk.length
			if(size > (operation === 'preview' ? 12 : 8) * 1024 * 1024) {
				finish(new Error('ATTACHMENT_TEXT_TOO_LARGE'))
			} else {
				chunks.push(chunk)
			}
		})
		// Diagnostics can contain document data or paths. Do not forward them.
		child.stderr.resume()
		child.stdin.on('error', () => {})
		child.once('error', () => finish(new Error('DOCUMENT_ISOLATION_UNAVAILABLE')),
		)
		child.once('close', (code) => {
			if(settled) {
				return
			}

			if(code !== 0) {
				return finish(new Error('DOCUMENT_ISOLATION_UNAVAILABLE'))
			}

			try {
				finish(undefined, JSON.parse(Buffer.concat(chunks).toString('utf8')))
			} catch{
				finish(new Error('ATTACHMENT_EXTRACTION_FAILED'))
			}
		})
		child.stdin.end(input)
		if(signal.aborted) {
			cancel()
		}
	})
}
