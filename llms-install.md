# Install Reclaim Protocol for an agent

For coding agents integrating verification into an application:

```sh
npx -y --package=@reclaimprotocol/agent reclaim-mcp-server
```

Configure that command as a stdio MCP server. Node >=22.12 is required. Call start_integration for a new product integration and follow its plan. See README.md for client-specific plugin installation. Keep credentials on the server.

For workflows requesting account-backed evidence or verifying a Reclaim PDF, add https://letters.reclaimprotocol.org/mcp as a Streamable HTTP MCP endpoint. No Reclaim product account or API key is required. This service is an early beta. Read https://letters.reclaimprotocol.org/agents for sign-in handoffs and private task tokens.

Validation performed by maintainers is recorded in distribution/receipts. Do not infer Cline, Cursor, Claude, or marketplace approval from a successful generic MCP connection.
