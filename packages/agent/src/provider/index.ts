// Provider primitives shared with the app's capture pipeline:
// the attestor-derived recipe types, secret classification, and the GraphQL
// op parser. Exposed as `@reclaimprotocol/agent/provider`.
// Provider synthesis from a captured request (the `propose_provider` core):
// drafts the canonical responseMatches/redactions + paramValues + secret refs.
export { draftProvider } from './draft.ts'
export type { DraftResult } from './draft.ts'
export { detectConcerns } from './constraints.ts'
export { extractGraphqlOp, looksLikeGraphqlEndpoint } from './graphql.ts'
export type {
	CapturedRequest,
	HttpMethod,
	OprfMode,
	ReclaimProvider,
	RequestConcern,
	ResponseMatch,
	ResponseRedaction,
	SecretParamRef,
} from './schema.ts'
export {
	assertSecretParamValuesFitUrlBudget,
	classifyHeader,
	classifyParamName,
	secretUrlCharBudget,
	splitSecretParamValues,
	splitSecrets,
	stripTransportHeaders,
} from './secrets.ts'
// Recipe → version `requests[]` (a `RequestSelection`) — the same mapping the
// MCP publish uses, so the cloud authoring publish stays byte-identical.
export { providerToRequestSelection } from './to-version.ts'
// Re-exported attestor-core provider primitives (the registry, the param hash,
// and the param type) so the builder imports them via the agent rather than
// depending on @reclaimprotocol/attestor-core directly.
export { hashProviderParams, providers } from '@reclaimprotocol/attestor-core'
export type { ProviderParams } from '@reclaimprotocol/attestor-core'
