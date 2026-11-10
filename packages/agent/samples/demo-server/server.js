import express from "express";
import { rateLimit } from "express-rate-limit";
import "dotenv/config";
import { ReclaimProofRequest, verifyProof } from "@reclaimprotocol/js-sdk";
import { randomUUID } from "node:crypto";

const app = express();
const port = process.env.PORT || 3000;
const providerId = __PROVIDER_ID__;
// Left unpinned by default — set this if you need to pin a specific version.
const providerVersion = __PROVIDER_VERSION__;

// One proxy hop (ngrok or a load balancer), so the rate limit below keys on
// the client's address rather than the proxy's.
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
// Every route verifies or creates something; cap each client's request rate.
app.use(rateLimit({ windowMs: 60_000, limit: 60 }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/verify", (_req, res) => {
  res.type("html").send(`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Reclaim demo verification</title>
        <style>
          body {
            font-family: system-ui, sans-serif; max-width: 680px;
            margin: 64px auto; padding: 0 20px; line-height: 1.5;
          }
          code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
          button {
            background: #111827; border: 0; border-radius: 8px; color: white;
            cursor: pointer; font: inherit; padding: 12px 18px;
          }
          button:disabled { cursor: wait; opacity: 0.7; }
          pre {
            background: #f3f4f6; border-radius: 8px; overflow: auto;
            padding: 12px;
          }
        </style>
      </head>
      <body>
        <h1>Reclaim demo verification</h1>
        <p>Uses provider <code>${providerId}</code>.</p>
        <button id="start">Start verification</button>
        <pre id="status">Ready.</pre>
        <p>Webhook endpoint: <code>/webhooks/reclaim</code></p>
        <script>
          const button = document.getElementById("start");
          const status = document.getElementById("status");
          button.addEventListener("click", async () => {
            button.disabled = true;
            status.textContent = "Creating verification request...";
            try {
              const response = await fetch("/api/reclaim/request", {
                method: "POST",
              });
              if (!response.ok) throw new Error(await response.text());
              const { requestUrl } = await response.json();
              status.textContent = "Opening Reclaim verification...";
              window.open(requestUrl, "_blank", "noopener,noreferrer");
              status.textContent =
                "Verification opened. Complete it in the Reclaim window.";
            } catch (error) {
              status.textContent =
                error instanceof Error ? error.message : String(error);
              button.disabled = false;
            }
          });
        </script>
      </body>
    </html>`);
});

app.post("/api/reclaim/request", async (req, res, next) => {
  try {
    const appId = process.env.RECLAIM_APP_ID;
    const appSecret = process.env.RECLAIM_APP_SECRET;
    if (!appId || !appSecret) {
      return res.status(500).json({
        error: "Missing RECLAIM_APP_ID or RECLAIM_APP_SECRET",
      });
    }

    const origin =
      process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
    const reclaimProofRequest = await ReclaimProofRequest.init(
      appId,
      appSecret,
      providerId,
      { providerVersion },
    );
    reclaimProofRequest.setAppCallbackUrl(
      `${origin}/webhooks/reclaim`,
      true,
    );
    reclaimProofRequest.setContext(
      randomUUID(),
      JSON.stringify({ createdAt: new Date().toISOString() }),
    );

    // getRequestUrl() is ASYNC in the current SDK — must be awaited.
    const requestUrl = await reclaimProofRequest.getRequestUrl();

    res.json({
      request: reclaimProofRequest.toJsonString(),
      requestUrl,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/webhooks/reclaim", async (req, res, next) => {
  try {
    // With jsonProofResponse: true + express.json() above, req.body is
    // already a parsed Proof/Proof[]. Without either of those, the raw body
    // is text and must be JSON.parse()'d (and URL-decoded if form-encoded)
    // before calling verifyProof.
    const proof = req.body;

    // The second argument is REQUIRED — must include providerId.
    const result = await verifyProof(proof, { providerId, providerVersion });

    console.log("Received Reclaim verification:");
    console.log(JSON.stringify(
      { isVerified: result.isVerified, data: result.data, error: result.error },
      null,
      2,
    ));

    res.status(200).json({ received: true, verified: result.isVerified });
  } catch (error) {
    next(error);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    error: err instanceof Error ? err.message : "Internal server error",
  });
});

app.listen(port, () => {
  console.log(`Reclaim demo server listening on http://localhost:${port}`);
  console.log(`Verify page:      http://localhost:${port}/verify`);
  console.log(`Webhook endpoint: http://localhost:${port}/webhooks/reclaim`);
  if (!process.env.PUBLIC_URL) {
    console.log(
      "Set PUBLIC_URL (e.g. an ngrok URL) so the webhook is reachable " +
      "from Reclaim's servers.",
    );
  }
});
