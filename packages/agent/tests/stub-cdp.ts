import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CaptureSession } from '../src/cdp/capture.ts'
import { BodyStore } from '../src/cdp/eviction.ts'
import type { CapturedRequest } from '../src/provider/schema.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function loadFixture(name: string): CaptureSession {
	const path = join(__dirname, 'fixtures', `${name}.json`)
	const raw = JSON.parse(readFileSync(path, 'utf8')) as {
		requests: CapturedRequest[]
	}
	const requests = new Map<string, CapturedRequest>()
	const bodies = new BodyStore({ maxBytes: 10 * 1024 * 1024 })
	for(const r of raw.requests) {
		requests.set(r.requestId, r)
		if(r.responseBody) {
			bodies.set(r.requestId, r.responseBody)
		}
	}

	return {
		captureId: `fixture_${name}`,
		requests,
		bodies,
		stop: async() => {},
	}
}
