import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { reclaimHome } from './consts.ts'

/**
 * Resolve the Reclaim cache directory (`~/.reclaim`). Honours the
 * `RECLAIM_HOME` env var as an override so tests can sandbox writes.
 */
export function reclaimHomeDirPath() {
	return reclaimHome()
}

/**
 * Walk up from `start` until we find a directory containing one of
 * the project-root markers, then return that directory. Falls back
 * to `start` if no marker is found within 8 levels.
 */
export function findProjectRoot(start: string = process.cwd()) {
	const markers = ['.git', 'package.json', 'pyproject.toml', 'Cargo.toml']
	let dir = resolve(start)
	for(let i = 0; i < 8; i++) {
		for(const m of markers) {
			if(existsSync(join(dir, m))) {
				return dir
			}
		}

		const parent = dirname(dir)
		if(parent === dir) {
			break
		}

		dir = parent
	}

	return start
}
