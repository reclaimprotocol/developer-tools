export type BodyLookup =
	| { available: true, body: string }
	| { available: false, reason: string }

export interface BodyStoreOptions {
	maxBytes: number
}

export class BodyStore {
	#store = new Map<string, string>() // insertion order = LRU order
	#bytes = 0
	#opts: BodyStoreOptions

	constructor(opts: BodyStoreOptions) {
		this.#opts = opts
	}

	set(requestId: string, body: string) {
		if(this.#store.has(requestId)) {
			this.#bytes -= byteLen(this.#store.get(requestId)!)
			this.#store.delete(requestId)
		}

		this.#store.set(requestId, body)
		this.#bytes += byteLen(body)
		while(this.#bytes > this.#opts.maxBytes && this.#store.size > 0) {
			const oldestKey = this.#store.keys().next().value!
			const oldestVal = this.#store.get(oldestKey)!
			this.#bytes -= byteLen(oldestVal)
			this.#store.delete(oldestKey)
		}
	}

	get(requestId: string): BodyLookup {
		const body = this.#store.get(requestId)
		if(body === undefined) {
			return {
				available: false,
				reason: 'evicted from in-memory LRU body store',
			}
		}

		// Refresh LRU position by re-inserting.
		this.#store.delete(requestId)
		this.#store.set(requestId, body)
		return { available: true, body }
	}
}

function byteLen(s: string): number {
	return Buffer.byteLength(s, 'utf8')
}
