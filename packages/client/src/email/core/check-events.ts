/* eslint-disable @stylistic/max-len */
import { freeze } from './policy.ts'

export const EMAIL_CHECK_EVENTS_VERSION = 1
export type EmailCheckStep =
	| 'raw_email'
	| 'snapshot'
	| 'dkim'
	| 'signed_headers'
	| 'sender'
	| 'recipient'
	| 'date'
	| 'mime'
	| 'extraction'
	| 'approval'
	| 'ai_input'
	| 'ai_response'
	| 'ai_schema'
	| 'evidence_resolution'
	| 'evidence_validation'
	| 'analysis'
export interface EmailCheckEvent {
	step: EmailCheckStep
	status: 'passed' | 'failed' | 'returned' | 'omitted'
	code?: string
	/** Machine results only; no email text, addresses, credentials or model prose. */
	details: Record<string, unknown>
	/** Owner-only local diagnostics. Must never enter production telemetry. */
	privateDetails?: Record<string, unknown>
}
export type EmailCheckObserver = (event: Readonly<EmailCheckEvent>) => void
export function emailCheckCode(error: unknown, fallback: string): string {
	return error instanceof Error && /^[A-Z][A-Z_]{1,79}$/.test(error.message)
		? error.message
		: fallback
}

/** Observers get detached immutable data and cannot affect verification decisions. */
export function reportEmailCheck(
	observer: EmailCheckObserver | undefined,
	event: EmailCheckEvent,
): void {
	if(!observer) {
		return
	}

	try {
		observer(freeze(structuredClone(event)))
	} catch{
		/* Diagnostics never change verification. */
	}
}
