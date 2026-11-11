# Plan: let users prove "{{goal}}" in this app with a Builder AI session

Follow this plan end to end. Mark each step done as you go. Do not ask the developer whether to integrate: integrating into this codebase is the goal.

An AI session needs no provider. The user prompt and data points tell Builder what to prove, and Builder finds the site and the login page. Only the portals verification client supports AI sessions today, so omit `verificationClientUrl` (portals is the default). Start with the steps that need the developer (sign in, try a session), and write app code while you wait.

**Asking the developer.** When you need an answer or an action, end your turn with the question. Don't use background or asynchronous question tools: the developer may never see them. Put every link they need in that same message. Ask each question once.

## 1. Sign in and pick the organization

- [ ] Call `reclaim_authenticate` if you are not signed in. Give the developer the returned `signInUrl` to approve in their browser (end your turn first if `browserOpened` is false), then call `wait_for_sign_in`.
<!-- if:orgId -->
- [ ] Use organization `{{orgId}}` for every call below.
<!-- endif -->
<!-- ifnot:orgId -->
- [ ] Call `list_orgs`. Use the only organization, or ask the developer which one when there are several.
<!-- endif -->

## 2. Get an org token

- [ ] If `RECLAIM_ORG_SECRET` is not in the server env file, call `issue_org_token` with the organization, this project's absolute path, and the server env file. It writes the key to that file and never returns it. Never print or commit the key, and confirm the env file is in `.gitignore`.

## 3. Make sure results have a destination

- [ ] Call `list_callback_subscriptions`. If the organization has none, call `create_callback_subscription` for the session-ending events: `verification_success`, `verification_rejected`, `verification_error`, `verification_cancelled`, and `session_expired`.
- [ ] For local development, start the app's backend and call `proxy_callback_events({ port, path })` with the callback route's port and path. It forwards the org's verification events to that route on localhost, with no public URL. The proxy works only while this coding agent's MCP server runs.
- [ ] For production, ask the developer for the public callback URL, and call `create_org_callback_subscription` with it. If they have no deployed URL yet, tell them: "When you deploy, ask me to run `create_org_callback_subscription` with your public callback URL, or results will not reach the app."

## 4. Read the guide

- [ ] Call `how_it_works({ topic: "ai-sessions" })` and follow it for request fields, session states, and error codes. Don't repeat its detail here.

## 5. Try a session

- [ ] Call `create_ai_verification_session` with:
  - `prompt`: a sentence for "{{goal}}", written as the claim to prove.
  - `dataPoints`: the values the claim needs. Mark one identifier required. Mark the others optional. Add no profile or identity extras.
  - `loginUrls`: the site's sign-in URLs, when you know them.
- [ ] Call `wait_for_ai_session` with the returned session ID, until the lookup is ready.
- [ ] Share the returned `verificationUrl` with the developer, in the same message as the ask: "Open this link, sign in to the site, and tell me when you are done." End your turn.
- [ ] After they reply, call `wait_for_ai_session` until the session reaches a terminal status. Use `read_callback_events({ sessionId })` to see the delivered result.
- [ ] The hosted verification page streams the target site as an image, so text or DOM checks of that page come back empty. Check progress with `wait_for_ai_session`, `list_verification_events`, and `get_verification_session`, not by reading the page.

## 6. Write the backend integration

Write this while you wait on the developer. Don't let it delay a step that needs them.

- [ ] Detect the app's framework and package manager from the repository, and use them. Read `how_it_works({ topic: "integration" })`.
- [ ] Add a backend route that calls `POST /verifications/ai-sessions` server-side, with the same prompt, data points, and login URLs as step 5, and returns `verificationUrl`. Never call it from the browser: it needs the org key.
- [ ] Add a callback route that verifies each result with `reclaim.results.receive` from `@reclaimprotocol/client` version 0.1.44 or later, then stores only the requested data points. Store every failure on the verification session record and log it server-side. Respond `error.retryable ? 503 : 200`. A result that failed verification gets 2xx, because retrying can't fix it.
- [ ] Add a status route the frontend polls, and a frontend Verify button that opens `verificationUrl`. Render every state in "UI states" in `how_it_works({ topic: "integration" })`, including **Try again** on failure.
- [ ] If the org has a key pair (`get_org_keypair`), pass `orgEthPrivateKey` from `RECLAIM_ORG_ETH_PRIVATE_KEY` to `results.receive`. The developer puts that key in the env file, never in chat.
- [ ] If a permission check blocks a command, follow "Permission blocks" in the server instructions.

## 7. Fall back to a provider when the session cannot work

- [ ] If `wait_for_ai_session` recommends a fallback, adjust the `dataPoints` or `loginUrls` as its result suggests and create one more session.
- [ ] If the retry also recommends a fallback, call `start_integration` with `route: "provider"` and the same `goal`, and follow the plan it returns. Keep the backend work from step 6: the provider plan reuses the callback route.
