import { z } from 'zod'

/** Mailbox providers that Reclaim Portal can read an email from. */
export const EMAIL_PROVIDERS = ['gmail'] as const

export type EmailProvider = typeof EMAIL_PROVIDERS[number]

export const emailProviderSchema = z.enum(EMAIL_PROVIDERS)
