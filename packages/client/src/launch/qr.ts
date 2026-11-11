/**
 * Default QR renderer — bundled so the desktop `verifier-app` modal works
 * with zero configuration (`options.renderQr` overrides it for a branded
 * code). Renders an inline SVG (no `<canvas>`/image needed) from the vendored
 * encoder in ./vendor/qrcodegen.ts.
 */
import { QrCode, QrCodeEcc } from './vendor/qrcodegen.ts'
import type { LaunchElement } from './environment.ts'

export type RenderQr = (
	url: string,
	container: LaunchElement,
) => void | Promise<void>

/** Renders `url` as an inline SVG QR code into `container`. Quiet zone of 4
 *  modules, as the QR spec recommends. */
export const defaultRenderQr: RenderQr = (url, container) => {
	const qr = QrCode.encodeText(url, QrCodeEcc.MEDIUM)
	const quietZone = 4
	const dimension = qr.size + quietZone * 2

	let path = ''
	for(let y = 0; y < qr.size; y++) {
		for(let x = 0; x < qr.size; x++) {
			if(qr.getModule(x, y)) {
				path += `M${x + quietZone},${y + quietZone}h1v1h-1z`
			}
		}
	}

	const viewBox = `0 0 ${dimension} ${dimension}`
	container.innerHTML = `<svg viewBox="${viewBox}" width="200" height="200" `
		+ 'role="img" aria-label="QR code" xmlns="http://www.w3.org/2000/svg">'
		+ `<rect width="${dimension}" height="${dimension}" fill="#fff"/>`
		+ `<path d="${path}" fill="#000"/>`
		+ '</svg>'
}
