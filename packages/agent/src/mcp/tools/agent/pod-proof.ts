/**
 * Prove a drafted recipe through the Popcorn pod's OWN `/reclaim/prove` — the
 * remote browser session's own API for creating a proof from that same
 * session — instead of the local in-process attestor SDK (`run_proof`).
 * Recommended for any `builder`-mode attach: the pod is the SAME enclave that
 * holds the browser's TLS session, so proving there reaches the target from
 * the identical exit IP the browser used — including the country-routed egress
 * Popcorn applies when the session was allocated with a country. A local SDK
 * proof runs from the agent's own network instead, which won't match a
 * country-locked / IP-allowlisted target the remote browser could reach.
 *
 * Builder mode only (needs the attach's pod `apiUrl`, from
 * `CreateAgentBrowserSession`) — throws a clear error otherwise rather than
 * silently falling back to the local path.
 */
import { badRequest } from '@hapi/boom'
import assert from 'node:assert'
import type { ConfigStore } from '../../../config/store.ts'
import { popcornProve } from '../../../proof/pod-prover.ts'
import { buildHttpParams } from '../../../proof/proof-core.ts'
import { defineTool, type RegisteredTool } from '../../server.ts'
import type { AttachState } from './attach.ts'
import type { CaptureStore } from './capture.ts'
import { shapeRichProofResult } from './proof.ts'

export function podProofTools(
	attachRef: { current?: AttachState, config: ConfigStore },
	captures: CaptureStore,
): RegisteredTool[] {
	const tool = defineTool<{ captureId: string, draftId: string }>(
		{
			name: 'run_proof_via_pod',
			description:
				'Proves the drafted recipe through the remote browser pod\'s own '
				+ 'TEE (/reclaim/prove) instead of the local attestor SDK. Use it '
				+ 'instead of `run_proof` when the attach mode is "builder": the '
				+ 'proof then reaches the target from the browser\'s own exit IP and '
				+ 'country. Needs no `ownerAddress`; the pod signs with its own TEE '
				+ 'key. It matches the browser\'s exit IP and country, not '
				+ 'necessarily its TLS fingerprint, so it is not a way past bot '
				+ 'protection: if `run_proof` reported '
				+ '`blocked-non-browser-client`, expect the same here.',
			inputSchema: {
				type: 'object',
				properties: {
					captureId: { type: 'string' },
					draftId: { type: 'string' },
				},
				required: ['captureId', 'draftId'],
			},
			annotations: { openWorldHint: true, destructiveHint: false },
		},
		async({ captureId, draftId }) => {
			const apiUrl = attachRef.current?.apiUrl
			assert(
				apiUrl,
				badRequest(
					'No pod api available for this attach — run_proof_via_pod needs '
					+ 'mode "builder" (attach_browser), not local/custom CDP.',
				),
			)

			const entry = captures.sessions.get(captureId)
			assert(
				entry,
				badRequest(
					`no capture ${captureId} — call start_capture first `
					+ '(it has been reset or never started).',
				),
			)

			const draft = entry.drafts.get(draftId)
			assert(draft, badRequest(`no draft ${draftId} in capture ${captureId}`))

			const result = await popcornProve({
				apiUrl,
				params: buildHttpParams(draft.provider),
				secretParams: { headers: draft.secrets },
			})

			return shapeRichProofResult(result, {
				provider: draft.provider,
				hasSecrets: Object.keys(draft.secrets).length > 0,
				...(draft.lastReplay ? { lastReplay: draft.lastReplay } : {}),
			})
		},
	)

	return [tool]
}
