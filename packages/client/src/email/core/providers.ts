import { z } from 'zod'

/** Mailbox providers that Reclaim Portal can read an email from. */
export const EMAIL_PROVIDERS = ['gmail'] as const

export type EmailProvider = typeof EMAIL_PROVIDERS[number]

export const emailProviderSchema = z.enum(EMAIL_PROVIDERS)

/**
 * How the Portal reads the mailbox for a given provider — a transport, not a
 * provider: both yield the same raw RFC822 email and the same DKIM-bound proof.
 * `api` is the provider's official REST API (Gmail OAuth `gmail.readonly`);
 * `bridge` is the Popcorn-backed drop-in that serves the identical REST surface
 * from the user's own signed-in session (the fallback while restricted-scope
 * API approval is blocked). The request carries only this word; the Portal maps
 * it to a base URL it holds in its own config, so an app never supplies a URL.
 */
export const EMAIL_TRANSPORTS = ['api', 'bridge'] as const

export type EmailTransport = typeof EMAIL_TRANSPORTS[number]

export const emailTransportSchema = z.enum(EMAIL_TRANSPORTS)
