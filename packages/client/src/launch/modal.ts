/**
 * The desktop `verifier-app` mechanism: a dependency-free QR dialog over the
 * share URL, with the QR itself bundled (see ./qr.ts).
 *
 * The layout follows the reference JS SDK's `utils/modalUtils.ts`
 * `QRCodeModal` — same card, same close affordance, same countdown and
 * progress bar along the bottom — so a consumer moving from `reclaim-js-sdk`
 * sees the dialog they already know. Two things differ on purpose: the QR is
 * an inline SVG from the vendored encoder rather than a `qrcode` dependency,
 * and the countdown can be switched off entirely, because a dialog that
 * closes itself under a claimant who is still reaching for their phone is
 * worse than one that waits.
 */
import type {
	LaunchDocument,
	LaunchElement,
	LaunchEnvironment,
	LaunchKeyboardEvent,
	LaunchMouseEvent,
	LaunchStyleDeclaration,
} from './environment.ts'
import type { RenderQr } from './qr.ts'
import { defaultRenderQr } from './qr.ts'

export interface ModalOptions {
	title?: string
	description?: string
	darkTheme?: boolean
	/**
	 * Seconds to keep the dialog open before closing it on the claimant's
	 * behalf, shown as a countdown and a draining progress bar.
	 *
	 * Pass `0` (or `Infinity`) to keep it open until something closes it —
	 * `handle.close()`, the close button, the backdrop, or Escape. The
	 * countdown and bar are then omitted rather than frozen, since a timer
	 * that never moves reads as broken.
	 */
	autoCloseSeconds?: number
	/** Shows the "install the extension" tip, linking here. */
	extensionUrl?: string
	/** Called once, whenever and however the dialog closes. */
	onClose?(): void
}

export interface ModalHandle {
	close(): void
	/** Seconds left before the dialog closes itself, or `null` when it is
	 *  waiting indefinitely. Reads `0` once closed. */
	readonly remainingSeconds: number | null
}

const DEFAULT_TITLE = 'Verify with Reclaim'
const DEFAULT_DESCRIPTION
	= 'Scan the QR code with your phone to complete verification.'
const DEFAULT_AUTO_CLOSE_SECONDS = 60
const MODAL_FONT_FAMILY
	= '-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif'
const TICK_MS = 1000

/**
 * Opens the dialog and returns the handle that closes it again.
 *
 * Exported from the package root as well as used by `launch()`, so a consumer
 * who only wants a QR over a share link can open one directly without going
 * through flow resolution.
 */
export function showQrModal(
	env: LaunchEnvironment,
	url: string,
	options: ModalOptions & { renderQr?: RenderQr } = {},
): ModalHandle {
	const doc = env.document
	const body = doc?.body
	if(!doc || !body) {
		return { close() {}, remainingSeconds: null }
	}

	// Captured with its narrowed type: `close` below is a hoisted function
	// declaration, and TypeScript will not carry a narrowing into one.
	const activeDoc: LaunchDocument = doc
	const theme = themeFor(!!options.darkTheme)
	const total = normalizeSeconds(options.autoCloseSeconds)
	let remaining = total
	let closed = false
	let timer: unknown

	const overlay = doc.createElement('div')
	setStyle(overlay, {
		position: 'fixed', inset: '0', display: 'flex', alignItems: 'center',
		justifyContent: 'center', padding: '16px', boxSizing: 'border-box',
		background: theme.backdrop, zIndex: '2147483647',
	})

	const card = doc.createElement('div')
	card.setAttribute('role', 'dialog')
	card.setAttribute('aria-modal', 'true')
	card.setAttribute('aria-label', options.title ?? DEFAULT_TITLE)
	setStyle(card, {
		position: 'relative', background: theme.card, color: theme.title,
		borderRadius: '12px', padding: '32px', maxWidth: '400px', width: '100%',
		boxSizing: 'border-box', textAlign: 'center',
		fontFamily: MODAL_FONT_FAMILY, boxShadow: theme.shadow,
	})
	overlay.appendChild(card)

	card.appendChild(closeButton(doc, theme, () => close()))

	const title = doc.createElement('h2')
	title.innerHTML = escapeHtml(options.title ?? DEFAULT_TITLE)
	setStyle(title, {
		margin: '0 0 16px 0', fontSize: '24px', fontWeight: '600',
		color: theme.title,
	})
	card.appendChild(title)

	const description = doc.createElement('p')
	description.innerHTML = escapeHtml(options.description ?? DEFAULT_DESCRIPTION)
	setStyle(description, {
		margin: '0 0 24px 0', fontSize: '14px', lineHeight: '1.5',
		color: theme.text,
	})
	card.appendChild(description)

	const qrSlot = doc.createElement('div')
	setStyle(qrSlot, {
		margin: '0 auto 24px auto', display: 'inline-block', padding: '8px',
		background: theme.qr, borderRadius: '8px',
	})
	card.appendChild(qrSlot)
	void (options.renderQr ?? defaultRenderQr)(url, qrSlot)

	if(options.extensionUrl) {
		card.appendChild(extensionTip(doc, theme, options.extensionUrl))
	}

	const copyLink = doc.createElement('button')
	copyLink.setAttribute('type', 'button')
	copyLink.innerHTML = 'Copy link'
	setStyle(copyLink, {
		background: theme.button, color: theme.buttonText, border: 'none',
		borderRadius: '6px', padding: '8px 16px', fontSize: '13px',
		cursor: 'pointer',
	})
	card.appendChild(copyLink)
	copyLink.addEventListener('click', () => {
		void env.navigator?.clipboard?.writeText(url).catch(() => {})
	})

	// Only built when there is a countdown to show. An unmoving timer and a
	// full progress bar would both claim something is being measured.
	let countdownText: LaunchElement | undefined
	let progressBar: LaunchElement | undefined
	if(total !== null) {
		const wrap = doc.createElement('div')
		setStyle(wrap, { marginTop: '16px' })

		countdownText = doc.createElement('div')
		setStyle(countdownText, {
			fontSize: '12px', color: theme.countdown, marginBottom: '8px',
		})
		wrap.appendChild(countdownText)

		const track = doc.createElement('div')
		setStyle(track, {
			width: '100%', height: '4px', backgroundColor: theme.progressTrack,
			borderRadius: '2px', overflow: 'hidden',
		})
		progressBar = doc.createElement('div')
		setStyle(progressBar, {
			width: '100%', height: '100%', background: theme.progressFill,
			borderRadius: '2px', transition: 'width 1s linear',
		})
		track.appendChild(progressBar)
		wrap.appendChild(track)
		card.appendChild(wrap)
	}

	overlay.addEventListener('click', onBackdropClick)
	doc.addEventListener('keydown', onKeydown)
	body.appendChild(overlay)

	if(total !== null) {
		renderCountdown()
		timer = env.setTimeout(tick, TICK_MS)
	}

	return {
		close,
		get remainingSeconds() {
			return remaining
		},
	}

	function tick() {
		if(closed || remaining === null) {
			return
		}

		remaining -= 1
		renderCountdown()
		if(remaining <= 0) {
			close()
			return
		}

		timer = env.setTimeout(tick, TICK_MS)
	}

	function renderCountdown() {
		if(remaining === null || total === null) {
			return
		}

		const minutes = Math.floor(remaining / 60)
		const seconds = remaining % 60
		if(countdownText) {
			countdownText.innerHTML = escapeHtml(
				`Closes in ${minutes}:${String(seconds).padStart(2, '0')}`,
			)
		}

		if(progressBar) {
			progressBar.style.width = `${Math.max(0, remaining / total) * 100}%`
		}
	}

	// `e.target === overlay` is what separates a click on the backdrop from
	// one that bubbled up out of the card — without it, every click inside
	// the dialog would close it.
	function onBackdropClick(event?: LaunchMouseEvent) {
		if(!event || event.target === overlay) {
			close()
		}
	}

	function onKeydown(event: LaunchKeyboardEvent) {
		if(event.key === 'Escape') {
			close()
		}
	}

	function close() {
		if(closed) {
			return
		}

		closed = true
		remaining = total === null ? null : 0
		if(timer !== undefined) {
			env.clearTimeout(timer)
			timer = undefined
		}

		overlay.removeEventListener('click', onBackdropClick)
		activeDoc.removeEventListener('keydown', onKeydown)
		overlay.remove()
		options.onClose?.()
	}
}

/** `undefined` means the default countdown; `0`/negative/non-finite means
 *  wait indefinitely, which the caller sees as `null` throughout. */
function normalizeSeconds(value: number | undefined): number | null {
	const seconds = value ?? DEFAULT_AUTO_CLOSE_SECONDS
	if(!Number.isFinite(seconds) || seconds <= 0) {
		return null
	}

	return Math.ceil(seconds)
}

function closeButton(
	doc: LaunchDocument,
	theme: ModalTheme,
	onClick: () => void,
): LaunchElement {
	const button = doc.createElement('button')
	button.setAttribute('type', 'button')
	button.setAttribute('aria-label', 'Close')
	button.setAttribute('title', 'Close')
	setStyle(button, {
		position: 'absolute', top: '16px', right: '16px', width: '32px',
		height: '32px', background: 'none', border: 'none', cursor: 'pointer',
		borderRadius: '6px', display: 'flex', alignItems: 'center',
		justifyContent: 'center', padding: '4px',
	})
	button.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" '
		+ 'fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
		+ `<path d="M12 4L4 12M4 4L12 12" stroke="${theme.buttonText}" `
		+ 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
		+ '</svg>'
	button.addEventListener('click', onClick)
	return button
}

function extensionTip(
	doc: LaunchDocument,
	theme: ModalTheme,
	extensionUrl: string,
): LaunchElement {
	const tip = doc.createElement('div')
	setStyle(tip, {
		marginBottom: '24px', padding: '16px', background: theme.tip,
		border: `1px solid ${theme.tipBorder}`, borderRadius: '8px',
		textAlign: 'left',
	})
	tip.innerHTML = '<p style="margin:0 0 8px 0;font-size:14px;font-weight:500;'
		+ `color:${theme.tipText}">For a faster route</p>`
		+ '<p style="margin:0 0 12px 0;font-size:13px;line-height:1.4;'
		+ `color:${theme.tipText}">Install the browser extension to verify `
		+ 'here, without a phone.</p>'
		+ `<a href="${escapeHtml(extensionUrl)}" target="_blank" `
		+ 'rel="noopener noreferrer" style="display:inline-block;'
		+ `background:${theme.accent};color:#fff;text-decoration:none;`
		+ 'padding:8px 16px;border-radius:6px;font-size:12px;font-weight:500">'
		+ 'Install extension</a>'
	return tip
}

interface ModalTheme {
	backdrop: string
	card: string
	shadow: string
	title: string
	text: string
	qr: string
	button: string
	buttonText: string
	countdown: string
	progressTrack: string
	progressFill: string
	tip: string
	tipBorder: string
	tipText: string
	accent: string
}

function themeFor(dark: boolean): ModalTheme {
	return dark
		? {
			backdrop: 'rgba(0,0,0,0.8)', card: '#1f2937',
			shadow: '0 20px 25px -5px rgba(0,0,0,0.5)',
			title: '#f9fafb', text: '#d1d5db', qr: '#374151',
			button: '#374151', buttonText: '#f9fafb', countdown: '#6b7280',
			progressTrack: '#4b5563',
			progressFill:
				'linear-gradient(90deg,#3b82f6 0%,#2563eb 50%,#1d4ed8 100%)',
			tip: '#1e3a8a', tipBorder: '#1e40af', tipText: '#dbeafe',
			accent: '#2563eb',
		}
		: {
			backdrop: 'rgba(0,0,0,0.5)', card: '#fff',
			shadow: '0 20px 25px -5px rgba(0,0,0,0.1),'
				+ '0 10px 10px -5px rgba(0,0,0,0.04)',
			title: '#1f2937', text: '#6b7280', qr: '#f9fafb',
			button: '#f3f4f6', buttonText: '#374151', countdown: '#9ca3af',
			progressTrack: '#e5e7eb',
			progressFill:
				'linear-gradient(90deg,#2563eb 0%,#1d4ed8 50%,#1e40af 100%)',
			tip: '#f0f9ff', tipBorder: '#e0f2fe', tipText: '#0369a1',
			accent: '#2563eb',
		}
}

/** Every property `LaunchStyleDeclaration` declares is a real
 *  `CSSStyleDeclaration` property name, so this needs no cast — unlike a
 *  generic `Record<string, string>` target, which would. */
function setStyle(el: LaunchElement, declarations: LaunchStyleDeclaration) {
	Object.assign(el.style, declarations)
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}
