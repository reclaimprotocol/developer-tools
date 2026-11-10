import {
	checkAttestor,
	type CheckAttestorOptions,
} from '../../../proof/check-attestor.ts'
import { defineTool, type RegisteredTool } from '../../server.ts'

/** `check_attestor`: proves a public request to show whether the attestor
 *  works from this machine. `check` is injectable so tests need no network. */
export function checkAttestorTool(
	check: (opts: CheckAttestorOptions) => ReturnType<typeof checkAttestor>
		= checkAttestor,
): RegisteredTool {
	return defineTool<{ attestorUrl?: string }>(
		{
			name: 'check_attestor',
			description:
				'Checks that the Reclaim attestor works from this machine by proving '
				+ 'a public CoinGecko price request with a throwaway key. It uses no '
				+ 'credential, provider, or logged-in site, and takes up to 45 '
				+ 'seconds (about 8 when healthy). Call it once when you set up a '
				+ 'new provider build, and after `run_proof` fails with a network '
				+ 'error. Returns `{ ok, attestorUrl, durationMs, '
				+ 'extractedParameters, error, errorKind, proofFiles }`. '
				+ '`proofFiles` is the proof file download state: `{ status }` is '
				+ '`idle`, `ready`, `downloading` (with `method`, `elapsedMs`, and '
				+ '`bytesDownloaded`/`totalBytes` when known), or `failed` (with '
				+ '`reason`). If `ok` is true, the attestor is fine and a failing '
				+ 'proof points to the target site. If `errorKind` is '
				+ '`proof-files-downloading`, the one-time proof file download is '
				+ 'still running and the attestor was not contacted: call this tool '
				+ 'again shortly; do not report a network problem. If it is '
				+ '`proof-files-failed`, the download failed: tell the developer '
				+ '`error` (usually no access to github.com or '
				+ 'raw.githubusercontent.com). If it is `attestor-unreachable`, the '
				+ 'proof files are ready but this machine cannot reach the attestor '
				+ '(network, VPN, firewall, or proxy): tell the developer. If it is '
				+ '`setup-failed`, other local setup failed: report `error`. If it is '
				+ '`attestor-error`, the attestor rejected the claim: report '
				+ '`error`.',
			inputSchema: {
				type: 'object',
				properties: {
					attestorUrl: {
						type: 'string',
						description:
							'Attestor websocket URL. Set it only if the developer '
							+ 'supplied one; the default is the public attestor.',
					},
				},
			},
			annotations: { openWorldHint: true, readOnlyHint: true },
		},
		async({ attestorUrl }) => {
			return check(attestorUrl ? { attestorUrl } : {})
		},
	)
}
