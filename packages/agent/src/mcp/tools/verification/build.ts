import type { RegisteredTool } from '../../server.ts'
import { proxyCallbackEventsTool } from './proxy-callback-events.ts'
import { readCallbackEventsTool } from './read-callback-events.ts'
import { verificationResultTool } from './result.ts'
import { waitForAiSessionTool } from './wait-for-ai-session.ts'

/**
 * Builder-mode verification tools: higher-level orchestrations over the
 * generated API surface. `get_verification_result` authenticates with the org
 * token, checks status, pulls the stored payload, and decrypts it locally with
 * the optional eth key — a flow the generated raw-API tools can't express
 * (the decryption key never leaves the consumer). `read_callback_events` and
 * `proxy_callback_events` read and forward the org's pull-listener events.
 * Diagnosis is left to the
 * agent over the generated tools (`get_verification_session`,
 * `list_verification_events`, `list_verification_deliveries`), whose
 * descriptions carry the lifecycle and delivery semantics.
 */
export function buildVerificationTools(): RegisteredTool[] {
	return [
		verificationResultTool(),
		readCallbackEventsTool(),
		proxyCallbackEventsTool(),
		waitForAiSessionTool(),
	]
}
