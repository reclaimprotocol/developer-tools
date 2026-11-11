# Plan: let users prove "{{goal}}" in this app

This is the provider route: the fallback when a Builder AI session cannot prove the claim, or the route you chose explicitly.

Follow this plan end to end. Mark each step done as you go. Do not ask the developer whether to integrate: integrating into this codebase is the goal.

**Order.** Do the steps that need the developer first: sign in to Builder, attach the browser, capture, and prove the provider (step 2). These need the developer at the browser, and they show early whether a proof is possible on this site. Write app code (step 3) after the proof works, or while you wait on the developer. Never spend a long stretch on app code before the developer has signed in and the browser is attached.

**Asking the developer.** When you need an answer or an action, end your turn with the question. Don't use background or asynchronous question tools: the developer may never see them. Put every link they need in that same message. Ask each question once.

## 1. Sign in and pick the organization

- [ ] Call `reclaim_authenticate` if you are not signed in. Give the developer the returned `signInUrl` to approve in their browser (end your turn first if `browserOpened` is false), then call `wait_for_sign_in`.
<!-- if:orgId -->
- [ ] Use organization `{{orgId}}` for every call below.
<!-- endif -->
<!-- ifnot:orgId -->
- [ ] Call `list_orgs`. Use the only organization, or ask the developer which one when there are several.
<!-- endif -->
- [ ] Call `get_org_keypair`. If the org has a key pair (any `canEncryptResult`), the app's callback must pass `orgEthPrivateKey` to `results.receive`: it decrypts encrypted results and verifies TEE-bound proofs. In the same message as any other step 1 question, ask the developer to choose one: reuse the existing key (they put its private key in the app's server env file as `RECLAIM_ORG_ETH_PRIVATE_KEY` themselves, never in chat), or rotate it (`issue_org_keypair` with `replace: true`; other apps holding the old key stop working with new results). If `canEncryptResult` is true, they can also turn encryption off with `update_org_keypair({ orgId, canEncryptResult: false })`, which keeps the key. Name the exact action in your question. Act on the answer in step 3.

## 2. Get the provider and prove it

<!-- if:providerIds -->
- [ ] Use these existing providers: {{providerIds}}. Read each with `get_provider` and keep only the data points "{{goal}}" needs. Show the developer and use only those; ignore the rest.
- [ ] If a provider needs any change (a missing data point, inputs the developer didn't ask for, a different value), make your own copy as the server instructions describe ("Choose the provider"). Otherwise go on to step 3.
<!-- endif -->
<!-- ifnot:providerIds -->
Build a new organization-private provider for exactly "{{goal}}". Do not search published providers first.

- [ ] Call `check_attestor` once. If it fails, tell the developer before they spend time on the provider build: this machine cannot reach the attestor.
- [ ] If the site, the account, or the value to prove is unclear, ask one concise question. Otherwise do not ask.
- [ ] Choose the minimum data points: only the values the claim needs, usually one or two. Add no profile or identity extras.
- [ ] If the developer names an existing provider, use only the data points they asked for and ignore the rest. If it needs any change, make your own copy: a new version when the organization owns it, otherwise a new organization provider from a copy of its config.
- [ ] Call `how_it_works` with topics `overview`, `user-script`, `capture`, and `publish` before you start. Do not repeat their detail here.
- [ ] Call `attach_browser()` with no arguments. It opens a visible local browser, falling back to Chrome for Testing when no installed browser can be attached; don't ask which browser to use. Use another mode only if that fails too (topic `browser`). Mention once, as a side note, that a shareable link can be set up if a volunteer is helping the developer sign in; don't ask or set it up unless they ask. Use `start_capture` on the tab.
- [ ] Open the sign-in page with `navigate`. The developer signs in; use `wait_for_login`.
- [ ] Write the navigation script first. Signed out, it goes to the sign-in page. After sign-in, it visits each data page in order. It must stay correct across reloads.
- [ ] Test it with `test_user_script` and `keep: true`. The kept script stays installed for every later navigation and is published with the provider version.
- [ ] While the script drives the browser, find the request that returns each data point (`find_requests_containing`, then `analyze_request_constraints`).
- [ ] Call `propose_provider` with only the needed data points.
- [ ] Call `replay_request`, then `replay_request` with `withoutSecrets: true` to confirm the request is auth-bound.
- [ ] Call `run_proof`. It creates a local test signing key if none exists; tell the developer once afterwards.
- [ ] Call `create_provider_version_from_capture`. It publishes the kept script as `jsUserScripts`. Follow its `_notes`, then publish the version.
- [ ] Don't ask whether to close the browser. Mention once in your final summary that it stays open for provider changes and you can close it on request. Call `dispose_browser` only when the developer says so.
<!-- endif -->

## 3. Set up the app

Setup does not need the provider. Start it after step 2 has a working proof, or while you wait on the developer during step 2 (for example, while they sign in to the site). Don't let it delay a step that needs the developer.

**Delegation.** When the workspace already has an app and you can run subagents, hand this step to one subagent as soon as you are signed in, and keep working on step 2: step 2 needs the developer at the browser, step 3 does not. Give the subagent a self-contained brief:

```
Goal: let this app's users prove "{{goal}}" with Reclaim.
Repository: <absolute path>. Organization: <org ID>.
Task: do step 3 of the plan below and report the file paths you changed, the
callback route URL, and the env variable that holds the provider ID.
Do not build the provider. Never print or commit the org key.
<paste the step 3 checklist>
```

Without subagents, do step 2 first, and fill waits for the developer with this step.

**No app yet?** If the workspace has no app to add verification to (it is empty, or has no backend or frontend), don't write one. Bootstrap from [builder-example](https://github.com/reclaimprotocol/builder-example), a ready-to-run Fastify backend and Vite frontend that already create sessions, verify callbacks, poll status, and render every UI state:

Do this yourself, not in a subagent.

- [ ] Call `create_example_app` with the workspace root you were started in as `projectDir`. It writes the example there and sets its backend to the latest `@reclaimprotocol/client`. Don't clone the repository or create a subdirectory: commands you run inside a clone count as running external code, and permission checks may block them.
- [ ] Call `issue_org_token` with the same `projectDir` and `envFile: "packages/backend/.env"`.
- [ ] Key pair, by the step 1 answer. No key pair on the org and the developer wants none: skip. Reuse: the developer has put the key in `packages/backend/.env`. Rotate, or no key pair and the developer asks for binding or encrypted results: call `issue_org_keypair` with the same `projectDir` and `envFile` (`encryptResults: true` for encrypted results, `replace: true` to rotate). It writes `RECLAIM_ORG_ETH_PRIVATE_KEY` and backs up a replaced key to `<envFile>.backup`; tell the developer that path (never the key). Turn encryption off with `update_org_keypair`. The example's callback (`packages/backend/src/routes/callback.ts`) passes `RECLAIM_ORG_ETH_PRIVATE_KEY` to `reclaim.results.receive`; if it doesn't, add `orgEthPrivateKey: process.env.RECLAIM_ORG_ETH_PRIVATE_KEY` there. For session binding, also pass it to `reclaim.sessions.create` in `packages/backend/src/routes/verifications.ts`.
- [ ] From the workspace root, run `npm install`. Then follow the `next` array that `create_example_app` returned for the dev command, ports, log location, notes, and the `proxy_callback_events` call. Don't assume default ports.
- [ ] Run the dev server in the background with its output redirected to a log file, and read that file for backend output. Don't depend on the shell's own output.
- [ ] After you restart the backend, its in-memory store is empty. Ask the developer for a new verification; don't retry the old session.
- [ ] If a permission check blocks a command, follow "Permission blocks" in the server instructions.
- [ ] Skip the rest of this step. In step 4, the provider goes in `packages/backend/config.json`: replace the example entry with `{ "id": "<provider ID>", "name": "<what it proves>" }`, then restart the backend, because it reads the file at startup. Then ask for a new verification.

**Existing app.** Add verification to it:

- [ ] Detect the app's framework and package manager from the repository, and use them. Read `how_it_works({ topic: "integration" })`.
- [ ] Call `issue_org_token` with the organization, this project's absolute path, and the server env file. It writes the key to that file and never returns it; it backs up a replaced value to `<envFile>.backup`, so tell the developer that path. Never print or commit the key. Confirm the env file is in `.gitignore`.
- [ ] Add a backend route that creates a verification session (`POST /verifications/sessions`) and returns `verificationUrl`. Read the provider ID from server config (an env variable such as `RECLAIM_PROVIDER_ID`), so the route works before the provider exists.
- [ ] Key pair, by the step 1 answer. Reuse: the developer has put the key in the server env file. Rotate, or no key pair and the developer asks for binding or encrypted results: call `issue_org_keypair` with the server env file (`encryptResults: true` for encrypted results, `replace: true` to rotate). It backs up a replaced key to `<envFile>.backup`; tell the developer that path (never the key). Turn encryption off with `update_org_keypair`. Whenever the org has a key pair, pass `orgEthPrivateKey` from `RECLAIM_ORG_ETH_PRIVATE_KEY` to `sessions.create` and `results.receive`.
- [ ] Add a callback route that verifies each result with `results.receive` from `@reclaimprotocol/client`, then stores only the requested data points. Store every failure on the verification session record and log it server-side: a failure event (`verification_rejected`, `verification_error`, `verification_cancelled`, `session_expired`), or a thrown `ResultVerificationError` (`error.reason` plus each failing proof's `reason`). Respond `error.retryable ? 503 : 200`. A result that failed verification gets 2xx, because retrying can't fix it. Read the exact pattern in `how_it_works({ topic: "integration" })`.
- [ ] Add a status route the frontend polls. It returns the stored status, data points, and failure reason. While the app has no result, it also reads `GET /verifications/sessions/{sessionId}`, so a session that ended in Builder never stays pending.
- [ ] Add a frontend Verify button that opens `verificationUrl`, and render every state in "UI states" in `how_it_works({ topic: "integration" })`: idle, waiting in the other tab, verifying, verified (with the data points), failed (plain-language reason and **Try again**), and expired or cancelled (**Try again**). Never leave a spinner as the only feedback.
- [ ] Start the app in the background with output redirected to a log file. Call `proxy_callback_events({ port, path })` with the callback route's port and path. It forwards the org's verification events to that route on localhost, with no public URL.

## 4. Wire the provider and test end to end

- [ ] Set the provider ID in the app's server config.
- [ ] Confirm the callback route is forwarding: `proxy_callback_events` with no `stop` returns its status. If `blocked` is not empty, the app rejected that session's event: read the callback route's response and logs, fix the app, and check again.
- [ ] Tell the developer exactly how to test: open the app, click Verify, sign in, and see the stored result. Also test one failure, such as cancelling in the verification tab, and confirm the app shows the failed state with **Try again**.
- [ ] The hosted verification page streams the target site as an image, so text or DOM checks of that page come back empty. Check progress with `list_verification_events` and `get_verification_session`, not by reading the page.
- [ ] After they click Verify, read the delivered events from `proxy_callback_events` status (`recent`) or `read_callback_events`. If the result did not arrive, or the app shows an unexpected failure, call `list_verification_deliveries` and fix the cause. Repeat until the app shows the stored result.
- [ ] Ask the developer to set up the production callback. The local listener works only while this coding agent's MCP server runs; once it stops, the deployed app receives no results. Call `create_org_callback_subscription` with the deployed app's public callback route URL for all five session-ending events: `verification_success`, `verification_rejected`, `verification_error`, `verification_cancelled`, and `session_expired`.
- [ ] If they have no deployed URL yet, tell them: "When you deploy, ask me to run `create_org_callback_subscription` with your public callback URL, or results will not reach the app."
