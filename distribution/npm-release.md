# npm release prerequisite

The Builder MCP is published as @reclaimprotocol/agent. Its source is maintained in reclaimprotocol/builder; this public repository distributes client plugins, skills, and discovery metadata.

The agent package must publish this field:

```json
"mcpName": "io.github.reclaimprotocol/builder"
```

The source change is merged in Builder PR #99. Published version 0.1.45 does not include it. Use the Builder monorepo's existing version-bump and release process, publishing @reclaimprotocol/client before @reclaimprotocol/agent when their versions move together.

After release, run Publish Builder MCP registry metadata in this repository. It resolves the released npm version, confirms mcpName, checks MCP initialization and integration-tool discovery, validates server.json, and publishes using GitHub OIDC. It records a release blocker while npm lacks the required metadata.
