/**
 * `share_browser_view` — gives the calling agent what it needs to put the
 * attached container browser's built-in viewer behind a public URL, so someone
 * who is not at this machine can watch it and optionally drive it.
 *
 * The server never runs, downloads or resolves cloudflared. The developer
 * chooses who runs it: they run it themselves (recommended) or approve the
 * agent running it. Either way the `trycloudflare.com` URL it prints comes
 * back as `publicUrl` to get the link to hand out.
 *
 * Scoped to `container` mode on purpose. A `builder`-mode browser already has
 * a hosted live view at `attach_browser`'s `liveViewUrl`.
 */
import { badRequest } from '@hapi/boom'
import assert from 'node:assert'
import { defineTool, type RegisteredTool } from '../../server.ts'
import { type AttachState, SHAREABLE_MODES } from './attach.ts'
import { ensureLiveViewUrl } from './live-view-url.ts'

/** Quick-tunnel hostnames only: `https://<words>.trycloudflare.com`. */
const QUICK_TUNNEL_HOST = /\.trycloudflare\.com$/i

export function liveViewTools(
	attachRef: { current?: AttachState },
): RegisteredTool[] {
	return [
		defineTool<{ publicUrl?: string }>(
			{
				name: 'share_browser_view',
				description:
					'Returns a link that lets someone who is not at this machine watch '
					+ 'and drive the attached `container` browser, for example to sign '
					+ 'in. This server opens no tunnel itself. Step 1: call with no '
					+ 'arguments. It returns the local viewer URL, the `cloudflared` '
					+ 'command, and two `choices`. Ask the developer to pick one before '
					+ 'any tunnel runs: (a, recommended) they run `! cloudflared tunnel '
					+ '--url http://localhost:<port>` themselves and paste the printed '
					+ '`https://*.trycloudflare.com` URL; (b) they explicitly approve '
					+ 'you running the command in the background. Never install '
					+ '`cloudflared` without approval. Step 2: call again with the URL '
					+ 'as `publicUrl` to get the link to relay. The link grants access '
					+ 'to that browser session only, so share it only with the person '
					+ 'who needs it. For `builder`, use the `liveViewUrl` from '
					+ '`attach_browser`.',
				inputSchema: {
					type: 'object',
					properties: {
						publicUrl: {
							type: 'string',
							description: 'The `https://*.trycloudflare.com` URL that '
								+ 'cloudflared printed.',
						},
					},
				},
				annotations: { openWorldHint: true, idempotentHint: true },
			},
			async(parsed) => {
				const attached = attachRef.current
				assert(attached, badRequest(
					'No browser attached. Call attach_browser first.',
				))
				const hostedViewUrl = attached.liveViewUrl
					? ensureLiveViewUrl(attached.liveViewUrl)
					: undefined
				assert(SHAREABLE_MODES.has(attached.mode), badRequest(
					`share_browser_view does not apply to \`${attached.mode}\` mode. `
					+ (hostedViewUrl
						? 'That browser already has a hosted live view — use the '
							+ `\`liveViewUrl\` from attach_browser: ${hostedViewUrl}`
						: 'That browser has no live view to put behind a URL. To let '
							+ 'someone else in, re-attach with mode "container" (the '
							+ 'Reclaim runtime in Docker — free, needs Docker) or '
							+ '"builder" (hosted, no install, chargeable)')
					+ '.',
				))

				// The container publishes its viewer on loopback and its full CDP
				// port beside it. Only the VIEWER may be exposed: the CDP port is
				// unauthenticated, total control of the browser.
				const viewerPort = attached.viewerPort
				assert(viewerPort, badRequest(
					'This browser reports no live-view port. Re-attach with mode '
					+ '"container".',
				))

				if(parsed.publicUrl) {
					const publicUrl = parseQuickTunnelUrl(parsed.publicUrl)
					return {
						url: ensureLiveViewUrl(publicUrl.origin),
						_notes: [
							'Relay `url` to the developer verbatim, on its own line.',
							'The URL is a credential: it needs no login, and anyone with '
							+ 'it can see this browser and act in it as the signed-in user.',
							'It shows the whole browser, so a sign-in that opens a '
							+ 'separate window is visible too.',
							'Opening it on a phone lays the page out for that phone, with '
							+ 'touch, pinch-zoom and the soft keyboard.',
							'When they are done, stop the cloudflared process: yourself if '
							+ 'you started it, otherwise ask the developer. The browser '
							+ 'keeps running until `dispose_browser`.',
						],
					}
				}

				const localUrl = `http://localhost:${viewerPort}`
				const command = `cloudflared tunnel --url ${localUrl}`
				return {
					localViewerUrl: ensureLiveViewUrl(localUrl),
					port: viewerPort,
					command,
					choices: [
						{
							id: 'developer-runs',
							recommended: true,
							action: `Run \`! ${command}\` in the prompt, then paste the `
								+ 'https://*.trycloudflare.com URL it prints.',
						},
						{
							id: 'agent-runs',
							recommended: false,
							action: 'Approve the agent to run the command in the '
								+ 'background and read the URL from its output.',
						},
					],
					_notes: [
						'Ask the developer to choose before any tunnel runs. Do not run '
						+ '`command` until they pick `agent-runs`.',
						'If they pick `developer-runs`, wait for the pasted URL. If they '
						+ 'pick `agent-runs`, run `command` in a background process and '
						+ 'read its output for a line containing '
						+ '`https://<words>.trycloudflare.com`.',
						'If `cloudflared` is not installed, tell the developer and ask '
						+ 'them to install it '
						+ '(https://developers.cloudflare.com/cloudflare-one/'
						+ 'connections/connect-networks/downloads/). Never install it '
						+ 'without their approval.',
						'Call share_browser_view again with the URL as `publicUrl` to get '
						+ 'the link to relay. Never guess or reconstruct the hostname.',
						'Expose only this port. Never tunnel the browser\'s CDP port.',
					],
				}
			},
		),
	]
}

function parseQuickTunnelUrl(value: string): URL {
	const url = URL.parse(value)
	assert(
		url?.protocol === 'https:' && QUICK_TUNNEL_HOST.test(url.hostname),
		badRequest(
			'publicUrl must be the https://*.trycloudflare.com URL printed by '
			+ 'cloudflared.',
		),
	)
	return url
}
