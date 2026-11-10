# Reclaim demo server

1. `npm install`
2. Fill in `.env` (copy from `.env.example`) — get `RECLAIM_APP_ID`/
   `RECLAIM_APP_SECRET` from the `issue_app_credentials` MCP tool, or your
   existing app.
3. Set `PUBLIC_URL` in `.env` to a URL Reclaim's servers can reach — pick
   whichever fits:
   - **ngrok**: in a separate terminal, run `ngrok http 3000` (install it
     from the [ngrok site](https://ngrok.com) if needed) and copy the
     `https://<id>.ngrok-free.app` URL it prints.
   - **A development or staging server you can deploy to quickly**: if you
     already have one reachable from the internet, deploy this there and use
     its URL instead — no local tunnel needed.

   This step is REQUIRED: `localhost` is never reachable from Reclaim's
   servers.
4. `npm start`, then open http://localhost:3000/verify (or your deployed
   URL's `/verify`) and click "Start verification".
5. Watch the server logs for the `/webhooks/reclaim` payload once you
   complete verification.

This demo defaults to providerId `"example"` — a built-in smoke-test
provider, so you can confirm the whole loop (request → open → callback)
works before wiring in a real provider.
