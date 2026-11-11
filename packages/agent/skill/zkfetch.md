# zkFetch: prove a response your own server fetches

zkFetch (`@reclaimprotocol/zk-fetch`) fetches an HTTPS URL through a Reclaim
attestor and returns a proof of the response. Use it when the developer's
server fetches the data itself, for example a price API or an API called with
the developer's own key. No end user, browser, provider, or callback is
involved. For a claim about a user's account, use topic `ai-sessions` instead.

## Set up

1. Sign in (`get_me`, then `authenticate` on 401; topic `auth`) and pick the
   org with `list_orgs`.
2. Call `issue_org_token`. It writes `RECLAIM_ORG_SECRET` to the env file.
   Never print the key.
3. Install `@reclaimprotocol/zk-fetch@^2` and `@reclaimprotocol/client@^0.1.47`. Run
   zkFetch on a server only: the org key MUST NOT reach a browser.

Each `zkFetch` call draws one unit from the org's `ZKFETCH` quota, including a
call that fails after authorization.

## Prove and verify

When the workspace has no app, `create_example_app` writes builder-example,
whose `packages/zkfetch` holds this script.

```ts
import { hashProofClaimParams, verifyRequestProof } from '@reclaimprotocol/client'
import { ReclaimClient } from '@reclaimprotocol/zk-fetch'

const url = 'https://example.org/'
const regex = '<title>(?<title>[^<]*)</title>'

// Builder mode: an org key instead of an application id and secret.
const client = new ReclaimClient({ orgToken: process.env.RECLAIM_ORG_SECRET })
const proof = await client.zkFetch(
	url,
	{ method: 'GET' },
	{
		responseMatches: [{ type: 'regex', value: regex }],
		responseRedactions: [{ regex }],
	},
)

const result = await verifyRequestProof(proof, {
	hashes: [{
		value: hashProofClaimParams({
			url,
			method: 'GET',
			responseMatches: [{ type: 'regex', value: regex }],
			responseRedactions: [{ regex }],
		}),
	}],
})
// result.valid; result.data[0].extractedParameters.title
```

- `options` (second argument) is public and part of the proof. Put API keys,
  cookies, and other secrets in `secretOptions.headers`,
  `secretOptions.cookieStr`, or `secretOptions.paramValues`. They're never
  revealed.
- `responseRedactions` decides what the proof reveals. Redact to the named
  groups you need; without it, the proof reveals the whole response.
- Verify with `verifyRequestProof` from `@reclaimprotocol/client`, not
  `@reclaimprotocol/js-sdk`. Hash the exact URL, method, body, matches, and
  redactions the caller asked for. Headers aren't part of the hash.
- `verifyRequestProof` trusts the attestors in Builder's JWKS by default. Pass
  `attestorAddresses` to pin exact attestors without a fetch, or
  `attestorJwksUrl` for another Builder.
- To verify on another server, send the proof there and rebuild the hashes
  from the same request.

## Failures

| Symptom | Cause and fix |
| --- | --- |
| `BuilderQuotaExceededError` (402 or 429) | The org is out of `ZKFETCH` quota. Give the developer `error.billingUrl`, the org's billing page, where they upgrade the plan or add credits. Retrying doesn't help. |
| `BuilderAuthorizationError` (401) | The org key is wrong or revoked. Call `issue_org_token` again. |
| `attestor-trust-required` | `@reclaimprotocol/client` is older than 0.1.47. Upgrade it, or pass `attestorJwksUrl`. |
| `Proof by required hash ... was not found` | The hashed request differs from the proven one. Compare URL, method, body, matches, and redactions. |
| `missing claimAttestation` | `@reclaimprotocol/client` is older than 0.1.46. Upgrade it. |
| `Gnark library not built for OS/arch` | Remove `zkEngine: 'gnark'`. It only applies with `useTee: false`, where the default `stwo` engine runs everywhere. |

## Performance

In Builder mode, zkFetch runs in a TEE by default, and a proof takes about 2
to 3 seconds. Pass `useTee: false` for the standard ZK path, which takes 5 to
10 seconds, mostly while the attestor verifies the ZK proofs. Platforms
without the native TEE library (anything other than Linux or macOS on x64 or
arm64) fall back to the standard path. The TEE library prints its own logs to
stdout whatever `logs` is set to.

Reuse one `ReclaimClient`. The attestor connection keeps Node running, so a
one-off script ends with `process.exit()`. Don't call zkFetch on a user's
request path; prove ahead of time or in a background job.
