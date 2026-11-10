// Package entry — SDK re-exports + agent public API.
// The MCP server bin lives at ./mcp-bin.ts.

// SDK — re-export everything from @reclaimprotocol/client so consumers
// only need one package for both the typed HTTP client and the agent tools.
export * from '@reclaimprotocol/client'

// Agent — Chrome CDP capture, provider synthesis, replay, proof.
export { buildAgentTools } from './mcp/tools/agent/index.ts'
export type { AgentState } from './mcp/tools/agent/index.ts'
