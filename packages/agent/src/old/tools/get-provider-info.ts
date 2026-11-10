import { isBoom } from '@hapi/boom'
import { defineTool, type RegisteredTool } from '../../mcp/server.ts'
import type { ReclaimSdkClient } from '../sdk-client.ts'

/** Best-effort call: resolve to the response, or to an error string instead
 *  of throwing — one endpoint 404ing (for example, a bad `versionNumber`)
 *  shouldn't hide a result the other endpoint DID have. */
async function attempt(
	label: string,
	call: () => Promise<unknown>,
): Promise<{ ok: true, value: unknown } | { ok: false, error: string }> {
	try {
		return { ok: true, value: await call() }
	} catch(err) {
		const message = isBoom(err) ? err.message : String(err)
		return { ok: false, error: `${label}: ${message}` }
	}
}

/**
 * The single provider-read tool for old-devtools mode. Reads from the PUBLIC
 * production SDK backend (`api.reclaimprotocol.org`) — the service the
 * verification SDK/attestor itself calls at runtime. No auth required, works
 * for ANY provider.
 *
 * Fetches BOTH shapes in one call, since they're complementary and together
 * cover everything a caller needs before re-publishing a new version:
 *   - `provider`: the full provider + providerConfig — `customInjection`,
 *     `userAgent`, `allowedInjectedRequestData`, `requestData`, everything.
 *     This is what you read before create_provider_version_from_capture so
 *     you can pass the whole config back (that tool carries nothing forward).
 *   - `configs`: the trimmed runtime recipe the attestor actually consumes —
 *     `customInjection` deliberately omitted, `isScriptRequestingClaim`
 *     computed instead.
 */
export function getProviderInfoTool(client: ReclaimSdkClient): RegisteredTool {
	return defineTool<{ providerId: string, versionNumber?: string }>(
		{
			name: 'get_provider_info',
			description:
				'Read a PUBLISHED provider from the public production SDK backend ' +
				'(api.reclaimprotocol.org — what the verification SDK/attestor ' +
				'itself fetches at runtime), for ANY provider, no auth required. ' +
				'This is the provider-read tool for old-devtools mode. A ' +
				'published provider is usable as-is: don\'t re-verify it ' +
				'(capture/replay/proof) unless the user asks to test it.\n\n' +
				'Returns two complementary reads for the given version (latest ' +
				'when `versionNumber` is omitted): `provider` (the FULL provider ' +
				'+ providerConfig — `customInjection`, `userAgent`, ' +
				'`allowedInjectedRequestData`, `requestData`, everything) and ' +
				'`configs` (the trimmed recipe the attestor actually consumes — ' +
				'`customInjection` is deliberately OMITTED there, replaced by a ' +
				'computed `isScriptRequestingClaim` flag). Read `provider` here ' +
				'BEFORE create_provider_version_from_capture so you can pass the ' +
				'whole existing config back — that tool always creates a new ' +
				'version and carries nothing forward. One endpoint failing (for ' +
				'example, an invalid `versionNumber`) is reported under `errors` ' +
				'without ' +
				'hiding a result the other endpoint did return.',
			inputSchema: {
				type: 'object',
				properties: {
					providerId: {
						type: 'string',
						description: 'UUID of the provider.',
					},
					versionNumber: {
						type: 'string',
						description:
							'Specific version, for example, "1.0.2". Omit for the ' +
							"provider's current latest version.",
					},
				},
				required: ['providerId'],
			},
		},
		async({ providerId, versionNumber }) => {
			const [provider, configs] = await Promise.all([
				attempt(
					'provider',
					() => client.getProvider(providerId, versionNumber),
				),
				attempt(
					'configs',
					() => client.getProviderConfigs(providerId, versionNumber),
				),
			])

			const errors = [provider, configs]
				.filter((r) => !r.ok)
				.map((r) => (r as { error: string }).error)

			return {
				...(provider.ok ? { provider: provider.value } : {}),
				...(configs.ok ? { configs: configs.value } : {}),
				...(errors.length ? { errors } : {}),
			}
		},
	)
}
