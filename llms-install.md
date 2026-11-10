# Install Reclaim Protocol for an agent

For coding agents integrating verification into an application:

```sh
npx -y --package=@reclaimprotocol/agent reclaim-mcp-server
```

Configure that command as a stdio MCP server. Node >=22.12 is required. Call start_integration for a new product integration and follow its plan. See README.md for client-specific plugin installation. Keep credentials on the server.

The product is https://build.reclaimprotocol.org. The MCP transport is local stdio through the published npm package, not a confirmed HTTPS endpoint at that domain. Do not substitute the separate Letters beta MCP for this Builder integration.

Validation performed by maintainers is recorded in distribution/receipts. Do not infer Cline, Cursor, Claude, or marketplace approval from a successful generic MCP connection.
