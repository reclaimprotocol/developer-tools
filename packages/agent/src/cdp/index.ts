// Capture pipeline shared with the app's remote-Popcorn transport:
// the transport-agnostic engine, the body store, and the local-CDP
// `startCapture`. Exposed as `@reclaimprotocol/agent/capture`.
export * from './capture-engine.ts'
export { startCapture } from './capture.ts'
export { BodyStore } from './eviction.ts'
export * from './geo.ts'
