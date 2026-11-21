/* eslint-disable @stylistic/max-len */
import { createHash } from 'node:crypto'

export function waitForGmailDelay(
	ms: number,
	signal: AbortSignal,
): Promise<void> {
	signal.throwIfAborted()
	if(ms <= 0) {
		return Promise.resolve()
	}

	return new Promise((resolve, reject) => {
		const abort = () => {
			clearTimeout(timer)
			reject(signal.reason)
		}

		const timer = setTimeout(() => {
			signal.removeEventListener('abort', abort)
			resolve()
		}, ms)
		signal.addEventListener('abort', abort, { once: true })
	})
}

/** Process-local pacing below Gmail's 6,000-unit/minute user quota, including concurrent searches.
 * Store only token hashes, deadlines and counters; never email content or credentials.
 */
export class GmailRateLimiter {
	private readonly states = new Map<
		string,
		{ next: number, blocked: number, used: number }
	>()
	private state(token: string) {
		const key = createHash('sha256').update(token).digest('hex'),
			now = Date.now()
		let state = this.states.get(key)
		if(!state) {
			for(const [id, old] of this.states) {
				if(Math.max(old.used + 120_000, old.blocked) < now) {
					this.states.delete(id)
				}
			}

			if(this.states.size >= 1024) {
				this.states.delete(this.states.keys().next().value!)
			}

			state = { next: now, blocked: 0, used: now }
			this.states.set(key, state)
		}

		state.used = now
		return state
	}
	remaining(token: string): number {
		return Math.max(0, this.state(token).blocked - Date.now())
	}
	defer(token: string, ms: number): void {
		const state = this.state(token)
		state.blocked = Math.max(state.blocked, Date.now() + ms)
		state.next = Math.max(state.next, state.blocked)
	}
	/** Return a retry delay instead of waiting beyond the caller's request deadline. */
	async acquire(
		token: string,
		cost: number,
		deadline: number,
		signal: AbortSignal,
	): Promise<number> {
		const state = this.state(token)
		for(;;) {
			signal.throwIfAborted()
			const now = Date.now(),
				start = Math.max(now, state.next, state.blocked)
			if(start >= deadline) {
				return Math.max(1000, start - now)
			}

			state.next = start + Math.ceil((cost * 1000) / 80)
			await waitForGmailDelay(start - now, signal)
			// Another in-flight request may have discovered a quota cooldown while we waited.
			if(state.blocked > Date.now()) {
				continue
			}

			return 0
		}
	}
}
export const gmailRateLimiter = new GmailRateLimiter()
