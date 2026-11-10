/**
 * MCP server instructions shown to the LLM when running in OLD-devtools mode
 * (`USE_OLD_DEVTOOLS=true` or `1`). Describes the REDUCED tool
 * surface — there are no org/credential-link/review flows and no generated
 * API tools here. Both modes' instructions load together in
 * `mcp/instructions` (alongside the topic-split authoring guide); re-exported
 * here so old-mode callers keep importing from their own module.
 */
export { OLD_MODE_INSTRUCTIONS } from '../mcp/instructions.ts'
