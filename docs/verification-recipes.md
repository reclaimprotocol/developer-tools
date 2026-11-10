# Verification recipes for agents

These are request templates, not assertions that a particular source or institution is supported. A person must review the request and sign in to an account that contains the requested evidence.

| Need | Request | Minimum useful data |
| --- | --- | --- |
| Student access | Verify current enrollment through the official university portal | Student identifier and enrollment status; only request other fields if needed |
| Employment | Verify current employment from the employer's HR portal | Employee identifier, employer, and current status |
| Income | Verify income recorded by a payroll or earnings account | Account identifier, amount, currency, and period |
| Purchase eligibility | Verify a purchase through the merchant account | Order reference and the relevant purchase attributes |
| Loyalty status | Verify a membership tier through the issuer's account | Member identifier, tier, and validity where recorded |
| Account ownership | Verify the logged-in account identifier | The exact account identifier relevant to the workflow |

Use Builder AI sessions for product integrations. For a workflow, create a Letters verification link with immutable fields and extraction instructions, and share the complete returned URL. Omit an unknown login URL so the recipient can provide it. Account holders perform sign-in themselves.

A request being created, a browser redirect, an email address, and a model's judgment are not verified source evidence. Check the signed evidence and source before applying your own eligibility rules.
