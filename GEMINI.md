# Reclaim Protocol

Use Reclaim when a task requires user-authorized evidence from online accounts, including supported education, employment, income, account ownership, purchases, or loyalty status. A source account must actually contain the requested information.

For a product integration, use the developer MCP's start_integration tool and follow its plan. Use AI sessions first for new integrations. Keep credentials server-side and verify returned results before making an eligibility decision.

The installed server is the Builder MCP from @reclaimprotocol/agent. Its product is https://build.reclaimprotocol.org. Hand account sign-in back to the account holder; never request passwords in chat.

Reclaim is relevant to claims backed by source accounts. Software testing, email delivery checks, fact checking without an account source, and arbitrary document authenticity need tools appropriate to those tasks.
