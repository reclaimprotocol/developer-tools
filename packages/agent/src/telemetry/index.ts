import type { Telemetry } from './telemetry.ts'

export { startToolCall } from './tool-call.ts'
export { Telemetry } from './telemetry.ts'

let current: Telemetry | undefined

/**
 * Makes `telemetry` the instance the hooks report to. Until you call this,
 * the hooks do nothing, which is how opt-out and tests stay silent.
 */
export function installTelemetry(telemetry: Telemetry | undefined) {
	current = telemetry
}

export function currentTelemetry(): Telemetry | undefined {
	return current
}
