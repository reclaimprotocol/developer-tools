// Shared authoring tools, backend-injectable. Consumed by the MCP server
// (local Chrome + attestor backend) and the cloud loop (Popcorn + TEE backend).
export type {
	AuthoringBackend,
	Draft,
	DraftStore,
	KeptScript,
	KeptScriptRef,
	ProveOptions,
	SecretParams,
} from './backend.ts'
export { makeDraftStore } from './backend.ts'
export { authoringTools } from './tools.ts'
// The shared tool primitive — re-exported so consumers (the cloud loop) get the
// RegisteredTool type/`defineTool`/`extendTool` without importing the MCP
// subsystem.
export {
	defineTool,
	errorAsToolText,
	extendTool,
	type RegisteredTool,
	type ToolDefinition,
} from '../tools/registry.ts'
