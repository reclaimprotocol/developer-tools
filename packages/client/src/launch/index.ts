/**
 * `@reclaimprotocol/client/launch` — a browser-only, credential-free
 * launcher. Given a Builder `verificationUrl`, `ReclaimFlow` works out how
 * to open it on this device (browser extension handoff, native app deep
 * link/App Clip, portal/builder tab or iframe, or a QR modal) and hands
 * back a `FlowHandle` to tear the UI down again.
 *
 * See `devtools/plans/client-launch-api.md` for the design this implements.
 */
export {
	ReclaimFlow,
	ReclaimFlowUnavailableError,
	isReclaimFlowUnavailableError,
} from './flow.ts'
export type {
	DetectionConfidence,
	DeviceKind,
	FlowHandle,
	FlowInput,
	FlowOptions,
	LaunchMechanism,
	ReclaimFlowUnavailableReason,
	ResolvedTarget,
	VerificationTarget,
} from './flow.ts'
export { showQrModal } from './modal.ts'
export type { ModalHandle, ModalOptions } from './modal.ts'
export type { RenderQr } from './qr.ts'
export { defaultEnvironment } from './environment.ts'
export type {
	LaunchClipboard,
	LaunchContainer,
	LaunchDocument,
	LaunchElement,
	LaunchEnvironment,
	LaunchMessageEvent,
	LaunchNavigator,
	LaunchStyleDeclaration,
	LaunchUserAgentData,
	LaunchWindow,
	LaunchWindowHandle,
} from './environment.ts'
