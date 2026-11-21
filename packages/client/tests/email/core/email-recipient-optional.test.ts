/* eslint-disable @stylistic/max-len -- ported from the email core's test suite; kept close to upstream so the two can be compared */
import {
	approveWithResolver,
	inspectApprovedEmail,
	releaseApprovedEmail,
} from '../../../src/email/core/approval.ts'
import {
	fixtureBinding,
	fixturePolicy,
	fixtureResolver,
	signCoreEmail,
} from './fixtures/email-core.ts'
import { expect, it } from './vitest-compat.ts'

it('discovers the recipient from the logged-in account and still enforces signed To without a preset', async() => {
	const policy = fixturePolicy({
		params: [
			{ name: 'baggageCount', instructions: 'Find the hold baggage count.' },
		],
		instructions: 'Find my baggage count.',
	})
	expect(policy).not.toHaveProperty('expectedRecipient')
	const raw = await signCoreEmail({ body: 'Your reservation includes 2 bags.' })
	const binding = fixtureBinding(policy)
	const approved = await approveWithResolver(
		raw,
		policy,
		binding,
		new AbortController().signal,
		fixtureResolver,
	)
	try {
		expect(inspectApprovedEmail(approved, binding).to).toContain(
			binding.accountAddress,
		)
	} finally {
		releaseApprovedEmail(approved)
	}

	await expect(
		approveWithResolver(
			raw,
			policy,
			{ ...binding, accountAddress: 'bob@example.net', accountId: 'bob' },
			new AbortController().signal,
			fixtureResolver,
		),
	).rejects.toThrow('RECIPIENT_NOT_ACCEPTED')
})

it('an optional preset can restrict the account, never replace its signed-recipient check', async() => {
	const policy = fixturePolicy({ expectedRecipient: 'bob@example.net' })
	await expect(
		approveWithResolver(
			await signCoreEmail(),
			policy,
			fixtureBinding(policy),
			new AbortController().signal,
			fixtureResolver,
		),
	).rejects.toThrow('RECIPIENT_NOT_ACCEPTED')
})
