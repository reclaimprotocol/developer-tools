// Debug helper (gated by RECLAIM_AGENT_DUMP_RESPONSE): capture the EXACT
// response bytes the attestor validates a claim against, plus a per-match
// presence check. A "Response does not contain X" failure means the attestor's
// server-side re-fetch differs from what the browser (replay) saw — for
// example, GitHub embeds nav/userMenu data for browser requests but not for the
// attestor's raw fetch. Seeing the attestor's actual response is the only way
// to tell what it really returned.
//
// On each getResponseRedactions call it writes the response to
// `attestor-last-response.html` in the process CWD and logs the byte count +,
// for every responseMatch (paramValues substituted), whether it's present.
import { providers } from '@reclaimprotocol/attestor-core'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface RedactionArg {
	response: Uint8Array
	params: {
		responseMatches?: Array<{ value?: string }>
		paramValues?: Record<string, string>
	}
}

let installed = false

/** Wrap attestor-core's http `getResponseRedactions` to dump the response it
 *  runs against. Idempotent; no-op unless RECLAIM_AGENT_DUMP_RESPONSE is
 *  set. */
export function installResponseDump() {
	if(installed || !process.env['RECLAIM_AGENT_DUMP_RESPONSE']) {
		return
	}

	const http = providers['http'] as unknown as {
		getResponseRedactions?: (arg: RedactionArg) => unknown
	}
	const original = http.getResponseRedactions
	if(typeof original !== 'function') {
		return
	}

	installed = true
	http.getResponseRedactions = function(this: unknown, arg: RedactionArg) {
		try {
			const bytes = Buffer.from(arg.response)
			const text = bytes.toString('utf8')
			const paramValues = arg.params.paramValues ?? {}
			const matches = (arg.params.responseMatches ?? []).map((m) => {
				let value = m.value ?? ''
				for(const [key, val] of Object.entries(paramValues)) {
					value = value.split(`{{${key}}}`).join(val)
				}

				return { value, present: text.includes(value) }
			})
			const path = join(process.cwd(), 'attestor-last-response.html')
			writeFileSync(path, text)
			process.stderr.write(`${JSON.stringify({
				tag: 'attestor-response-dump',
				bytes: bytes.length,
				path,
				matches,
			})}\n`)
		} catch{
			// diagnostic only — never break proving
		}

		return original.call(this, arg)
	}
}
